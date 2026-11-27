import { createHash } from "node:crypto";
import { assertCandidateSignal, canBeCase, type RecoveryTypeAdmissionPolicy } from "./admission";
import type { CandidateSignal } from "./types";

export interface CaseCandidate {
  readonly candidateId: string;
  readonly dedupeKey: string;
  readonly boundaryId: string;
  readonly agentId: string;
  readonly signal: CandidateSignal;
  readonly status: "pending_review";
  readonly submittedAt: string;
}

export interface CaseCandidateStore {
  createIfAbsent(candidate: CaseCandidate): Promise<{
    readonly candidate: CaseCandidate;
    readonly created: boolean;
  }>;
  /**
   * Does a candidate with this exact dedupe key already exist in this boundary?
   *
   * ADDED FOR ONE PURPOSE: cross-case double attribution. It reads the SAME `dedupe_key` column the
   * insert already looks up, which is UNIQUE and therefore already indexed — so this needs no schema
   * change, no new column and no new index.
   *
   * THE BOUNDARY IS A PARAMETER RATHER THAN IMPLIED BY THE KEY, even though `boundaryId` is the first
   * component of both preimages. A lookup that relied on the key alone would be correct only as long
   * as that stays true, and a tenant-isolation guarantee should not rest on a property of a hash.
   */
  existsByDedupeKey(boundaryId: string, dedupeKey: string): Promise<boolean>;
}

/**
 * The only automatic crossing from detection into Coordination is a pending
 * review candidate. This service deliberately has no method that authors a
 * Recovery Case, establishes a baseline, takes an action, or approves proof.
 */
export class CaseAdmissionService {
  constructor(
    private readonly store: CaseCandidateStore,
    private readonly now: () => Date,
  ) {}

  async submit(
    agentId: string,
    signalValue: unknown,
    policy: RecoveryTypeAdmissionPolicy,
  ): Promise<{ readonly admitted: false; readonly reason: string } | {
    readonly admitted: true;
    readonly candidate: CaseCandidate;
    readonly created: boolean;
  }> {
    if (!agentId.trim()) return { admitted: false, reason: "agent identity is required" };
    assertCandidateSignal(signalValue);
    const decision = canBeCase(signalValue, policy);
    if (!decision.admitted) return decision;

    const dedupeKey = caseCandidateDedupeKey(signalValue);

    // ── CROSS-CASE DOUBLE ATTRIBUTION · the release blocker, refused here ──────────────────────────
    //
    // THE EXPOSURE, MEASURED. A boundary assessed BEFORE obligation-grained emission holds an
    // ACCOUNT_V1 aggregate candidate covering several obligations — possibly already promoted to a
    // case and possibly already proven. Re-assessing the same extract afterwards produces
    // OBLIGATION_V2 candidates for the SAME units. The two keys differ LEGITIMATELY, because the
    // claims are at different grains, so `createIfAbsent` cannot see the overlap: both rows are
    // created and the same money becomes reachable twice. A test drives it and asserts the sum is
    // exactly double.
    //
    // WHY IT IS CHECKABLE WITHOUT A SCHEMA CHANGE. The account-grained key is a pure function of
    // three fields this very signal carries, so the aggregate's key can be DERIVED and looked up by
    // the UNIQUE `dedupe_key` column. Nothing is searched by `sourceRef`, which lives inside a JSON
    // column and has no index — that is the version of this check that WOULD have needed one.
    //
    // THE V2 CLAIM IS THE ONE REFUSED, not the legacy row. A legacy aggregate may already underlie a
    // frozen proof, and refusing an admission writes nothing while retiring a case would rewrite
    // history. So this fails closed in the direction that leaves every historical record intact: the
    // obligation-grained claim waits until the aggregate is governed away.
    //
    // IT IS DELIBERATELY ONE-DIRECTIONAL, and the asymmetry is argued rather than assumed. The
    // reverse — V2 rows existing when an ACCOUNT_V1 signal arrives — would require enumerating every
    // obligation of the account, which is the unbounded lookup this avoids. It is also not reachable
    // from one emission: a payer's identified and unidentified units go to DIFFERENT candidates and
    // every unit appears exactly once, so a single run never produces an overlapping pair.
    if (candidateDedupeGrain(signalValue) === "OBLIGATION_V2") {
      const aggregateKey = accountGrainedDedupeKey(signalValue);
      if (await this.store.existsByDedupeKey(signalValue.boundaryId, aggregateKey)) {
        return {
          admitted: false,
          reason:
            "an account-grained aggregate candidate already covers this payer in this boundary, so "
            + "admitting an obligation-grained claim would make the same exposure reachable twice "
            + `(aggregate candidate ${caseCandidateId(aggregateKey)}). Retire the aggregate through `
            + "governance before obligation-grained claims are admitted for this payer.",
        };
      }
    }

    const candidate: CaseCandidate = Object.freeze({
      candidateId: caseCandidateId(dedupeKey),
      dedupeKey,
      boundaryId: signalValue.boundaryId,
      agentId,
      signal: Object.freeze({ ...signalValue }),
      status: "pending_review",
      submittedAt: this.now().toISOString(),
    });
    const stored = await this.store.createIfAbsent(candidate);
    return { admitted: true, ...stored };
  }
}

export class InMemoryCaseCandidateStore implements CaseCandidateStore {
  private readonly byDedupeKey = new Map<string, CaseCandidate>();

  async createIfAbsent(candidate: CaseCandidate): Promise<{
    readonly candidate: CaseCandidate;
    readonly created: boolean;
  }> {
    assertCaseCandidateIdentity(candidate);
    const existing = this.byDedupeKey.get(candidate.dedupeKey);
    if (existing) return { candidate: existing, created: false };
    this.byDedupeKey.set(candidate.dedupeKey, candidate);
    return { candidate, created: true };
  }

  async existsByDedupeKey(boundaryId: string, dedupeKey: string): Promise<boolean> {
    const row = this.byDedupeKey.get(dedupeKey);
    return row !== undefined && row.boundaryId === boundaryId;
  }
}

/**
 * The derivation this key was produced by. ADDITIVE AND EXPLICITLY VERSIONED.
 *
 *   v1 — `(boundaryId, recoveryType, sourceRef)`. ACCOUNT-GRAINED. Still the answer for every signal
 *        that does not state a single obligation, byte-identical to what it has always produced, so
 *        every stored candidate and case keeps its identity and both frozen pins hold.
 *   v2 — `(scheme, boundaryId, recoveryType, sourceRef, obligationRef)`. OBLIGATION-GRAINED. Used only
 *        where the signal states which single obligation it covers.
 *
 * WHY THIS IS NOT A REWRITE OF A FROZEN KEY. A derivation that changed for existing inputs would
 * re-identify every candidate in every database. This one changes for NO existing input: the v2 branch
 * is reachable only through `obligationCoverage.kind === "SINGLE_OBLIGATION"`, a field that did not
 * exist when any historical row was written. A legacy signal takes the v1 branch and cannot take the
 * other.
 *
 * COLLISION BETWEEN THE TWO IS STRUCTURALLY IMPOSSIBLE, not merely unlikely. `digest` LENGTH-FRAMES each
 * component (`<byteLength>:<value>` joined by `|`), so a three-component preimage can never produce the
 * byte string of a five-component one; the scheme tag in first position makes it legible as well as safe.
 */
export const CANDIDATE_DEDUPE_SCHEME_V2 = "nh-candidate-dedupe-obligation-v2";

export type CandidateDedupeGrain = "ACCOUNT_V1" | "OBLIGATION_V2";

/**
 * Which derivation applies to this signal, as a separate, testable question.
 *
 * Exported because the grain is a FACT ABOUT THE KEY that read surfaces and diagnostics need, and
 * re-deriving it beside each of them is how two implementations of one rule drift apart.
 */
export function candidateDedupeGrain(signal: CandidateSignal): CandidateDedupeGrain {
  return signal.obligationCoverage?.kind === "SINGLE_OBLIGATION" ? "OBLIGATION_V2" : "ACCOUNT_V1";
}

/**
 * The ACCOUNT-GRAINED (v1) key for any signal, whatever grain it actually claims.
 *
 * Exported and separate because the overlap check needs the key an EARLIER build would have written
 * for this same payer. Deriving it inline at the call site would be a second implementation of the v1
 * preimage, and the whole point is that the two cannot disagree: this function IS the v1 branch of
 * `caseCandidateDedupeKey`, which calls it rather than repeating it.
 */
export function accountGrainedDedupeKey(signal: CandidateSignal): string {
  return digest([signal.boundaryId, signal.recoveryType, signal.sourceRef]);
}

export function caseCandidateDedupeKey(signal: CandidateSignal): string {
  const coverage = signal.obligationCoverage;
  if (coverage?.kind === "SINGLE_OBLIGATION") {
    // THE OBLIGATION ENTERS THE KEY, and nothing else does. The amount is deliberately absent: a
    // corrected observation of the SAME obligation must resolve to the SAME key, or a correction would
    // silently become a second obligation and the measured exposure would double. What happens to such
    // a correction is reported by `candidateCorrections` and is an owner decision, not this key's.
    return digest([
      CANDIDATE_DEDUPE_SCHEME_V2,
      signal.boundaryId,
      signal.recoveryType,
      signal.sourceRef,
      coverage.obligationRef,
    ]);
  }
  // UNCHANGED. An account-grained signal — including an ACCOUNT_AGGREGATE one, which has no obligation
  // to key on — keeps the original three-component preimage exactly. Delegated rather than repeated,
  // so the overlap check and this branch cannot drift apart.
  return accountGrainedDedupeKey(signal);
}

export function caseCandidateId(dedupeKey: string): string {
  if (!/^[a-f0-9]{64}$/.test(dedupeKey)) throw new Error("candidate dedupe key must be a SHA-256 digest");
  return `CC-${dedupeKey.slice(0, 24)}`;
}

export function assertCaseCandidateIdentity(candidate: CaseCandidate): void {
  assertCandidateSignal(candidate.signal);
  const expectedDedupe = caseCandidateDedupeKey(candidate.signal);
  if (candidate.dedupeKey !== expectedDedupe || candidate.candidateId !== caseCandidateId(expectedDedupe)) {
    throw new Error("candidate identity does not match its immutable source signal");
  }
  if (candidate.boundaryId !== candidate.signal.boundaryId) {
    throw new Error("candidate boundary does not match its source signal");
  }
}

function digest(parts: readonly string[]): string {
  const framed = parts.map((part) => `${Buffer.byteLength(part, "utf8")}:${part}`).join("|");
  return createHash("sha256").update(framed).digest("hex");
}

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
  // to key on — keeps the original three-component preimage exactly.
  return digest([signal.boundaryId, signal.recoveryType, signal.sourceRef]);
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

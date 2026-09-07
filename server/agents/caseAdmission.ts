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

    const dedupeKey = digest([
      signalValue.boundaryId,
      signalValue.recoveryType,
      signalValue.sourceRef,
    ]);
    const candidate: CaseCandidate = Object.freeze({
      candidateId: `CC-${dedupeKey.slice(0, 24)}`,
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
    const existing = this.byDedupeKey.get(candidate.dedupeKey);
    if (existing) return { candidate: existing, created: false };
    this.byDedupeKey.set(candidate.dedupeKey, candidate);
    return { candidate, created: true };
  }
}

function digest(parts: readonly string[]): string {
  const framed = parts.map((part) => `${Buffer.byteLength(part, "utf8")}:${part}`).join("|");
  return createHash("sha256").update(framed).digest("hex");
}

// React state layer. Wires the repository + domain into the UI and exposes
// workflow actions.
//
// TWO WORLDS, NEVER BLENDED (transition rules #1/#6):
//   • The Recovery *Case* keeps live, PROVISIONAL values (float amounts + re-scored confidence)
//     for in-flight work and the demo narrative. These are input/display only. They are marked
//     below as transitional debt and MUST NOT feed any Proof, ledger, or CFO/auditable number.
//   • The *trust world* — governed Baselines, Evidence, and immutable approved Proofs — is
//     append-only, reads only from governed objects + explicit minor-unit inputs + versioned
//     Policy + a system TimestampAuthority, and is the ONLY source of proven/auditable money.
//
// Approved Proofs and locked Baselines are NEVER mutated in place; a reversal/correction/
// supersession appends a NEW linked record (rules #3/#4). The effective view folds each chain
// to one record (rule #5).
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  RecoveryEvent,
  RecoveryReason,
  RecoveryStatus,
} from "../domain/types";
import { withDerivedReturn } from "../domain/invariants";
import { computeConfidence } from "../domain/confidence";
import { recommend } from "../domain/recommendation";
import { appendAudit, makeAuditEntry } from "../domain/audit";
import { createLocalStorageRepo } from "../data/localStorageRepo";
import type { RecoveryRepository } from "../data/repository";
// --- Trust world (governed, immutable, append-only) ---
import {
  type Baseline,
  establishBaseline as makeBaseline,
  lockBaseline as lockBaselineObj,
  reviseBaseline as reviseBaselineObj,
  isLocked,
} from "../domain/baseline";
import { type Evidence, makeEvidence, type TrustClassification } from "../domain/evidence";
import { money } from "../domain/money";
import { type Proof, effectiveProofs, hasEffectiveRecoveryForCase } from "../domain/proof";
import { type Actor, hasRole } from "../domain/authority";
import { CURRENT_POLICY } from "../domain/policy";
import { APPROVER_ACTOR, OWNERS, ownerActorIdOf } from "../data/actors";
import { systemTimestampAuthority } from "../domain/timestamp";
import {
  approveProofForCase,
  reverseProofForCase,
  validateApproval,
  type CaseApprovalContext,
} from "../domain/approval";

// The system-recorded clock for all trust timestamps (approval, lock, ingest). Prototype-grade,
// but deliberately NOT sourced from user-editable Case fields (Trust Invariant #3).
const TS = systemTimestampAuthority;

// Separation of authority (Trust Invariant #8): the Case owner (beneficiary of a larger number)
// can never be the sole approver. The approver is a distinct Finance role. Identities live in
// `data/actors.ts` (shared with the seed) — re-exported here so existing imports keep working.
export { APPROVER_ACTOR, OWNERS };
// The acting operator for audit-trail attribution on provisional Case edits.
const ACTOR = "you@company";

function caseCurrency(e: RecoveryEvent): string {
  return e.currency ?? "USD";
}

export interface EstablishBaselineInput {
  /** Governed baseline amount in explicit minor units — NEVER derived from the Case float. */
  amountMinor: number;
  method?: string;
  sourceRefs: string[];
  /** The pre-outcome point in time this baseline represents (business time). */
  effectiveAt?: string;
  establishedBy: string;
}

export interface AddEvidenceInput {
  evidenceType: string;
  sourceSystem: string;
  sourceRecordId: string;
  observedAt: string;
  trustClassification: TrustClassification;
  suppliedBy: string;
}

export interface ApproveProofInput {
  /** Explicit collected minor units (from the input edge via money.fromDecimal). NOT the Case float. */
  collectedMinor: number;
  /** Explicit excluded-recovery minor units (mandatory to state, may be 0 with a reason). */
  excludedMinor: number;
  /** Mandatory exclusion statement (zero must be an explicit assertion). */
  exclusionStatement: string;
  attribution: string;
  /** Confidence score stamped into the Proof; defaults to the live provisional score. */
  confidenceUsed?: number;
  /** Approver identity; defaults to the distinct Finance approver. Must differ from the owner. */
  approver?: Actor;
}

type ApproveResult = { ok: true; proof: Proof } | { ok: false; error: string };

interface RecoveryContextValue {
  events: RecoveryEvent[];
  // --- Provisional Case workflow (in-flight; never a source of proven money) ---
  assignOwner: (id: string, owner: string) => void;
  advanceStatus: (id: string, status: RecoveryStatus) => void;
  addAction: (id: string, action: string) => void;
  setReason: (id: string, reason: RecoveryReason) => void;
  applyRecommendation: (id: string) => void;
  updateAmounts: (
    id: string,
    amounts: { baselineAmount?: number; collectedAmount?: number },
  ) => void;
  updateEvidence: (id: string, evidence: string) => void;
  resetData: () => void;
  // --- Trust world (governed, immutable, append-only) ---
  baselines: Baseline[];
  proofs: Proof[];
  baselineOf: (caseId: string) => Baseline | undefined;
  evidenceOf: (caseId: string) => Evidence[];
  proofsOf: (caseId: string) => Proof[];
  establishBaseline: (caseId: string, input: EstablishBaselineInput) => Baseline;
  lockBaseline: (caseId: string, reason: string) => void;
  reviseBaseline: (
    caseId: string,
    input: { amountMinor: number; sourceRefs: string[]; establishedBy: string; reason: string },
  ) => Baseline | undefined;
  addEvidence: (caseId: string, input: AddEvidenceInput) => Evidence;
  /** Preview approval violations without creating anything (drives the UI's Approve gate). */
  approvalBlockers: (caseId: string, input: ApproveProofInput) => string[];
  approveProof: (caseId: string, input: ApproveProofInput) => ApproveResult;
  /** A refund/chargeback/dispute → a NEW linked record; the original Proof is never touched. */
  reverseProof: (chainId: string, reason: string, approver?: Actor) => ApproveResult;
}

const Ctx = createContext<RecoveryContextValue | null>(null);

export function RecoveryProvider({ children }: { children: ReactNode }) {
  const repo: RecoveryRepository = useMemo(() => createLocalStorageRepo(), []);
  const [events, setEvents] = useState<RecoveryEvent[]>(() => repo.list());

  // Governed, append-only trust collections, loaded from the repository's separate trust store.
  // Approved Proofs and locked Baselines are only ever ADDED to these arrays — never edited in
  // place; a lock replaces a still-unlocked baseline, a reversal/correction appends a new record.
  const initialTrust = useMemo(() => repo.loadTrust(), [repo]);
  const [baselines, setBaselines] = useState<Baseline[]>(() => initialTrust.baselines);
  const [proofs, setProofs] = useState<Proof[]>(() => initialTrust.proofs);
  const [evidenceByCase, setEvidenceByCase] = useState<Record<string, Evidence[]>>(
    () => initialTrust.evidenceByCase,
  );
  // Persist the trust world whenever it changes (append-only in practice).
  useEffect(() => {
    repo.saveTrust({ baselines, proofs, evidenceByCase });
  }, [repo, baselines, proofs, evidenceByCase]);

  // Authoritative, synchronous mirror of `proofs`. React state updates are async, so a stale render
  // closure would let two rapid approve/reverse clicks both pass the "already approved?" guard and
  // create duplicate Proof chains (double-count). approve/reverseProof read AND append through this
  // ref synchronously, so the second call in the same tick observes the first. Kept in sync with
  // state for external changes (load/reset).
  // NOTE: prototype concurrency guard only — single-user, single-tab. A real multi-user/multi-tab
  // system must enforce idempotency/uniqueness server-side (a unique constraint on the effective
  // proof per case + an idempotency key on approve), which is the deferred trust boundary.
  const proofsRef = useRef<Proof[]>(proofs);
  useEffect(() => {
    proofsRef.current = proofs;
  }, [proofs]);
  // Record-id generator. `seq` resets to 0 on remount (page reload), so a bare counter could
  // regenerate an id used in a previous session — and since a Proof's id becomes its chainId, a
  // collision would make effectiveProofs merge two unrelated chains and undercount. Combining a
  // base36 timestamp with the per-session counter guarantees uniqueness both within a session and
  // across reloads (wall-clock only moves forward).
  const seq = useRef(0);
  const mkId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(seq.current += 1)}`;

  // Apply a pure transform to one Case, persist it, and refresh state. Confidence is re-scored
  // from the transparent model after every change. This path governs PROVISIONAL Case values only.
  const mutate = useCallback(
    (id: string, fn: (e: RecoveryEvent) => RecoveryEvent) => {
      setEvents((prev) => {
        const next = prev.map((e) => {
          if (e.eventId !== id) return e;
          let updated = withDerivedReturn(fn(e));
          updated = { ...updated, confidence: computeConfidence(updated) };
          repo.save(updated);
          return updated;
        });
        return next;
      });
    },
    [repo],
  );

  // Stamp the system-recorded intervention time exactly once (the first real action on the Case).
  // Baseline governance requires the baseline to be locked BEFORE this moment.
  const stampIntervention = (e: RecoveryEvent): RecoveryEvent =>
    e.interventionAt ? e : { ...e, interventionAt: TS.now() };

  const assignOwner = useCallback(
    (id: string, owner: string) =>
      mutate(id, (e) =>
        appendAudit(
          {
            ...e,
            owner,
            ownerActorId: ownerActorIdOf(owner),
            status: e.status === "Detected" || e.status === "Queued" ? "Assigned" : e.status,
          },
          makeAuditEntry("assigned", ACTOR, `Assigned to ${owner}`, e.owner ?? "—", owner),
        ),
      ),
    [mutate],
  );

  const advanceStatus = useCallback(
    (id: string, status: RecoveryStatus) =>
      mutate(id, (e) => {
        // Stamp the system-recorded outcome-observed time when the money outcome is realized.
        const withOutcome =
          status === "Recovered" && !e.outcomeObservedAt
            ? { ...e, outcomeObservedAt: TS.now() }
            : e;
        return appendAudit(
          { ...withOutcome, status },
          makeAuditEntry("status_changed", ACTOR, `${e.status} → ${status}`, e.status, status),
        );
      }),
    [mutate],
  );

  const addAction = useCallback(
    (id: string, action: string) =>
      mutate(id, (e) =>
        appendAudit(
          stampIntervention({ ...e, actionsTaken: [...e.actionsTaken, action] }),
          makeAuditEntry("action_added", ACTOR, `Action: ${action}`),
        ),
      ),
    [mutate],
  );

  const setReason = useCallback(
    (id: string, reason: RecoveryReason) =>
      mutate(id, (e) =>
        appendAudit(
          { ...e, recoveryReason: reason },
          makeAuditEntry("reason_set", ACTOR, `Reason set: ${reason ?? "—"}`, e.recoveryReason ?? "—", reason ?? "—"),
        ),
      ),
    [mutate],
  );

  // Apply the Decision Engine's recommended play in ONE atomic, audited step.
  const applyRecommendation = useCallback(
    (id: string) =>
      mutate(id, (e) => {
        const rec = recommend(e);
        const newActions = rec.recommendedActions.filter((a) => !e.actionsTaken.includes(a));
        return appendAudit(
          stampIntervention({
            ...e,
            recoveryReason: rec.recommendedReason,
            actionsTaken: [...e.actionsTaken, ...newActions],
          }),
          makeAuditEntry(
            "action_added",
            ACTOR,
            `Applied recommended play: ${rec.recommendedReason} (+${newActions.length} action${newActions.length === 1 ? "" : "s"})`,
            e.recoveryReason ?? "—",
            rec.recommendedReason,
          ),
        );
      }),
    [mutate],
  );

  // PROVISIONAL amounts only. Transitional debt (rule #6): these Case floats are input/display and
  // will be removed at the Case-money conversion checkpoint. They NEVER reach a Proof. Once a
  // governed Baseline is locked for the Case, the provisional baseline field is frozen too, so the
  // beneficiary cannot appear to "move the baseline" (Trust Invariant #2).
  const lockedBaselineExists = useCallback(
    (caseId: string) => {
      const e = events.find((x) => x.eventId === caseId);
      const b = e?.baselineId ? baselines.find((x) => x.baselineId === e.baselineId) : undefined;
      return b !== undefined && isLocked(b);
    },
    [events, baselines],
  );
  const updateAmounts = useCallback(
    (id: string, amounts: { baselineAmount?: number; collectedAmount?: number }) => {
      const safe =
        amounts.baselineAmount !== undefined && lockedBaselineExists(id)
          ? { collectedAmount: amounts.collectedAmount } // drop baseline edits after governed lock
          : amounts;
      return mutate(id, (e) =>
        appendAudit(
          { ...e, ...safe },
          makeAuditEntry(
            "amounts_updated",
            ACTOR,
            "Updated provisional baseline/collected amounts",
            `base ${e.baselineAmount} / coll ${e.collectedAmount}`,
            `base ${safe.baselineAmount ?? e.baselineAmount} / coll ${safe.collectedAmount ?? e.collectedAmount}`,
          ),
        ),
      );
    },
    [mutate, lockedBaselineExists],
  );

  const updateEvidence = useCallback(
    (id: string, evidence: string) =>
      mutate(id, (e) =>
        appendAudit(
          { ...e, evidenceNotes: evidence },
          makeAuditEntry("evidence_updated", ACTOR, "Updated evidence notes"),
        ),
      ),
    [mutate],
  );

  const resetData = useCallback(() => {
    repo.reset();
    setEvents(repo.list());
    const seeded = repo.loadTrust();
    setBaselines(seeded.baselines);
    setProofs(seeded.proofs);
    setEvidenceByCase(seeded.evidenceByCase);
  }, [repo]);

  // --- Trust-world reads -----------------------------------------------------------------------
  const baselineOf = useCallback(
    (caseId: string): Baseline | undefined => {
      const e = events.find((x) => x.eventId === caseId);
      if (!e?.baselineId) return undefined;
      return baselines.find((b) => b.baselineId === e.baselineId);
    },
    [events, baselines],
  );
  const evidenceOf = useCallback(
    (caseId: string): Evidence[] => evidenceByCase[caseId] ?? [],
    [evidenceByCase],
  );
  const proofsOf = useCallback(
    (caseId: string): Proof[] => proofs.filter((p) => p.recoveryCaseId === caseId),
    [proofs],
  );

  // --- Governed Baseline lifecycle -------------------------------------------------------------
  const establishBaseline = useCallback(
    (caseId: string, input: EstablishBaselineInput): Baseline => {
      const e = events.find((x) => x.eventId === caseId);
      if (!e) throw new Error(`establishBaseline: unknown case ${caseId}`);
      const currency = caseCurrency(e);
      const now = TS.now();
      const baseline = makeBaseline({
        baselineId: mkId(`BL-${caseId}`),
        method: input.method ?? CURRENT_POLICY.baselineMethodId,
        methodVersion: CURRENT_POLICY.baselineMethodVersion,
        sourceRefs: input.sourceRefs,
        calculatedAmount: money(input.amountMinor, currency),
        applicableLeakType: e.leakageType,
        effectiveAt: input.effectiveAt ?? now,
        establishedAt: now,
        establishedBy: input.establishedBy,
      });
      setBaselines((prev) => [...prev, baseline]);
      // Link the governed baseline to the Case and pin its currency.
      mutate(caseId, (c) =>
        appendAudit(
          { ...c, baselineId: baseline.baselineId, currency },
          makeAuditEntry(
            "amounts_updated",
            input.establishedBy,
            `Established governed baseline ${baseline.baselineId}`,
          ),
        ),
      );
      return baseline;
    },
    [events, mutate],
  );

  const lockBaseline = useCallback(
    (caseId: string, reason: string) => {
      const e = events.find((x) => x.eventId === caseId);
      const current = e?.baselineId ? baselines.find((b) => b.baselineId === e.baselineId) : undefined;
      if (!current) throw new Error(`lockBaseline: no baseline established for case ${caseId}`);
      if (isLocked(current)) return; // idempotent — a locked baseline is immutable
      const locked = lockBaselineObj(current, TS.now(), reason);
      // Replace the still-mutable UNLOCKED record with its locked form (locking an unlocked
      // baseline is a legitimate transition; a LOCKED baseline is never mutated after this).
      setBaselines((prev) => prev.map((b) => (b.baselineId === locked.baselineId ? locked : b)));
      mutate(caseId, (c) =>
        appendAudit(
          c,
          makeAuditEntry("amounts_updated", ACTOR, `Locked baseline ${locked.baselineId}: ${reason}`),
        ),
      );
    },
    [events, baselines, mutate],
  );

  const reviseBaseline = useCallback(
    (
      caseId: string,
      input: { amountMinor: number; sourceRefs: string[]; establishedBy: string; reason: string },
    ): Baseline | undefined => {
      const e = events.find((x) => x.eventId === caseId);
      const current = e?.baselineId ? baselines.find((b) => b.baselineId === e.baselineId) : undefined;
      if (!current) return undefined;
      const currency = current.currency;
      const revised = reviseBaselineObj(current, {
        baselineId: mkId(`BL-${caseId}`),
        calculatedAmount: money(input.amountMinor, currency),
        sourceRefs: input.sourceRefs,
        establishedAt: TS.now(),
        establishedBy: input.establishedBy,
        reason: input.reason,
      });
      // Append the successor; the superseded baseline is preserved untouched (append-only history).
      setBaselines((prev) => [...prev, revised]);
      mutate(caseId, (c) =>
        appendAudit(
          { ...c, baselineId: revised.baselineId },
          makeAuditEntry(
            "amounts_updated",
            input.establishedBy,
            `Revised baseline ${current.baselineId} → ${revised.baselineId}: ${input.reason}`,
          ),
        ),
      );
      return revised;
    },
    [events, baselines, mutate],
  );

  const addEvidence = useCallback(
    (caseId: string, input: AddEvidenceInput): Evidence => {
      const ev = makeEvidence({
        evidenceId: mkId(`EV-${caseId}`),
        evidenceType: input.evidenceType,
        sourceSystem: input.sourceSystem,
        sourceRecordId: input.sourceRecordId,
        observedAt: input.observedAt,
        ingestedAt: TS.now(),
        trustClassification: input.trustClassification,
        suppliedBy: input.suppliedBy,
      });
      setEvidenceByCase((prev) => ({ ...prev, [caseId]: [...(prev[caseId] ?? []), ev] }));
      return ev;
    },
    [],
  );

  // Assemble the approval context from GOVERNED objects + explicit minor-unit inputs + versioned
  // Policy + the system clock — never from mutable Case money (rule #3). Returns null when the
  // context cannot even be formed (missing baseline / reason), with a human reason.
  const buildApprovalContext = useCallback(
    (caseId: string, input: ApproveProofInput): { ctx: CaseApprovalContext } | { error: string } => {
      const e = events.find((x) => x.eventId === caseId);
      if (!e) return { error: `unknown case ${caseId}` };
      // Guard against double-counting: one effective proof per case (rule #5). A later legitimate
      // change is a linked reversal/correction, never a second independent chain.
      if (hasEffectiveRecoveryForCase(proofs, caseId)) {
        return { error: "case already has an approved proof — reverse it before re-approving" };
      }
      const baseline = e.baselineId ? baselines.find((b) => b.baselineId === e.baselineId) : undefined;
      if (!baseline) return { error: "no governed baseline established for this case" };
      if (!isLocked(baseline)) return { error: "baseline must be locked before approval" };
      if (!e.recoveryReason) return { error: "a recovery reason is required before approval" };
      const approver = input.approver ?? APPROVER_ACTOR;
      if (!hasRole(approver, "proofApprover")) return { error: "approver lacks the proofApprover role" };
      const ctx: CaseApprovalContext = {
        proofId: mkId(`PF-${caseId}`),
        recoveryCaseId: caseId,
        approvedAt: TS.now(),
        ownerActorId: e.ownerActorId ?? (e.owner ? ownerActorIdOf(e.owner) : null),
        approverActor: approver,
        baseline,
        evidence: evidenceByCase[caseId] ?? [],
        interventionAt: e.interventionAt ?? null,
        outcomeObservedAt: e.outcomeObservedAt ?? null,
        collectedMinor: input.collectedMinor,
        currency: baseline.currency,
        excludedMinor: input.excludedMinor,
        exclusionStatement: input.exclusionStatement,
        recoveryReason: e.recoveryReason,
        attribution: input.attribution,
        confidenceUsed: input.confidenceUsed ?? e.confidence,
        policy: CURRENT_POLICY,
      };
      return { ctx };
    },
    [events, baselines, evidenceByCase, proofs],
  );

  const approvalBlockers = useCallback(
    (caseId: string, input: ApproveProofInput): string[] => {
      const built = buildApprovalContext(caseId, input);
      if ("error" in built) return [built.error];
      return validateApproval(built.ctx);
    },
    [buildApprovalContext],
  );

  const approveProof = useCallback(
    (caseId: string, input: ApproveProofInput): ApproveResult => {
      const built = buildApprovalContext(caseId, input);
      if ("error" in built) return { ok: false, error: built.error };
      // Authoritative synchronous guard against the double-click race (reads the ref, not the
      // render closure). A second call in the same tick sees the first's appended proof.
      if (hasEffectiveRecoveryForCase(proofsRef.current, caseId)) {
        return { ok: false, error: "case already has an approved proof — reverse it before re-approving" };
      }
      try {
        const proof = approveProofForCase(built.ctx); // throws (fails closed) on any gate violation
        const next = [...proofsRef.current, proof]; // append-only; never mutates an existing Proof
        proofsRef.current = next; // synchronous: the next call this tick observes it
        setProofs(next);
        return { ok: true, proof };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    [buildApprovalContext],
  );

  const reverseProof = useCallback(
    (chainId: string, reason: string, approver?: Actor): ApproveResult => {
      // Read the authoritative ref so a rapid second reverse sees the first's reversal.
      const latest = effectiveProofs(proofsRef.current).find((p) => p.chainId === chainId);
      if (!latest) return { ok: false, error: `no effective proof for chain ${chainId}` };
      if (latest.status === "Reversed") return { ok: false, error: "proof is already reversed" };
      const revision = reverseProofForCase(latest, {
        newProofId: mkId(`PF-${chainId}-rev`),
        at: TS.now(),
        approvedBy: (approver ?? APPROVER_ACTOR).id,
        reason,
      });
      const next = [...proofsRef.current, revision]; // NEW linked record; original untouched
      proofsRef.current = next;
      setProofs(next);
      return { ok: true, proof: revision };
    },
    [],
  );

  const value: RecoveryContextValue = {
    events,
    assignOwner,
    advanceStatus,
    addAction,
    setReason,
    applyRecommendation,
    updateAmounts,
    updateEvidence,
    resetData,
    baselines,
    proofs,
    baselineOf,
    evidenceOf,
    proofsOf,
    establishBaseline,
    lockBaseline,
    reviseBaseline,
    addEvidence,
    approvalBlockers,
    approveProof,
    reverseProof,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRecovery(): RecoveryContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useRecovery must be used within RecoveryProvider");
  return v;
}

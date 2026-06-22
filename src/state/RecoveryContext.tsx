// React state layer. Wires the repository + domain into the UI and exposes
// workflow actions. Every mutation re-derives revenueReturned and appends an
// audit entry, so the invariants and audit trail can never be bypassed by the UI.
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
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

// The acting user (would come from auth in a real system).
const ACTOR = "you@company";

interface RecoveryContextValue {
  events: RecoveryEvent[];
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
}

const Ctx = createContext<RecoveryContextValue | null>(null);

export function RecoveryProvider({ children }: { children: ReactNode }) {
  const repo: RecoveryRepository = useMemo(() => createLocalStorageRepo(), []);
  const [events, setEvents] = useState<RecoveryEvent[]>(() => repo.list());

  // Apply a pure transform to one event, persist it, and refresh state.
  // Confidence is re-scored from the transparent model after every change.
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

  const assignOwner = useCallback(
    (id: string, owner: string) =>
      mutate(id, (e) =>
        appendAudit(
          { ...e, owner, status: e.status === "Detected" || e.status === "Queued" ? "Assigned" : e.status },
          makeAuditEntry("assigned", ACTOR, `Assigned to ${owner}`, e.owner ?? "—", owner),
        ),
      ),
    [mutate],
  );

  const advanceStatus = useCallback(
    (id: string, status: RecoveryStatus) =>
      mutate(id, (e) =>
        appendAudit(
          { ...e, status },
          makeAuditEntry("status_changed", ACTOR, `${e.status} → ${status}`, e.status, status),
        ),
      ),
    [mutate],
  );

  const addAction = useCallback(
    (id: string, action: string) =>
      mutate(id, (e) =>
        appendAudit(
          { ...e, actionsTaken: [...e.actionsTaken, action] },
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

  // Apply the Decision Engine's recommended play in ONE atomic, audited step:
  // adopt the recommended reason and append any not-yet-recorded actions. Goes
  // through the same mutate() path, so invariants + confidence + audit hold.
  const applyRecommendation = useCallback(
    (id: string) =>
      mutate(id, (e) => {
        const rec = recommend(e);
        const newActions = rec.recommendedActions.filter(
          (a) => !e.actionsTaken.includes(a),
        );
        return appendAudit(
          {
            ...e,
            recoveryReason: rec.recommendedReason,
            actionsTaken: [...e.actionsTaken, ...newActions],
          },
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

  const updateAmounts = useCallback(
    (id: string, amounts: { baselineAmount?: number; collectedAmount?: number }) =>
      mutate(id, (e) =>
        appendAudit(
          { ...e, ...amounts },
          makeAuditEntry(
            "amounts_updated",
            ACTOR,
            "Updated baseline/collected amounts",
            `base ${e.baselineAmount} / coll ${e.collectedAmount}`,
            `base ${amounts.baselineAmount ?? e.baselineAmount} / coll ${amounts.collectedAmount ?? e.collectedAmount}`,
          ),
        ),
      ),
    [mutate],
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
  }, [repo]);

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
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRecovery(): RecoveryContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useRecovery must be used within RecoveryProvider");
  return v;
}

export const OWNERS = ["Dana Levy", "Priya Nair", "Marcus Cole"];

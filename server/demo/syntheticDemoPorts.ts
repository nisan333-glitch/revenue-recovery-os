// Real persistence for the synthetic demo. Kept apart from `syntheticDemo.ts` so the demo's RULES can be
// unit-tested without a database; this file is the thin, rule-free adapter.
import { createPostgresAgentTaskStore } from "../agents/prismaTaskDatabase";
import { authorityFor } from "../auth/authorityStore";
import { getBaselinesForCase } from "../persistence/baselineStore";
import { getEvidenceForCase } from "../persistence/evidenceStore";
import { getRecoveryCase } from "../persistence/recoveryCaseStore";
import type { SyntheticDemoPorts } from "./syntheticDemo";

export function postgresSyntheticDemoPorts(): SyntheticDemoPorts {
  const store = createPostgresAgentTaskStore();
  return {
    enqueue: (task) => store.enqueueIfAbsent(task),
    readCase: (id) => getRecoveryCase(id),
    hasIntervention: async (id) => (await authorityFor(id)).some((h) => h.action === "Intervene"),
    hasBaseline: async (id) => (await getBaselinesForCase(id)).length > 0,
    evidenceExists: async (id, evidenceId) => (await getEvidenceForCase(id)).some((e) => e.evidenceId === evidenceId),
  };
}

// EP-13 · The gate between "a file was picked" and "an assessment may run".
//
// Extracted from the container so the rule that matters is testable without a DOM: PROGRESSION IS
// DECIDED BY THE SERVER. The browser runs a preflight to give instant feedback on a large file, but
// the preflight can never authorise a run — a client controls its own code, so a client-side "looks
// fine" is a courtesy, not a verdict.
//
// The asymmetry is deliberate and one-directional:
//   • preflight says NOT usable → stop early, save the customer an upload they will be refused;
//   • preflight says usable     → submit anyway, and obey the server.
// A preflight can therefore only ever be MORE conservative than the server, never more permissive.
import {
  preflightPilotDataset,
  submitPilotDataset,
  type PilotIntakeParams,
  type PilotIntakeResult,
} from "../../data/pilotIntakeClient";
import type { DevActor } from "../../data/devActor";
import type { ContractValidationReport } from "../../contract/validateDataset";
import { evaluateAdmission } from "../../contract/admissionGate";
import { makePolicy } from "../../assessment/policy";

export type IntakeGateOutcome =
  /** The server accepted the dataset as usable. Only this outcome may start an assessment. */
  | { readonly kind: "proceed"; readonly result: PilotIntakeResult }
  /** Validated and refused. The findings are the customer's to act on; nothing was stored. */
  | { readonly kind: "blocked"; readonly result: PilotIntakeResult; readonly preliminary: boolean }
  /** The submission itself failed (network, auth, too large). Never treated as "valid". */
  | { readonly kind: "error"; readonly message: string };

export interface IntakeGateDeps {
  readonly preflight?: typeof preflightPilotDataset;
  readonly submit?: typeof submitPilotDataset;
}

/**
 * Shape a local preflight report like a server result so one panel renders both.
 *
 * The admission decision is computed with NO policy, which yields NOT_ASSESSABLE. That is the honest
 * preview: the browser does not hold the tenant's policy, and inventing one to make the preview look
 * complete would show a fitness verdict nobody configured.
 */
export function preflightAsResult(report: ContractValidationReport): PilotIntakeResult {
  return {
    contractRef: report.contractRef,
    contractVersion: report.contractVersion,
    declaredVersion: report.declaredVersion,
    boundaryId: report.boundaryId,
    datasetId: report.datasetId,
    accepted: report.accepted,
    usableForAssessment: report.usableForAssessment,
    counts: report.counts,
    datasetFindings: report.datasetFindings,
    rowFindings: report.rowFindings,
    datasetFingerprint: report.datasetFingerprint,
    idempotencyKey: report.idempotencyKey,
    // A preflight never records anything — only the server can, and only for a usable dataset.
    recordedAt: null,
    admission: evaluateAdmission(
      report,
      makePolicy({ stallThresholdDays: 0, asOf: "1970-01-01", currency: "USD" }),
      null,
    ),
  };
}

/**
 * Run the gate. Returns `proceed` only when the server says the dataset is BOTH technically usable
 * AND admissible for pilot assessment.
 *
 * EP-14 · `usableForAssessment` alone is not enough, and that is the whole point of this change: one
 * surviving row among thousands rejected satisfies it. Fitness is a separate question with a
 * separate, explicitly configured answer, and both must be yes.
 *
 * Note what is NOT here: no fallback that lets the preflight stand in when the server is
 * unreachable. An upload that could not be validated server-side is an `error`, never a pass —
 * "the network was down" must not become a way to enter assessment unvalidated.
 */
export async function gateUpload(
  params: PilotIntakeParams,
  actor: DevActor,
  deps: IntakeGateDeps = {},
): Promise<IntakeGateOutcome> {
  const preflight = deps.preflight ?? preflightPilotDataset;
  const submit = deps.submit ?? submitPilotDataset;

  try {
    const local = await preflight(params);
    if (!local.usableForAssessment) {
      return { kind: "blocked", result: preflightAsResult(local), preliminary: true };
    }
  } catch (e) {
    return { kind: "error", message: e instanceof Error ? e.message : String(e) };
  }

  let server: PilotIntakeResult;
  try {
    server = await submit(params, actor);
  } catch (e) {
    return { kind: "error", message: e instanceof Error ? e.message : String(e) };
  }

  const admitted = server.usableForAssessment && server.admission.admissibleForPilotAssessment;
  return admitted
    ? { kind: "proceed", result: server }
    : { kind: "blocked", result: server, preliminary: false };
}

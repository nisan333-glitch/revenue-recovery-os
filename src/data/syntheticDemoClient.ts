// Client for the PRIVATE synthetic demo (server/demo/syntheticDemo.ts). Two calls and a status probe —
// and deliberately NO parameter that could carry an amount, currency, date or evidence id: the server
// fixes all of those, so this client could not smuggle one in even by mistake.
import { apiRequest } from "./apiClient";
import type { DevActor } from "./devActor";
import type { EvidenceRecordDTO } from "./governedTrustClient";

export type SyntheticDemoStatusDTO =
  | { enabled: false }
  | { enabled: true; label: string; boundaryId: string; currency: string; sourceKeyId: string };

export interface SyntheticLaunchDTO {
  launched: boolean;
  alreadyLaunched: boolean;
  boundaryId: string;
  taskId: string;
  label: string;
  currency: string;
}

export function getSyntheticDemoStatus(actor: DevActor): Promise<SyntheticDemoStatusDTO> {
  return apiRequest("GET", "/synthetic-demo/status", actor);
}

export function launchSyntheticDemo(actor: DevActor): Promise<SyntheticLaunchDTO> {
  return apiRequest("POST", "/synthetic-demo/launch", actor, undefined);
}

export function settleSyntheticCase(caseId: string, actor: DevActor): Promise<EvidenceRecordDTO> {
  return apiRequest("POST", `/synthetic-demo/cases/${encodeURIComponent(caseId)}/settle`, actor, undefined);
}

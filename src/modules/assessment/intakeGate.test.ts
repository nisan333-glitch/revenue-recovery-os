// EP-13 · The progression gate. These tests pin requirement 12: a dataset that is not usable must
// not be able to enter assessment, by any path — including the paths that look like accidents.
import { describe, it, expect } from "vitest";
import { gateUpload, preflightAsResult } from "./intakeGate";
import type { PilotIntakeParams, PilotIntakeResult } from "../../data/pilotIntakeClient";
import { SYNTHETIC_PROVENANCE, syntheticPilotCsv, syntheticViolationCsv } from "../../contract/syntheticPilotDataset";
import { validatePilotDataset } from "../../contract/validateDataset";
import { PILOT_DATA_CONTRACT_VERSION } from "../../contract/pilotDataContract";
import { makePolicy } from "../../assessment/policy";

const ACTOR = { actorId: "op@company", role: "operator" as const };

const params = (csvText: string): PilotIntakeParams => ({
  boundaryId: "pilot-boundary-0001",
  datasetId: "dataset-0001",
  csvText,
  provenance: SYNTHETIC_PROVENANCE,
  stallThresholdDays: 30,
  asOf: "2026-04-15",
  currency: "USD",
});

function serverResult(over: Partial<PilotIntakeResult> = {}): PilotIntakeResult {
  return {
    contractRef: `nh.customer-pilot-data-contract@${PILOT_DATA_CONTRACT_VERSION}`,
    contractVersion: PILOT_DATA_CONTRACT_VERSION,
    declaredVersion: PILOT_DATA_CONTRACT_VERSION,
    boundaryId: "pilot-boundary-0001",
    datasetId: "dataset-0001",
    accepted: true,
    usableForAssessment: true,
    counts: { dataRows: 10, acceptedRows: 10, rejectedRows: 0, warnedRows: 0 },
    datasetFindings: [],
    rowFindings: [],
    datasetFingerprint: "f".repeat(64),
    idempotencyKey: "pds_test",
    recordedAt: "2026-09-23T00:00:00.000Z",
    ...over,
  };
}

describe("intake gate — the server decides", () => {
  it("proceeds only when the SERVER says the dataset is usable", async () => {
    const outcome = await gateUpload(params(syntheticPilotCsv(10)), ACTOR, {
      submit: async () => serverResult(),
    });
    expect(outcome.kind).toBe("proceed");
  });

  it("blocks when the server refuses, even though the local preflight passed", async () => {
    // The case that matters: the client thinks the file is fine and the server disagrees. The
    // server wins — otherwise client-side validation would be the real authority.
    const outcome = await gateUpload(params(syntheticPilotCsv(10)), ACTOR, {
      submit: async () =>
        serverResult({
          accepted: false,
          usableForAssessment: false,
          counts: { dataRows: 10, acceptedRows: 0, rejectedRows: 10, warnedRows: 0 },
        }),
    });
    expect(outcome.kind).toBe("blocked");
    if (outcome.kind === "blocked") expect(outcome.preliminary).toBe(false);
  });

  it("blocks before uploading when the preflight already shows it is unusable", async () => {
    let submitted = false;
    const outcome = await gateUpload(params(syntheticViolationCsv()), ACTOR, {
      submit: async () => {
        submitted = true;
        return serverResult();
      },
    });
    expect(outcome.kind).toBe("blocked");
    if (outcome.kind === "blocked") expect(outcome.preliminary).toBe(true);
    expect(submitted).toBe(false); // the customer is not made to wait for an upload that fails
  });

  it("a failed submission is an error, never a pass — an unreachable server is not a green light", async () => {
    const outcome = await gateUpload(params(syntheticPilotCsv(10)), ACTOR, {
      submit: async () => {
        throw new Error("network unreachable");
      },
    });
    expect(outcome.kind).toBe("error");
    // Specifically NOT "proceed": there is no offline fallback that lets an unvalidated dataset in.
    expect(outcome.kind).not.toBe("proceed");
  });

  it("a server result that is accepted but has zero usable rows still blocks", async () => {
    // `accepted` describes the file; only `usableForAssessment` may gate progression.
    const outcome = await gateUpload(params(syntheticPilotCsv(10)), ACTOR, {
      submit: async () =>
        serverResult({
          accepted: true,
          usableForAssessment: false,
          counts: { dataRows: 9, acceptedRows: 0, rejectedRows: 9, warnedRows: 0 },
        }),
    });
    expect(outcome.kind).toBe("blocked");
  });

  it("a preflight report renders through the same shape, and never claims to be recorded", async () => {
    const report = await validatePilotDataset({
      declaredVersion: PILOT_DATA_CONTRACT_VERSION,
      boundary: { boundaryId: "b", datasetId: "d" },
      provenance: SYNTHETIC_PROVENANCE,
      csvText: syntheticPilotCsv(4),
      policy: makePolicy({ stallThresholdDays: 30, asOf: "2026-04-15", currency: "USD" }),
    });
    const shaped = preflightAsResult(report);
    expect(shaped.usableForAssessment).toBe(true);
    expect(shaped.recordedAt).toBeNull(); // only the server records, and only a usable dataset
  });
});

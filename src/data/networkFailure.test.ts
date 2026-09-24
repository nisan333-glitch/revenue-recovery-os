// EP-19 · When the server cannot be reached.
//
// THE RULE THIS FILE EXISTS FOR: an unreachable server is an error, never a pass. There is no
// offline fallback, no cached finding, and no browser-computed substitute presented in place of a
// governed result. A network failure that quietly degraded into "here is a number" would be the
// single most dangerous bug in this product — the figure would look identical to a proven one and
// carry none of the lineage.
import { describe, it, expect, vi, afterEach } from "vitest";
import { apiRequest, ApiError } from "./apiClient";
import {
  schedulePilotAssessment,
  readPilotAssessment,
  listPilotAssessments,
} from "./pilotAssessmentClient";
import {
  proposeAdmissionPolicy,
  transitionAdmissionPolicy,
  readPolicyGovernance,
} from "./pilotPolicyClient";
import { pollUntilSettled } from "../modules/assessment/executionPolling";
import { operatorActorFor, STEWARD } from "./devActor";
import { SCENARIO_POLICY, SYNTHETIC_PROVENANCE } from "../contract/syntheticPilotDataset";
import { ADMISSION_CALC_VERSION, makeAdmissionPolicy } from "../contract/pilotAdmissionPolicy";

const ACTOR = operatorActorFor(null);

// A real, valid policy rather than a cast: these calls must be the ones the app actually makes, or
// the test proves only that a malformed call also fails.
const SCENARIO_ADMISSION_POLICY = makeAdmissionPolicy({
  policyId: "network-failure-fixture",
  policyVersion: "1.0.0",
  calculationMethodVersion: ADMISSION_CALC_VERSION,
  ...SCENARIO_POLICY,
  requiredLifecycleStates: [...SCENARIO_POLICY.requiredLifecycleStates],
});

/** Every transport failure a browser actually produces. None of them may become a result. */
const TRANSPORT_FAILURES: readonly [string, unknown][] = [
  ["connection refused", new TypeError("Failed to fetch")],
  ["DNS failure", new TypeError("NetworkError when attempting to fetch resource.")],
  ["aborted mid-flight", Object.assign(new Error("The operation was aborted."), { name: "AbortError" })],
  ["a non-Error rejection", "socket hang up"],
];

function failingFetch(reason: unknown) {
  return vi.fn(() => Promise.reject(reason));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("EP-19 · an unreachable server is an error, never a result", () => {
  it.each(TRANSPORT_FAILURES)("maps %s to network_error with no server text", async (_label, reason) => {
    vi.stubGlobal("fetch", failingFetch(reason));
    const error = await apiRequest("GET", "/pilot/assessments/x", ACTOR).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("network_error");
    // The thrown message must be the fixed generic string — never the underlying transport text,
    // which can carry an internal hostname or proxy detail.
    expect((error as ApiError).message).toBe(
      "Something went wrong talking to the server. Please try again.",
    );
    expect((error as ApiError).message).not.toMatch(/fetch|socket|abort|DNS/i);
  });

  it("rejects from every governed call rather than returning a value", async () => {
    vi.stubGlobal("fetch", failingFetch(new TypeError("Failed to fetch")));
    const calls: readonly [string, Promise<unknown>][] = [
      ["schedule", schedulePilotAssessment(
        {
          boundaryId: "b", datasetId: "d", csvText: "x", provenance: SYNTHETIC_PROVENANCE,
          stallThresholdDays: 30, asOf: "2026-03-01", currency: "USD",
        },
        ACTOR,
      )],
      ["read", readPilotAssessment("b", "PAX-1", ACTOR)],
      ["list", listPilotAssessments("b", ACTOR)],
      ["propose", proposeAdmissionPolicy(
        { boundaryId: "b", policy: SCENARIO_ADMISSION_POLICY, rationale: "r" },
        ACTOR,
      )],
      ["activate", transitionAdmissionPolicy(
        "ACTIVATED",
        { boundaryId: "b", policyId: "p", policyVersion: "1.0.0", rationale: "r" },
        STEWARD,
      )],
      ["governance", readPolicyGovernance(
        { boundaryId: "b", policyId: "p", policyVersion: "1.0.0" },
        ACTOR,
      )],
    ];
    for (const [name, promise] of calls) {
      const outcome = await promise.then(
        (value) => ({ resolved: true as const, value }),
        (error: unknown) => ({ resolved: false as const, error }),
      );
      // A resolved promise here would mean some path invented a value for an unsent request.
      expect(outcome.resolved, `${name} must not resolve when the server is unreachable`).toBe(false);
      expect(outcome.resolved === false && (outcome.error as ApiError).code, name).toBe("network_error");
    }
  });

  it("does not retry a failed request behind the caller's back", async () => {
    // One user action is one request. A silent retry would double-submit an intake, and the second
    // attempt would come back 409 on a dataset the user only offered once.
    const fetchMock = failingFetch(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);
    await apiRequest("POST", "/pilot/datasets", ACTOR, { a: 1 }).catch(() => undefined);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("ends polling in `error`, and never in `settled`, when the network drops mid-run", async () => {
    // The dangerous shape: the run really was in flight, so a caller might be tempted to treat a
    // dropped connection as "probably finished". It is not a state the server ever reported.
    vi.stubGlobal("fetch", failingFetch(new TypeError("Failed to fetch")));
    const outcome = await pollUntilSettled(() => readPilotAssessment("b", "PAX-1", ACTOR), {
      attempts: 3,
      delayMs: 1,
    });
    expect(outcome.kind).toBe("error");
    expect(outcome.kind === "error" && outcome.message).toBe(
      "Something went wrong talking to the server. Please try again.",
    );
    expect(JSON.stringify(outcome)).not.toMatch(/finding|revenueReturned|completed/i);
  });

  it("carries no offline fallback anywhere in the data layer", async () => {
    // A guard against the fix somebody reaches for under demo pressure: caching the last finding
    // in storage and serving it when the server is down. It would be indistinguishable on screen.
    const { readFileSync } = await import("node:fs");
    for (const file of [
      "src/data/apiClient.ts",
      "src/data/pilotAssessmentClient.ts",
      "src/data/pilotPolicyClient.ts",
    ]) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/localStorage|sessionStorage\.setItem|indexedDB|navigator\.onLine/);
      expect(source, file).not.toMatch(/catch[\s\S]{0,80}return\s*(\{|\[)/);
    }
  });
});

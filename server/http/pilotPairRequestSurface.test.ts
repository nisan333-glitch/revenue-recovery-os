// T1 · the pilot-pair request surface, pinned structurally.
//
// WHY A STRUCTURAL TEST AS WELL AS THE BEHAVIOURAL ONES. `pilotPairIntake.test.ts` proves the SERVICE
// stamps `actionAvailable` and `observedAt` itself and that a sixth payload field is refused by the
// observer. Neither says anything about the WIRE. A caller reaches the service through a JSON body,
// and what the body may express is decided by the schema — so the property set is pinned as an
// ALLOWLIST, and a new field, however innocent, fails this test until someone states what it is.
//
// This is the treatment EP-26b gave the `policy` object and S5 gave `declaredVersion`: an injected
// field must be a 400, not a silent strip, because a silent strip means the caller believes they set
// something and the record disagrees.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import Ajv from "ajv";
import { pilotPairSchema } from "./schemas";

const body = pilotPairSchema.body as {
  type: string; required: readonly string[];
  properties: Record<string, unknown>; additionalProperties: boolean;
};
const validate = new Ajv({ allErrors: true, strict: false }).compile(body);

const WELL_FORMED = {
  boundaryId: "pb-1", currency: "USD",
  expectationCsv: "entitlement_ref\nENT-1", billingCsv: "invoice_ref\nINV-1",
};

describe("T1 · what a pilot-pair request may say", () => {
  it("pins the WHOLE property set — four fields, and nothing that steers the reading", () => {
    // Note what is absent: no `actionAvailable` (false suppresses every signal), no `observedAt` (the
    // caller would choose when their own exposure was observed), no detector, no threshold, no
    // admission policy, no task id, no amount, and no readiness level or authority claim.
    expect(Object.keys(body.properties).sort()).toEqual([
      "billingCsv", "boundaryId", "currency", "expectationCsv",
    ]);
    expect([...body.required].sort()).toEqual([
      "billingCsv", "boundaryId", "currency", "expectationCsv",
    ]);
  });

  it("is closed — an unknown field is a 400 and never a silent strip", () => {
    expect(body.additionalProperties).toBe(false);
    expect(validate(WELL_FORMED)).toBe(true);
    for (const injected of ["actionAvailable", "observedAt", "taskId", "detectorVersion", "policy"]) {
      expect(validate({ ...WELL_FORMED, [injected]: injected === "actionAvailable" ? false : "x" }),
        `the schema accepted an injected ${injected}`).toBe(false);
    }
  });

  it("each required field must actually be present — the allowlist is not the only gate", () => {
    for (const k of Object.keys(WELL_FORMED)) {
      const partial = { ...WELL_FORMED } as Record<string, unknown>;
      delete partial[k];
      expect(validate(partial), `${k} was treated as optional`).toBe(false);
    }
  });
});

describe("T1 · the route itself", () => {
  const app = readFileSync(resolve(__dirname, "..", "app.ts"), "utf8");
  const route = app.slice(app.indexOf('"/pilot/pairs"'), app.indexOf('"/pilot/pairs"') + 700);

  it("resolves the ACTOR from the request's identity, never from the body", () => {
    expect(route).toMatch(/resolveActor\(req, options\.identityResolver\)/);
    // The actor is passed to the service, which runs the capability and boundary gates. No branch of
    // this route may construct one from the body.
    expect(route).not.toMatch(/actorId:\s*req\.body/);
    expect(route).not.toMatch(/role:\s*req\.body/);
  });

  it("answers 200 WITH A VERDICT — an unusable pair is a finding about the data, not a server error", () => {
    // A 4xx would make a correct, complete answer ("your billing export is missing a required column")
    // look like a malformed request, and a caller's error handling would discard the codes that say
    // what to fix.
    expect(route).toMatch(/reply\.code\(200\)/);
  });

  it("raises the transport limit ABOVE the per-file byte bound, so the service's own refusal is reachable", () => {
    // With Fastify's default body limit the service's `NH-PP-1002` would be unreachable: the connection
    // would be cut first and the operator would get a bare 413 with no code. A refusal that cannot fire
    // is not a refusal.
    expect(app).toMatch(/pairUploadTransportLimit\s*=\s*2 \* PAIR_MAX_BYTES \+/);
    expect(route).toMatch(/bodyLimit: pairUploadTransportLimit/);
  });
});

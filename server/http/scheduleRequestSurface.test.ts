// S5 · The scheduling request surface, pinned structurally.
//
// WHY A STRUCTURAL TEST AND NOT ONLY A BEHAVIOURAL ONE. The behavioural proof lives beside the thing it
// protects (`referenceFirstScheduling.test.ts` A2/A2b: an injected `declaredVersion` is a 400 and leaves
// no execution behind). But a behavioural test only covers the field someone thought to inject. What has
// to hold is stronger and shape-shaped: **no caller-controlled version input may exist on the scheduling
// request at all**, under any name. So the body's property set is pinned as an ALLOWLIST, and a new field
// — however innocent — fails this test until someone states what it is.
//
// Two of these read SOURCE TEXT rather than runtime values, for a reason the repository has met before:
// TypeScript types are erased, and `tsconfig.server.json` excludes `server/**/*.test.ts`, so a server
// test cannot fail to compile. The same technique already pins the Stage-A revision's inertness. The
// assertions are deliberately narrow — a FIELD DECLARATION, not a mention — so comments that explain the
// removal (and there are several, on purpose) do not trip them.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pilotDatasetSchema, schedulePilotAssessmentSchema } from "./schemas";

const read = (p: string) => readFileSync(resolve(__dirname, "..", "..", p), "utf8");

describe("S5 · the scheduling request cannot express a caller's contract version", () => {
  it("has no `declaredVersion`, neither required nor declared", () => {
    const body = schedulePilotAssessmentSchema.body;
    expect(body.required as readonly string[]).not.toContain("declaredVersion");
    expect(Object.keys(body.properties)).not.toContain("declaredVersion");
  });

  it("POSITIVE CONTROL · the INTAKE request still requires and declares it", () => {
    // Without this the test above would also pass if someone deleted the field everywhere, which would
    // destroy the admission-time declaration — the authoritative one, persisted exactly as the customer
    // made it. The removal is targeted, and this is what makes that checkable.
    const body = pilotDatasetSchema.body;
    expect(body.required as readonly string[]).toContain("declaredVersion");
    expect(Object.keys(body.properties)).toContain("declaredVersion");
  });

  it("pins the whole property set as an ALLOWLIST, so no version input re-enters under another name", () => {
    // Every key here states what the request may say. Note what is absent beyond the version: no
    // threshold, no cut-off, no currency, no admission policy, no outcome and no finding. A scheduling
    // request names WHICH admitted dataset and WHICH decision admitted it, and nothing about the answer.
    expect(Object.keys(schedulePilotAssessmentSchema.body.properties).sort()).toEqual([
      "admissionDecisionId",
      "amountFormat",
      "analysisTermsId",
      "analysisTermsVersion",
      "boundaryId",
      "csvText",
      "datasetId",
      "locale",
      "provenance",
      "recoveryCaseId",
    ]);
  });

  it("keeps `additionalProperties: false`, which with removeAdditional:false is what makes injection a 400", () => {
    expect(schedulePilotAssessmentSchema.body.additionalProperties).toBe(false);
    // The ajv option is set once, in the app, and the reason is recorded there. Pinned by reading it
    // rather than by re-stating it: if someone turns stripping on, an injected field would be silently
    // accepted everywhere, and A2/A2b's 400 would become a false reassurance.
    const app = read("server/app.ts");
    expect(app).toMatch(/ajv:\s*\{\s*customOptions:\s*\{\s*removeAdditional:\s*false\s*\}\s*\}/);
  });

  it("the scheduling request TYPE declares no such field", () => {
    // Source-level because types are erased and this suite is not typechecked. A mention in a comment is
    // fine and expected; a `readonly declaredVersion` field declaration is not.
    const source = read("server/services/pilotAssessmentService.ts");
    const open = source.indexOf("export interface SchedulePilotAssessmentRequest {");
    expect(open).toBeGreaterThan(-1);
    const block = source.slice(open, source.indexOf("\n}", open));
    expect(block).not.toMatch(/^\s*readonly\s+declaredVersion\s*[?]?\s*:/m);
    // ...and the authoritative value is still read from the stored decision, outside that block.
    expect(source).toMatch(/decision\.declaredVersion \?\? decision\.contractVersion/);
  });

  it("the assessment client sends no such property", () => {
    // The UI path. `declaredVersion` appears once, in the comment that says it is not sent; what must not
    // appear is the property form.
    const client = read("src/data/pilotAssessmentClient.ts");
    expect(client).not.toMatch(/declaredVersion\s*:/);
    // POSITIVE CONTROL · the intake client still sends it, because there it is the customer's own claim.
    expect(read("src/data/pilotIntakeClient.ts")).toMatch(/declaredVersion:\s*PILOT_DATA_CONTRACT_VERSION/);
  });
});

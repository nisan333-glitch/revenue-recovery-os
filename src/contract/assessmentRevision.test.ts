import { describe, it, expect } from "vitest";
import { bindingRevisionDelta, isPermittedRevision } from "./assessmentRevision";
import { deriveExecutionId, type ExecutionBinding } from "./assessmentExecution";

// The delta is what a reader is shown when told "this revises an earlier result". If it can be wrong
// about its own diff, the revision model's central promise — "clearly show what changed and why" — is
// decoration. So it is tested here, in the no-database gate, rather than only through the HTTP path.

const BASE: ExecutionBinding = Object.freeze({
  boundaryId: "b-1",
  datasetFingerprint: "f".repeat(64),
  admissionDecisionId: "PAD-0123456789abcdef0123456789abcdef",
  admissionPolicyId: "pol-1",
  admissionPolicyVersion: "1.0.0",
  admissionPolicyHash: `sha256:${"a".repeat(64)}`,
  contractVersion: "2.0.0",
  assessmentPolicy: Object.freeze({
    policyId: "terms-1",
    policyVersion: "1.0.0",
    calculationMethodVersion: "assess-2026.1-thin",
    asOf: "2026-04-15",
    stallThresholdDays: 30,
    currency: "USD",
  }),
  interpretation: Object.freeze({ mappingId: "m-1", amountFormat: "US", dateLocale: "MDY" }),
  recoveryCaseId: null,
});

const withPolicy = (over: Partial<ExecutionBinding["assessmentPolicy"]>): ExecutionBinding =>
  Object.freeze({ ...BASE, assessmentPolicy: Object.freeze({ ...BASE.assessmentPolicy, ...over }) });

describe("what a revision changed", () => {
  it("reports the method move as CHANGED, with before and after, and nothing unexpected", () => {
    const delta = bindingRevisionDelta(
      withPolicy({ calculationMethodVersion: "assess-2026.0-older", policyVersion: "0.9.0" }),
      BASE,
    );
    expect(delta.unexpectedChanges).toEqual([]);
    expect(delta.changed).toEqual([
      { field: "calculationMethodVersion", before: "assess-2026.0-older", after: "assess-2026.1-thin" },
      { field: "assessmentPolicyVersion", before: "0.9.0", after: "1.0.0" },
    ]);
    expect(isPermittedRevision(delta)).toBe(true);
  });

  it("an IDENTICAL binding is not a permitted revision — a revision that changes nothing is not one", () => {
    const delta = bindingRevisionDelta(BASE, BASE);
    expect(delta.changed).toEqual([]);
    expect(delta.unexpectedChanges).toEqual([]);
    expect(isPermittedRevision(delta)).toBe(false);
  });

  it("EVERY FIELD A REVISION MUST HOLD CONSTANT is reported as unexpected, and refuses the revision", () => {
    // Enumerated one at a time rather than all at once, so a field that silently stopped being
    // compared fails here instead of hiding behind the others.
    const mutations: readonly [string, ExecutionBinding][] = [
      ["boundaryId", { ...BASE, boundaryId: "b-2" }],
      ["datasetFingerprint", { ...BASE, datasetFingerprint: "e".repeat(64) }],
      ["admissionDecisionId", { ...BASE, admissionDecisionId: "PAD-ffffffffffffffffffffffffffffffff" }],
      ["admissionPolicyId", { ...BASE, admissionPolicyId: "pol-2" }],
      ["admissionPolicyVersion", { ...BASE, admissionPolicyVersion: "2.0.0" }],
      ["admissionPolicyHash", { ...BASE, admissionPolicyHash: `sha256:${"b".repeat(64)}` }],
      ["contractVersion", { ...BASE, contractVersion: "1.1.0" }],
      ["asOf", withPolicy({ asOf: "2026-05-15" })],
      ["stallThresholdDays", withPolicy({ stallThresholdDays: 7 })],
      ["currency", withPolicy({ currency: "EUR" })],
      ["mappingId", { ...BASE, interpretation: { ...BASE.interpretation, mappingId: "m-2" } }],
      ["amountFormat", { ...BASE, interpretation: { ...BASE.interpretation, amountFormat: "EU" } }],
      ["dateLocale", { ...BASE, interpretation: { ...BASE.interpretation, dateLocale: "DMY" } }],
      ["recoveryCaseId", { ...BASE, recoveryCaseId: "RC-1" }],
    ];
    for (const [name, next] of mutations) {
      const delta = bindingRevisionDelta(BASE, next);
      expect(delta.unexpectedChanges.map((c) => c.field), name).toEqual([name]);
      expect(isPermittedRevision(delta), name).toBe(false);
    }
    expect(mutations.length).toBe(14);
  });

  it("the two lists together COVER THE WHOLE BINDING — a new field cannot fall between them", () => {
    // The module's claim is that fields are listed explicitly so adding one forces a decision. That is
    // only true if something notices when it does not happen. This is that something: every leaf of the
    // binding must appear in exactly one of the two lists.
    const leaves = (value: unknown, prefix = ""): readonly string[] =>
      typeof value === "object" && value !== null
        ? Object.entries(value).flatMap(([k, v]) => leaves(v, prefix === "" ? k : `${prefix}.${k}`))
        : [prefix];
    // Perturb each leaf in turn and require the delta to name exactly one field for it.
    const perturb = (path: string): ExecutionBinding => {
      const clone = JSON.parse(JSON.stringify(BASE)) as Record<string, unknown>;
      const parts = path.split(".");
      let cursor = clone;
      for (const part of parts.slice(0, -1)) cursor = cursor[part] as Record<string, unknown>;
      const key = parts[parts.length - 1]!;
      const current = cursor[key];
      cursor[key] = typeof current === "number" ? current + 1 : `${String(current)}-perturbed`;
      return clone as unknown as ExecutionBinding;
    };
    const paths = leaves(BASE).filter((p) => p !== "");
    for (const path of paths) {
      const delta = bindingRevisionDelta(BASE, perturb(path));
      const named = [...delta.changed, ...delta.unexpectedChanges].map((c) => c.field);
      expect(named.length, `${path} is compared by exactly one list`).toBe(1);
    }
    // 7 top-level scalars + 6 assessment-policy + 3 interpretation + `recoveryCaseId` — and 3 + 14 is
    // the same 17, which is the coverage claim stated twice from opposite directions.
    expect(paths.length).toBe(17);
  });

  it("a permitted revision has a DIFFERENT execution identity — linking, never overwriting", async () => {
    // The structural reason "never silently replace a result" holds at all: the revision's identity is
    // derived from its own binding, so it cannot land on the row it revises.
    const previous = withPolicy({ calculationMethodVersion: "assess-2026.0-older", policyVersion: "0.9.0" });
    expect(isPermittedRevision(bindingRevisionDelta(previous, BASE))).toBe(true);
    expect(await deriveExecutionId(BASE)).not.toBe(await deriveExecutionId(previous));
  });
});

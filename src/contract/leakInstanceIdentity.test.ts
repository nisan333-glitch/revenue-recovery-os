// EP-31c · The contract-gap predicate. Small, but it is the single thing candidate emission turns on.
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  LEAK_INSTANCE_IDENTITY_COMPONENTS,
  LEAK_INSTANCE_IDENTITY_SCHEME,
  LEAK_INSTANCE_IDENTITY_UNAVAILABLE_DETAIL,
  MAX_IDENTITY_COMPONENT_BYTES,
  OBLIGATION_IDENTITY_FIELDS,
  SOURCE_NAMESPACE_RESOLUTION_AVAILABLE,
  SOURCE_NAMESPACE_UNRESOLVED_DETAIL,
  canonicalLeakInstanceKey,
  leakInstanceComponentProblem,
  leakInstanceIdentityProblems,
  leakInstanceIdentityStatus,
  type CandidateLeakInstanceIdentity,
} from "./leakInstanceIdentity";
// Imported HERE and not in leakInstanceIdentity.ts, which has NO IMPORTS AT ALL by design (asserted
// structurally below). A test may cross that line; the module may not.
import { contractField } from "./pilotDataContract";

describe("EP-31c · leak-instance identity", () => {
  it("1 · is NOT establishable under the contract this build implements", () => {
    const status = leakInstanceIdentityStatus();
    expect(status.establishable).toBe(false);
    expect(status.reason).toBe("leak_instance_identity_unavailable");
    expect(status.detail).toBe(LEAK_INSTANCE_IDENTITY_UNAVAILABLE_DETAIL);
  });

  it("2 · declares NO obligation-identity field, and that emptiness is the finding", () => {
    // `cycle_id` is deliberately absent: it is optional, it has no synonyms in the adapter's mapping spec,
    // it is ignored whenever `subscription_id` is present (defect D1), and it is nowhere declared stable
    // across a reschedule of its own due date. See docs/GOVERNED_DETECTION_V1.md.
    expect(OBLIGATION_IDENTITY_FIELDS).toEqual([]);
    expect(OBLIGATION_IDENTITY_FIELDS).not.toContain("cycle_id");
    expect(OBLIGATION_IDENTITY_FIELDS).not.toContain("subscription_id");
  });

  it("3 · the answer is DERIVED from the declared set, not asserted — so it can change", () => {
    // Capable of failing in the useful direction: the status is a function of the list, so an extension
    // that adds a field flips it. That is what makes test 1 a live check rather than a restated constant,
    // and it is why an incomplete extension fails the emission controls instead of silently enabling them.
    const derived = (fields: readonly string[]) =>
      fields.length === 0
        ? {
            establishable: false,
            reason: "leak_instance_identity_unavailable" as const,
            detail: LEAK_INSTANCE_IDENTITY_UNAVAILABLE_DETAIL,
          }
        : {
            establishable: true,
            reason: null,
            detail: `obligation identity is carried by: ${[...fields].sort().join(", ")}`,
          };
    expect(derived(OBLIGATION_IDENTITY_FIELDS)).toEqual(leakInstanceIdentityStatus());
    expect(derived(["invoice_id"]).establishable).toBe(true);
    expect(derived(["invoice_id"]).detail).toMatch(/carried by: invoice_id/);
  });

  it("4 · the detail names the gap rather than gesturing at it, and echoes no customer value", () => {
    const detail = leakInstanceIdentityStatus().detail;
    // Both halves of the audit are stated: the same-key collision AND the reschedule ambiguity.
    expect(detail).toMatch(/entity_id, signed_at, next_invoice_due_at/);
    expect(detail).toMatch(/reschedul/i);
    expect(detail).toMatch(/refused rather than counted/);
    // A refusal reason is shown to operators; it must carry no data.
    expect(detail).not.toMatch(/synthetic-|@|\d{4}-\d{2}-\d{2}/);
  });

  it("5 · is pure: no clock, no randomness, no I/O — the same answer every time", () => {
    const a = leakInstanceIdentityStatus();
    const b = leakInstanceIdentityStatus();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(Object.isFrozen(a)).toBe(true);
  });
});

// ── EP-31d commit 1 · the canonical identity ──────────────────────────────────────────────────────

const NUL = "\u0000";
const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

/** One fixed, synthetic identity. Every value here is invented — no customer data appears in tests. */
const BASE: CandidateLeakInstanceIdentity = Object.freeze({
  boundaryId: "boundary-alpha",
  recoveryType: "ActivationMissed",
  sourceNamespaceId: "ns-billing-primary",
  obligationRef: "OBL-100045",
});

describe("EP-31d · canonical leak-instance identity", () => {
  it("6 · PINNED GOLDEN VECTOR — the canonical key and its digest are fixed", () => {
    // Written out in full rather than rebuilt from the same join the implementation uses: a test that
    // recomputes the encoding cannot notice the encoding changing.
    const expected =
      `nh-leak-instance-v1${NUL}boundary-alpha${NUL}ActivationMissed${NUL}ns-billing-primary${NUL}OBL-100045`;
    expect(canonicalLeakInstanceKey(BASE)).toBe(expected);
    expect(sha(canonicalLeakInstanceKey(BASE))).toBe(
      "490279af586e148092630b8bc48ce8f10060bb17f21b496fc0732bf8a06cd4de",
    );
    expect(LEAK_INSTANCE_IDENTITY_SCHEME).toBe("nh-leak-instance-v1");
    expect([...LEAK_INSTANCE_IDENTITY_COMPONENTS]).toEqual([
      "boundaryId",
      "recoveryType",
      "sourceNamespaceId",
      "obligationRef",
    ]);
  });

  it("7 · the encoding is INJECTIVE — a component can never impersonate the separator", () => {
    // The whole key rests on this. Without NUL rejection, ("a", "b\0c") and ("a\0b", "c") would encode
    // identically and two obligations would silently merge.
    expect(leakInstanceComponentProblem("obligationRef", `A${NUL}B`)).toMatch(/control characters/);
    expect(() => canonicalLeakInstanceKey({ ...BASE, obligationRef: `A${NUL}B` })).toThrow(
      /not encodable/,
    );
    // Shifting a NUL between components must therefore be unrepresentable, not merely unequal.
    expect(() => canonicalLeakInstanceKey({ ...BASE, sourceNamespaceId: `ns${NUL}billing` })).toThrow();
  });

  it("8 · every component is validated, and no refusal echoes the value", () => {
    const cases: readonly [string, unknown, RegExp][] = [
      ["obligationRef", "", /must not be empty/],
      ["obligationRef", "   ", /must not be empty/],
      ["obligationRef", " OBL-1 ", /whitespace/],
      ["obligationRef", "OBL\t1", /control characters/],
      ["obligationRef", "x".repeat(MAX_IDENTITY_COMPONENT_BYTES + 1), /at most 256 bytes/],
      ["obligationRef", 42, /must be a string/],
      ["obligationRef", null, /must be a string/],
    ];
    for (const [component, value, pattern] of cases) {
      const problem = leakInstanceComponentProblem(component, value);
      expect(problem).toMatch(pattern);
      // A refusal reason is shown to operators: it names the component, never the customer's value.
      if (typeof value === "string" && value.trim() !== "") expect(problem).not.toContain(value.trim());
    }
    expect(leakInstanceComponentProblem("obligationRef", "OBL-100045")).toBeNull();
    // Multi-byte values are bounded by BYTES, not by code units.
    expect(leakInstanceComponentProblem("obligationRef", "é".repeat(129))).toMatch(/at most 256 bytes/);
    expect(leakInstanceComponentProblem("obligationRef", "é".repeat(128))).toBeNull();
  });

  it("9 · problems are reported for ALL four components, in canonical order", () => {
    expect(leakInstanceIdentityProblems(BASE)).toEqual([]);
    const problems = leakInstanceIdentityProblems({});
    expect(problems).toHaveLength(4);
    expect(problems.map((p) => p.split(" ")[0])).toEqual([
      "boundaryId",
      "recoveryType",
      "sourceNamespaceId",
      "obligationRef",
    ]);
  });

  it("10 · CONTROL C · same obligationRef under a different namespace is a DIFFERENT identity", () => {
    const other = canonicalLeakInstanceKey({ ...BASE, sourceNamespaceId: "ns-billing-secondary" });
    expect(other).not.toBe(canonicalLeakInstanceKey(BASE));
    expect(sha(other)).toBe("eca0734ef46cb8cc356ece07e16e4d0a40915ee4cad7921cdffbf586ca295432");
    // Two billing systems that both number an invoice INV-1 must not collapse into one candidate.
    const a = canonicalLeakInstanceKey({ ...BASE, sourceNamespaceId: "ns-a", obligationRef: "INV-1" });
    const b = canonicalLeakInstanceKey({ ...BASE, sourceNamespaceId: "ns-b", obligationRef: "INV-1" });
    expect(a).not.toBe(b);
  });

  it("11 · CONTROL E · a different obligationRef in the same namespace is a DIFFERENT identity", () => {
    // This is dedupe property B: a genuinely new obligation for the same account must be admissible.
    expect(canonicalLeakInstanceKey({ ...BASE, obligationRef: "OBL-100046" })).not.toBe(
      canonicalLeakInstanceKey(BASE),
    );
    // And the boundary and the recovery type separate too, so neither leaks across tenants or classes.
    expect(canonicalLeakInstanceKey({ ...BASE, boundaryId: "boundary-beta" })).not.toBe(
      canonicalLeakInstanceKey(BASE),
    );
    expect(canonicalLeakInstanceKey({ ...BASE, recoveryType: "RenewalMissed" })).not.toBe(
      canonicalLeakInstanceKey(BASE),
    );
  });

  it("12 · CONTROLS D and F · nothing about the READING can change the identity", () => {
    // The identity is a function of exactly four values, so no re-export, correction, reschedule,
    // account re-key, cut-off, policy version, submission or execution can move it. Demonstrated by
    // construction: the key is unchanged while every such value varies around it.
    const reference = canonicalLeakInstanceKey(BASE);
    const irrelevant = {
      datasetFingerprint: "b".repeat(64),
      datasetId: "activation-2026-Q3",
      idempotencyKey: `pds_${"c".repeat(64)}`,
      executionId: `PAX-${"d".repeat(32)}`,
      entityId: "ACCOUNT-RE-KEYED-9999",
      asOf: "2026-12-31",
      stallThresholdDays: 90,
      assessmentPolicyVersion: "7",
      nextInvoiceAmountMinor: 999_999,
      nextInvoiceDueAt: "2027-01-31",
      evidenceKeyId: "KEY-2",
      sourceRefKeyId: "hmac-key-2",
    } as const;
    for (const [field, value] of Object.entries(irrelevant)) {
      // Supplying any of them is inert: they are not components, so they cannot participate.
      expect(canonicalLeakInstanceKey({ ...BASE, [field]: value } as CandidateLeakInstanceIdentity)).toBe(
        reference,
      );
    }
  });

  it("13 · the module is IMPORT-FREE, so identity cannot depend on pseudonymisation or any key", () => {
    // Structural, and the point of it: candidate identity must not be derived from, or constrained by,
    // the HMAC key layer or the evidence-key layer. A file with no imports cannot reach either.
    const source = readFileSync(new URL("./leakInstanceIdentity.ts", import.meta.url), "utf8");
    const importLines = source
      .split("\n")
      .filter((line) => /^\s*import\s/.test(line) || /^\s*export\s+.*\bfrom\s+["']/.test(line));
    expect(importLines).toEqual([]);
  });

  it("14 · the two prerequisites are INDEPENDENT and each is separately named", () => {
    // Today the contract gap is reported because it is the deeper one. The namespace gap is real and
    // separately addressable, and this asserts it exists as its own named reason rather than being
    // folded into the first — so closing one cannot look like closing both.
    // Step 5 CLOSED the namespace prerequisite and did NOT close the contract one. That the predicate still
    // refuses, and refuses for the REMAINING reason rather than the closed one, is the whole point of having
    // named them separately: progress on one is visible without looking like progress on both.
    expect(OBLIGATION_IDENTITY_FIELDS).toEqual([]);
    expect(SOURCE_NAMESPACE_RESOLUTION_AVAILABLE).toBe(true);
    expect(leakInstanceIdentityStatus().establishable).toBe(false);
    expect(leakInstanceIdentityStatus().reason).toBe("leak_instance_identity_unavailable");
    expect(SOURCE_NAMESPACE_UNRESOLVED_DETAIL).toMatch(/no authority/);
    expect(SOURCE_NAMESPACE_UNRESOLVED_DETAIL).not.toBe(LEAK_INSTANCE_IDENTITY_UNAVAILABLE_DETAIL);
    // Neither detail may carry a customer value or a date.
    for (const detail of [SOURCE_NAMESPACE_UNRESOLVED_DETAIL, LEAK_INSTANCE_IDENTITY_UNAVAILABLE_DETAIL]) {
      expect(detail).not.toMatch(/@|\d{4}-\d{2}-\d{2}/);
    }
  });
});

// ── 2.1.0 · A DECLARED COLUMN IS NOT A DECLARED IDENTITY ───────────────────────────────────────────
//
// This is the safety invariant of the staged 2.1.0 change, and it exists because the failure it guards
// against is an easy and tempting one: `obligation_ref` is now a real contract field carried onto every
// cycle, so adding its name to `OBLIGATION_IDENTITY_FIELDS` would be a one-word edit that silently flips
// `establishable` to true and enables candidate emission — on a field whose uniqueness, immutability and
// behaviour across a correction or a reschedule are ALL still unknown, and in a system where two genuine
// obligations of one subscription are still mutually excluded upstream (defect D2).
//
// So the test is not "the array happens to be empty". It is "the array is empty DESPITE the column
// existing", stated against the contract itself, with the two reasons named.
//
// Full reasoning and the conditions under which this may change: docs/OBLIGATION_IDENTITY_V1.md.

describe("2.1.0 · obligation_ref is declared but NOT identity-bearing", () => {
  it("the contract declares the column …", () => {
    expect(contractField("obligation_ref")).toBeDefined();
    expect(contractField("obligation_ref")!.requirement).toBe("optional");
  });

  it("… and the identity list is STILL empty, so emission still refuses", () => {
    expect(OBLIGATION_IDENTITY_FIELDS).toEqual([]);
    expect(OBLIGATION_IDENTITY_FIELDS).not.toContain("obligation_ref");

    const status = leakInstanceIdentityStatus();
    expect(status.establishable).toBe(false);
    expect(status.reason).toBe("leak_instance_identity_unavailable");
  });

  it("the namespace prerequisite being CLOSED does not close the contract prerequisite", () => {
    // Step 5 made an authoritative source namespace resolvable. If the two prerequisites were ever
    // collapsed into one boolean, closing either would look like closing both — which is precisely the
    // confusion this assertion exists to prevent.
    expect(SOURCE_NAMESPACE_RESOLUTION_AVAILABLE).toBe(true);
    expect(leakInstanceIdentityStatus().establishable).toBe(false);
  });

  it("a reference that is perfectly well formed still does not make an identity establishable", () => {
    // The component checks pass on a realistic reference …
    const identity: CandidateLeakInstanceIdentity = {
      boundaryId: "synthetic-boundary-0001",
      recoveryType: "ActivationMissed",
      sourceNamespaceId: "synthetic-billing",
      obligationRef: "INV-2026-0001",
    };
    expect(leakInstanceIdentityProblems(identity)).toEqual([]);
    expect(canonicalLeakInstanceKey(identity)).toContain("INV-2026-0001");
    // … and the STATUS is still false, because encodability is not authority. A caller that confused the
    // two would emit candidates keyed on a value nothing has established anything about.
    expect(leakInstanceIdentityStatus().establishable).toBe(false);
  });
});

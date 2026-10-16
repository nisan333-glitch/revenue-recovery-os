// Step 5 commit 1 · The pure resolution predicate and the pinned lineage hash.
//
// Three invariants are under test, each of which fixed a real defect during review: cardinality is never
// resolved by recency; a binding HISTORY never falls back to inheritance; and the uploader's declaration can
// only refuse. Every value here is synthetic.
import { describe, expect, it } from "vitest";
import {
  SOURCE_RESOLUTION_SCHEME,
  resolveSourceNamespace,
  sourceResolutionHash,
  type BindingRevisionRow,
  type NamespaceVersionRow,
  type PermittedSetRow,
  type SourceResolutionInput,
  type SourceResolutionLineage,
} from "./sourceNamespace";
import { deriveExecutionId, hashExecutionBinding, type ExecutionBinding } from "./assessmentExecution";

const FP = "f".repeat(64);
const nsVersion = (over: Partial<NamespaceVersionRow> = {}): NamespaceVersionRow => ({
  namespaceId: "ns-billing-primary", namespaceVersion: "1.0.0", state: "ACTIVE", label: "Billing (prod)", ...over,
});
const set = (over: Partial<PermittedSetRow> = {}): PermittedSetRow => ({
  setId: "set-alpha", setVersion: "3", state: "ACTIVE", activatedAt: "2026-01-01T00:00:00.000Z",
  memberNamespaceIds: ["ns-billing-primary"], ...over,
});
const input = (over: Partial<SourceResolutionInput> = {}): SourceResolutionInput => ({
  boundaryId: "boundary-alpha", datasetFingerprint: FP,
  bindingRevisions: [], permittedSets: [set()], namespaceVersions: [nsVersion()],
  firstSeenAt: "2026-06-01T00:00:00.000Z", declaredBillingSource: "", ...over,
});
const bind = (over: Partial<BindingRevisionRow> = {}): BindingRevisionRow => ({
  revision: 1, namespaceId: "ns-billing-primary", state: "ACTIVE", ...over,
});

describe("Step 5 · inheritance (no binding history)", () => {
  it("1 · resolves INHERITED and stamps the exact namespace version and set identity", () => {
    const r = resolveSourceNamespace(input());
    expect(r).toEqual({
      resolved: true,
      lineage: {
        sourceNamespaceId: "ns-billing-primary", sourceNamespaceVersion: "1.0.0",
        sourceBindingMode: "inherited", sourcePermittedSetId: "set-alpha",
        sourcePermittedSetVersion: "3", sourceBindingRevision: null,
      },
    });
  });

  it("2 · a set naming TWO namespaces is ambiguous, not a choice", () => {
    const r = resolveSourceNamespace(input({
      permittedSets: [set({ memberNamespaceIds: ["ns-a", "ns-b"] })],
    }));
    expect(r).toMatchObject({ resolved: false, reason: "source_namespace_ambiguous" });
  });

  it("3 · no ACTIVE set, and MORE THAN ONE ACTIVE set, are both refusals", () => {
    expect(resolveSourceNamespace(input({ permittedSets: [] }))).toMatchObject({
      reason: "source_permitted_set_unresolved",
    });
    expect(resolveSourceNamespace(input({ permittedSets: [set({ state: "DRAFT" })] }))).toMatchObject({
      reason: "source_permitted_set_unresolved",
    });
    expect(resolveSourceNamespace(input({
      permittedSets: [set(), set({ setId: "set-beta" })],
    }))).toMatchObject({ reason: "source_permitted_set_ambiguous" });
  });

  it("4 · authority may not be granted retroactively", () => {
    // Activated AFTER these bytes were first seen ⇒ refused. Where the bytes came from is not a question
    // that can be re-asked later, which is why this ordering applies here though EP-26 declined it.
    expect(resolveSourceNamespace(input({
      permittedSets: [set({ activatedAt: "2026-07-01T00:00:00.000Z" })],
    }))).toMatchObject({ reason: "source_binding_postdates_sighting" });
    // Never activated at all is the same answer.
    expect(resolveSourceNamespace(input({
      permittedSets: [set({ activatedAt: null })],
    }))).toMatchObject({ reason: "source_binding_postdates_sighting" });
    // Activated exactly AT the sighting is allowed — the bar is "not after".
    expect(resolveSourceNamespace(input({
      permittedSets: [set({ activatedAt: "2026-06-01T00:00:00.000Z" })],
    })).resolved).toBe(true);
  });
});

describe("Step 5 · INVARIANT 2 · exactly one ACTIVE version, never the latest", () => {
  it("5 · zero ACTIVE versions refuses", () => {
    expect(resolveSourceNamespace(input({
      namespaceVersions: [nsVersion({ state: "RETIRED" })],
    }))).toMatchObject({ reason: "source_namespace_not_active" });
  });

  it("6 · TWO ACTIVE versions refuses and does NOT pick either one", () => {
    const r = resolveSourceNamespace(input({
      namespaceVersions: [nsVersion({ namespaceVersion: "1.0.0" }), nsVersion({ namespaceVersion: "2.0.0" })],
    }));
    expect(r).toMatchObject({ resolved: false, reason: "source_namespace_version_ambiguous" });
    // The assertion that matters: no lineage at all, so nothing downstream can have been stamped.
    expect(r).not.toHaveProperty("lineage");
  });

  it("7 · 'latest' is never consulted — ordering the input differently changes nothing", () => {
    const ascending = resolveSourceNamespace(input({
      namespaceVersions: [nsVersion({ namespaceVersion: "1.0.0" }), nsVersion({ namespaceVersion: "9.9.9" })],
    }));
    const descending = resolveSourceNamespace(input({
      namespaceVersions: [nsVersion({ namespaceVersion: "9.9.9" }), nsVersion({ namespaceVersion: "1.0.0" })],
    }));
    expect(ascending).toEqual(descending);
    expect(ascending).toMatchObject({ reason: "source_namespace_version_ambiguous" });
    // And a single ACTIVE beside a RETIRED one resolves to the ACTIVE one, not the highest.
    const mixed = resolveSourceNamespace(input({
      namespaceVersions: [nsVersion({ namespaceVersion: "1.0.0" }), nsVersion({ namespaceVersion: "9.9.9", state: "RETIRED" })],
    }));
    expect(mixed).toMatchObject({ resolved: true, lineage: { sourceNamespaceVersion: "1.0.0" } });
  });
});

describe("Step 5 · INVARIANT 3 · a binding history never falls back to inheritance", () => {
  it("8 · one ACTIVE revision resolves EXPLICIT and records the revision", () => {
    const r = resolveSourceNamespace(input({ bindingRevisions: [bind({ revision: 2 })] }));
    expect(r).toMatchObject({
      resolved: true,
      lineage: { sourceBindingMode: "explicit", sourceBindingRevision: 2, sourcePermittedSetId: null },
    });
  });

  it("9 · THE CORRECTION WINDOW · history with NO active revision refuses, never inherits", () => {
    // This is the defect this invariant exists to prevent: a perfectly valid inheritable set is present,
    // and it must NOT be used, because these bytes were once explicitly bound.
    const r = resolveSourceNamespace(input({
      bindingRevisions: [bind({ revision: 1, state: "RETIRED" })],
      permittedSets: [set()], // a fully valid inheritance path exists and must be ignored
    }));
    expect(r).toMatchObject({ resolved: false, reason: "source_binding_retired_without_replacement" });
    // Proof the inheritance path really was available: the same input WITHOUT the history resolves.
    expect(resolveSourceNamespace(input({ bindingRevisions: [] })).resolved).toBe(true);
  });

  it("10 · a retired revision plus a DRAFT replacement is still refused", () => {
    expect(resolveSourceNamespace(input({
      bindingRevisions: [bind({ revision: 1, state: "RETIRED" }), bind({ revision: 2, state: "DRAFT" })],
    }))).toMatchObject({ reason: "source_binding_retired_without_replacement" });
  });

  it("11 · two ACTIVE revisions refuse rather than choosing the higher", () => {
    const r = resolveSourceNamespace(input({
      bindingRevisions: [bind({ revision: 1 }), bind({ revision: 2 })],
    }));
    expect(r).toMatchObject({ resolved: false, reason: "source_binding_ambiguous" });
    expect(r).not.toHaveProperty("lineage");
  });

  it("12 · an explicitly bound namespace with no single ACTIVE version refuses", () => {
    expect(resolveSourceNamespace(input({
      bindingRevisions: [bind()],
      namespaceVersions: [nsVersion({ state: "FROZEN" })],
    }))).toMatchObject({ reason: "source_namespace_not_active" });
  });
});

describe("Step 5 · the declaration is checked, never trusted", () => {
  it("13 · a mismatching declaration refuses; agreement and silence both pass", () => {
    expect(resolveSourceNamespace(input({ declaredBillingSource: "SomeOtherSystem" }))).toMatchObject({
      reason: "source_provenance_declaration_mismatch",
    });
    expect(resolveSourceNamespace(input({ declaredBillingSource: "Billing (prod)" })).resolved).toBe(true);
    expect(resolveSourceNamespace(input({ declaredBillingSource: "   " })).resolved).toBe(true);
  });

  it("14 · the declaration can never SELECT a namespace, only agree or refuse", () => {
    // Naming a namespace that is permitted but not resolved does not make it resolve.
    const r = resolveSourceNamespace(input({
      permittedSets: [set({ memberNamespaceIds: ["ns-a", "ns-b"] })],
      declaredBillingSource: "Billing (prod)",
    }));
    expect(r).toMatchObject({ reason: "source_namespace_ambiguous" });
  });
});

describe("Step 5 · pinned lineage hash and untouched execution identity", () => {
  it("15 · PINNED GOLDEN VECTORS for source_resolution_hash", async () => {
    const explicit: SourceResolutionLineage = {
      sourceNamespaceId: "ns-billing-primary", sourceNamespaceVersion: "1.0.0",
      sourceBindingMode: "explicit", sourcePermittedSetId: null, sourcePermittedSetVersion: null,
      sourceBindingRevision: 2,
    };
    const inherited: SourceResolutionLineage = {
      sourceNamespaceId: "ns-billing-primary", sourceNamespaceVersion: "1.0.0",
      sourceBindingMode: "inherited", sourcePermittedSetId: "set-alpha", sourcePermittedSetVersion: "3",
      sourceBindingRevision: null,
    };
    expect(await sourceResolutionHash("boundary-alpha", FP, explicit)).toBe(
      "sha256:1e862e569f7e80eec2e81b992b5214477408e6a80f1f9d60673c29079ec60c62",
    );
    expect(await sourceResolutionHash("boundary-alpha", FP, inherited)).toBe(
      "sha256:8b77a8642f670c0d3b9e8c37de7ca9a11ea51c5dcaea9a4483f50f3c251bce47",
    );
    expect(SOURCE_RESOLUTION_SCHEME).toBe("nh-source-resolution-v1");
  });

  it("16 · every lineage field changes the hash — it is not a partial digest", async () => {
    const base: SourceResolutionLineage = {
      sourceNamespaceId: "ns-a", sourceNamespaceVersion: "1", sourceBindingMode: "inherited",
      sourcePermittedSetId: "s", sourcePermittedSetVersion: "1", sourceBindingRevision: null,
    };
    const reference = await sourceResolutionHash("b", FP, base);
    const variants: SourceResolutionLineage[] = [
      { ...base, sourceNamespaceId: "ns-b" },
      { ...base, sourceNamespaceVersion: "2" },
      { ...base, sourceBindingMode: "explicit" },
      { ...base, sourcePermittedSetId: "t" },
      { ...base, sourcePermittedSetVersion: "2" },
      { ...base, sourceBindingRevision: 1 },
    ];
    for (const v of variants) expect(await sourceResolutionHash("b", FP, v)).not.toBe(reference);
    // The boundary and the fingerprint are covered too.
    expect(await sourceResolutionHash("other", FP, base)).not.toBe(reference);
    expect(await sourceResolutionHash("b", "a".repeat(64), base)).not.toBe(reference);
    // null and a value must not collide — the encoder distinguishes them by type, not by emptiness.
    expect(await sourceResolutionHash("b", FP, { ...base, sourcePermittedSetId: null })).not.toBe(reference);
  });

  it("17 · execution identity and bindingHash are UNCHANGED by this commit", async () => {
    // The load-bearing assertion of the whole step: `canonicalBinding` feeds both `deriveExecutionId` —
    // the execution's identity AND idempotency key — and `hashExecutionBinding`. Source lineage is
    // persisted BESIDE the binding precisely so these two values cannot move.
    const binding: ExecutionBinding = {
      boundaryId: "boundary-alpha", datasetFingerprint: FP,
      admissionDecisionId: "AD-1", admissionPolicyId: "bar", admissionPolicyVersion: "1",
      admissionPolicyHash: `sha256:${"a".repeat(64)}`, contractVersion: "2.0.0",
      assessmentPolicy: { policyId: "p", policyVersion: "1", calculationMethodVersion: "calc-1",
        asOf: "2026-06-30", stallThresholdDays: 30, currency: "USD" },
      interpretation: { mappingId: "m-1", amountFormat: "auto", dateLocale: "auto" },
      recoveryCaseId: null,
    };
    expect(await deriveExecutionId(binding)).toBe("PAX-8ad0089a7a35a973f905cd09ccc42afb");
    expect(await hashExecutionBinding(binding)).toBe(
      "sha256:8ad0089a7a35a973f905cd09ccc42afb5fcf6dbf1cfb32d57cccfaec2eee37e6",
    );
  });

  it("18 · resolution is pure and its results are frozen", () => {
    const a = resolveSourceNamespace(input());
    const b = resolveSourceNamespace(input());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(Object.isFrozen(a)).toBe(true);
    if (a.resolved) expect(Object.isFrozen(a.lineage)).toBe(true);
  });
});

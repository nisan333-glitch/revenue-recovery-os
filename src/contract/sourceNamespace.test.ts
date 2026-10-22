// EP-31d commit 2 · The namespace vocabulary, and the proof that it did not disturb the proof path.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  RESERVED_NAMESPACE_IDS,
  SOURCE_NAMESPACE_ID_PATTERN,
  SOURCE_NAMESPACE_SCHEME,
  isValidSourceNamespaceId,
  makeSourceNamespace,
  sourceNamespaceIdProblem,
} from "./sourceNamespace";
import { canonicalLeakInstanceKey, type CandidateLeakInstanceIdentity } from "./leakInstanceIdentity";
import { INDEPENDENT_SOURCE_SYSTEMS, isIndependentSource, makeEvidence } from "../domain/evidence";
import { deriveEvidenceRole, ROLE_MAP_VERSION } from "../../server/domain/evidenceRole";

const BASE: CandidateLeakInstanceIdentity = Object.freeze({
  boundaryId: "boundary-alpha",
  recoveryType: "ActivationMissed",
  sourceNamespaceId: "ns-billing-primary",
  obligationRef: "OBL-100045",
});

describe("EP-31d · SourceNamespace", () => {
  it("1 · accepts an instance-grained id and rejects malformed ones", () => {
    expect(isValidSourceNamespaceId("ns-billing-primary")).toBe(true);
    expect(isValidSourceNamespaceId("billing-eu-01")).toBe(true);
    expect(SOURCE_NAMESPACE_SCHEME).toBe("nh-source-namespace-v1");
    for (const bad of ["", "ab", " ns-billing ", "NS-Billing", "-leading", "ns billing", 7, null]) {
      expect(isValidSourceNamespaceId(bad as unknown)).toBe(false);
      expect(sourceNamespaceIdProblem(bad as unknown)).toMatch(/sourceNamespaceId/);
    }
    expect(isValidSourceNamespaceId("x".repeat(64))).toBe(true);
    expect(isValidSourceNamespaceId("x".repeat(65))).toBe(false);
  });

  it("2 · case is NOT normalised, because two spellings must not become one identity silently", () => {
    // Lowercasing here would mean a governance record and a candidate identity could disagree about
    // which namespace was registered. Refusing is the honest answer; normalising is a decision.
    expect(isValidSourceNamespaceId("NS-Billing")).toBe(false);
    expect(canonicalLeakInstanceKey(BASE)).toContain("ns-billing-primary");
  });

  it("3 · REFUSES every class-grained evidence source system name", () => {
    // The central guard of this commit: "billing" already means an evidence CLASS. Reusing it as an
    // instance namespace would put one string in two meanings, and the proof path reads it.
    expect([...RESERVED_NAMESPACE_IDS]).toEqual([...INDEPENDENT_SOURCE_SYSTEMS]);
    for (const reserved of INDEPENDENT_SOURCE_SYSTEMS) {
      expect(isValidSourceNamespaceId(reserved)).toBe(false);
      expect(sourceNamespaceIdProblem(reserved)).toMatch(/class-grained/);
    }
    // The reserved list is READ from the real constant, so it cannot drift from it.
    const source = readFileSync(new URL("./sourceNamespace.ts", import.meta.url), "utf8");
    expect(source).toMatch(/import \{ INDEPENDENT_SOURCE_SYSTEMS \} from "\.\.\/domain\/evidence"/);
  });

  it("4 · the label is descriptive and never reaches an identity", () => {
    // The `datasetId` lesson, applied before it can bite: renaming must not mint a second identity.
    const a = makeSourceNamespace({ sourceNamespaceId: "ns-billing-primary", label: "Billing (prod)" });
    const b = makeSourceNamespace({ sourceNamespaceId: "ns-billing-primary", label: "RENAMED" });
    expect(a.sourceNamespaceId).toBe(b.sourceNamespaceId);
    expect(canonicalLeakInstanceKey({ ...BASE, sourceNamespaceId: a.sourceNamespaceId })).toBe(
      canonicalLeakInstanceKey({ ...BASE, sourceNamespaceId: b.sourceNamespaceId }),
    );
    expect(Object.isFrozen(a)).toBe(true);
    expect(() => makeSourceNamespace({ sourceNamespaceId: "billing", label: "x" })).toThrow(/class-grained/);
    expect(() => makeSourceNamespace({ sourceNamespaceId: "ns-ok", label: "  " })).toThrow(/label/);
  });

  it("5 · CONTROL A · a different evidence keyId yields the SAME leak-instance identity", () => {
    // Layer 2 must not reach layer 1. Two signing keys for one source — a rotation, or two keys held
    // by one system — reference the same namespace, so the candidate identity is unmoved.
    const keys = [
      { keyId: "KEY-2026-A", sourceNamespaceId: "ns-billing-primary" },
      { keyId: "KEY-2026-B", sourceNamespaceId: "ns-billing-primary" },
    ];
    const identities = keys.map((k) =>
      canonicalLeakInstanceKey({ ...BASE, sourceNamespaceId: k.sourceNamespaceId }),
    );
    expect(identities[0]).toBe(identities[1]);
    expect(keys[0]!.keyId).not.toBe(keys[1]!.keyId);
    // And the key id is nowhere in the encoded identity at all.
    expect(identities[0]).not.toContain("KEY-2026");
  });

  it("6 · the proof/evidence path is UNTOUCHED by this commit", () => {
    // Asserted against the real modules rather than by reading the diff: if any of these moved, an
    // instance-grained namespace would have changed what evidence means, which is the one outcome the
    // header argues must not happen.
    expect([...INDEPENDENT_SOURCE_SYSTEMS]).toEqual(["billing", "product", "crm", "external"]);
    expect(isIndependentSource("billing")).toBe(true);
    expect(isIndependentSource("ns-billing-primary")).toBe(false);
    expect(deriveEvidenceRole("billing", "invoice_paid")).toBe("outcome");
    expect(deriveEvidenceRole("billing", "activation_event")).toBe("supporting");
    expect(deriveEvidenceRole("ns-billing-primary", "invoice_paid")).toBe("supporting");
    expect(ROLE_MAP_VERSION).toBe("evidence-role-2026.1");
    const evidence = makeEvidence({
      evidenceId: "EV-1", evidenceType: "invoice_paid", sourceSystem: "billing",
      sourceRecordId: "R-1", observedAt: "2026-01-01", ingestedAt: "2026-01-02",
      trustClassification: "independent", suppliedBy: "actor-1",
    });
    expect(evidence.trustClassification).toBe("independent");
    expect(evidence.beneficiaryControl).toBe(false);
  });

  it("7 · this module holds NO registry — a namespace is not authoritative because a type exists", () => {
    // CODE only, not prose: the header legitimately NAMES `NH_EVIDENCE_SOURCE_KEYS` in order to explain
    // why it is not used, and an assertion that could not tell the two apart would forbid the
    // explanation rather than the dependency. Every comment in this module is a full line, so dropping
    // comment lines is exact here.
    const source = readFileSync(new URL("./sourceNamespace.ts", import.meta.url), "utf8")
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");
    // No persistence, no environment parsing, no lifecycle. Governance of namespaces is a later object.
    for (const forbidden of ["prisma", "process.env", "node:fs", "createHmac", "NH_EVIDENCE_SOURCE_KEYS"]) {
      expect(source).not.toContain(forbidden);
    }
    expect(SOURCE_NAMESPACE_ID_PATTERN.source).toBe("^[a-z0-9][a-z0-9._-]{2,63}$");
  });
});

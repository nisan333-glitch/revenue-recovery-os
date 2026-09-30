// Step 5 · The three governance pairs end to end, and the separation the customer side cannot bypass.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "../db";
import type { ActorContext } from "../auth/identity";
import {
  activateBoundarySourceSet, activateDatasetSourceBinding, activateSourceNamespace,
  proposeBoundarySourceSet, proposeDatasetSourceBinding, proposeSourceNamespace, readSourceGovernance,
} from "./sourceAuthorityService";
import { resolveSourceNamespace } from "../../src/contract/sourceNamespace";

const B = () => `SYNTHETIC-boundary-${randomUUID().slice(0, 8)}`;
const NS = () => `ns-test-${randomUUID().slice(0, 8)}`;
const FP = () => randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
const operator = (id = "op@x"): ActorContext => ({ actorId: id, role: "operator", boundaryIds: ["*"] });
const steward = (id = "gov@x"): ActorContext => ({ actorId: id, role: "steward", boundaryIds: ["*"] });

async function sight(boundaryId: string, datasetFingerprint: string): Promise<void> {
  await prisma.pilotDatasetSightingRecord.create({ data: { boundaryId, datasetFingerprint } });
}

describe("Step 5 · governed source authority", () => {
  it("1 · a namespace is proposed by the customer side and activated by governance", async () => {
    const ns = NS();
    const proposed = await proposeSourceNamespace(operator(), {
      namespaceId: ns, namespaceVersion: "1.0.0", label: "Billing (prod)", rationale: "pilot source",
    });
    expect(proposed.state).toBe("DRAFT");
    const activated = await activateSourceNamespace(steward(), {
      namespaceId: ns, namespaceVersion: "1.0.0", rationale: "reviewed",
    });
    expect(activated).toEqual({ activated: "1.0.0", retired: null });
  });

  it("2 · the customer side CANNOT activate, and the proposer cannot activate their own proposal", async () => {
    const ns = NS();
    await proposeSourceNamespace(operator("same@x"), {
      namespaceId: ns, namespaceVersion: "1.0.0", label: "L", rationale: "r",
    });
    // Least privilege: an operator has no activate permission at all.
    await expect(activateSourceNamespace(operator(), {
      namespaceId: ns, namespaceVersion: "1.0.0", rationale: "r",
    })).rejects.toThrow();
    // Separation of duties on the ACTOR ID: a steward who also proposed it is still refused.
    await expect(activateSourceNamespace(
      { actorId: "same@x", role: "steward", boundaryIds: ["*"] }, { namespaceId: ns, namespaceVersion: "1.0.0", rationale: "r" },
    )).rejects.toThrow(/separation of duties/);
  });

  it("3 · the four evidence CLASS names are refused as namespace ids", async () => {
    for (const reserved of ["billing", "product", "crm", "external"]) {
      await expect(proposeSourceNamespace(operator(), {
        namespaceId: reserved, namespaceVersion: "1.0.0", label: "L", rationale: "r",
      })).rejects.toThrow(/class-grained/);
    }
  });

  it("4 · a governance transition without a stated reason is refused", async () => {
    const ns = NS();
    await expect(proposeSourceNamespace(operator(), {
      namespaceId: ns, namespaceVersion: "1.0.0", label: "L", rationale: "   ",
    })).rejects.toThrow(/stated reason/);
  });

  it("5 · END TO END · a single-source boundary resolves by INHERITANCE", async () => {
    const boundaryId = B(); const ns = NS(); const fingerprint = FP();
    await proposeSourceNamespace(operator(), { namespaceId: ns, namespaceVersion: "1.0.0", label: "Billing (prod)", rationale: "r" });
    await activateSourceNamespace(steward(), { namespaceId: ns, namespaceVersion: "1.0.0", rationale: "r" });
    await proposeBoundarySourceSet(operator(), { boundaryId, setId: "set-a", setVersion: "1", memberNamespaceIds: [ns], rationale: "r" });
    await activateBoundarySourceSet(steward(), { boundaryId, setId: "set-a", setVersion: "1", rationale: "r" });
    // The dataset is sighted AFTER the set was activated, so authority predates the data.
    await sight(boundaryId, fingerprint);
    const governance = await readSourceGovernance(boundaryId, fingerprint);
    const resolved = resolveSourceNamespace({
      boundaryId, datasetFingerprint: fingerprint, firstSeenAt: new Date().toISOString(),
      declaredBillingSource: "Billing (prod)", ...governance,
    });
    expect(resolved).toMatchObject({
      resolved: true,
      lineage: { sourceNamespaceId: ns, sourceNamespaceVersion: "1.0.0", sourceBindingMode: "inherited",
        sourcePermittedSetId: "set-a", sourcePermittedSetVersion: "1", sourceBindingRevision: null },
    });
  });

  it("6 · END TO END · a TWO-source boundary refuses inheritance and resolves only when bound explicitly", async () => {
    const boundaryId = B(); const nsA = NS(); const nsB = NS(); const fingerprint = FP();
    for (const [id, label] of [[nsA, "Billing A"], [nsB, "Billing B"]] as const) {
      await proposeSourceNamespace(operator(), { namespaceId: id, namespaceVersion: "1", label, rationale: "r" });
      await activateSourceNamespace(steward(), { namespaceId: id, namespaceVersion: "1", rationale: "r" });
    }
    await proposeBoundarySourceSet(operator(), { boundaryId, setId: "set-a", setVersion: "1", memberNamespaceIds: [nsA, nsB], rationale: "r" });
    await activateBoundarySourceSet(steward(), { boundaryId, setId: "set-a", setVersion: "1", rationale: "r" });
    await sight(boundaryId, fingerprint);

    const before = await readSourceGovernance(boundaryId, fingerprint);
    expect(resolveSourceNamespace({
      boundaryId, datasetFingerprint: fingerprint, firstSeenAt: new Date().toISOString(),
      declaredBillingSource: "", ...before,
    })).toMatchObject({ resolved: false, reason: "source_namespace_ambiguous" });

    // An explicit binding decides it — which is exactly what a multi-source boundary needs.
    const { revision } = await proposeDatasetSourceBinding(operator(), {
      boundaryId, datasetFingerprint: fingerprint, namespaceId: nsB, rationale: "extract came from B",
    });
    await activateDatasetSourceBinding(steward(), { boundaryId, datasetFingerprint: fingerprint, revision, rationale: "verified" });
    const after = await readSourceGovernance(boundaryId, fingerprint);
    expect(resolveSourceNamespace({
      boundaryId, datasetFingerprint: fingerprint, firstSeenAt: new Date().toISOString(),
      declaredBillingSource: "Billing B", ...after,
    })).toMatchObject({ resolved: true, lineage: { sourceNamespaceId: nsB, sourceBindingMode: "explicit", sourceBindingRevision: revision } });
  });

  it("7 · THE CORRECTION WINDOW · a retired binding refuses and does NOT inherit", async () => {
    const boundaryId = B(); const ns = NS(); const fingerprint = FP();
    await proposeSourceNamespace(operator(), { namespaceId: ns, namespaceVersion: "1", label: "Billing (prod)", rationale: "r" });
    await activateSourceNamespace(steward(), { namespaceId: ns, namespaceVersion: "1", rationale: "r" });
    // A perfectly valid single-member inheritance path exists throughout this test.
    await proposeBoundarySourceSet(operator(), { boundaryId, setId: "set-a", setVersion: "1", memberNamespaceIds: [ns], rationale: "r" });
    await activateBoundarySourceSet(steward(), { boundaryId, setId: "set-a", setVersion: "1", rationale: "r" });
    await sight(boundaryId, fingerprint);

    const { revision } = await proposeDatasetSourceBinding(operator(), {
      boundaryId, datasetFingerprint: fingerprint, namespaceId: ns, rationale: "bound",
    });
    await activateDatasetSourceBinding(steward(), { boundaryId, datasetFingerprint: fingerprint, revision, rationale: "r" });

    // Correct it: propose a replacement and retire the incumbent atomically.
    const replacement = await proposeDatasetSourceBinding(operator(), {
      boundaryId, datasetFingerprint: fingerprint, namespaceId: ns, rationale: "corrected",
    });
    const swap = await activateDatasetSourceBinding(steward(), {
      boundaryId, datasetFingerprint: fingerprint, revision: replacement.revision, rationale: "correction",
      replaces: revision,
    });
    expect(swap).toEqual({ activated: String(replacement.revision), retired: String(revision) });

    // And the mid-correction state — a retired revision with a DRAFT replacement — must refuse, not inherit.
    const third = await proposeDatasetSourceBinding(operator(), {
      boundaryId, datasetFingerprint: fingerprint, namespaceId: ns, rationale: "third",
    });
    await activateDatasetSourceBinding(steward(), {
      boundaryId, datasetFingerprint: fingerprint, revision: third.revision, rationale: "r",
      replaces: replacement.revision,
    });
    // Retire the last ACTIVE one with no replacement, leaving history and zero active.
    await prisma.pilotDatasetSourceBindingEventRecord.create({
      data: { id: randomUUID(), boundaryId, datasetFingerprint: fingerprint, revision: third.revision,
        transition: "RETIRED", actorId: "gov2@x", actorRole: "steward", rationale: "withdrawn" },
    });
    const governance = await readSourceGovernance(boundaryId, fingerprint);
    expect(governance.bindingRevisions.filter((b) => b.state === "ACTIVE")).toHaveLength(0);
    expect(resolveSourceNamespace({
      boundaryId, datasetFingerprint: fingerprint, firstSeenAt: new Date().toISOString(),
      declaredBillingSource: "", ...governance,
    })).toMatchObject({ resolved: false, reason: "source_binding_retired_without_replacement" });
  });

  it("8 · authority activated AFTER the bytes were seen cannot govern them", async () => {
    const boundaryId = B(); const ns = NS(); const fingerprint = FP();
    await sight(boundaryId, fingerprint); // seen FIRST
    await proposeSourceNamespace(operator(), { namespaceId: ns, namespaceVersion: "1", label: "L", rationale: "r" });
    await activateSourceNamespace(steward(), { namespaceId: ns, namespaceVersion: "1", rationale: "r" });
    await proposeBoundarySourceSet(operator(), { boundaryId, setId: "set-a", setVersion: "1", memberNamespaceIds: [ns], rationale: "r" });
    await activateBoundarySourceSet(steward(), { boundaryId, setId: "set-a", setVersion: "1", rationale: "r" });
    const sighting = await prisma.pilotDatasetSightingRecord.findUniqueOrThrow({
      where: { boundaryId_datasetFingerprint: { boundaryId, datasetFingerprint: fingerprint } },
    });
    const governance = await readSourceGovernance(boundaryId, fingerprint);
    expect(resolveSourceNamespace({
      boundaryId, datasetFingerprint: fingerprint, firstSeenAt: sighting.firstSeenAt.toISOString(),
      declaredBillingSource: "", ...governance,
    })).toMatchObject({ resolved: false, reason: "source_binding_postdates_sighting" });
  });

  it("9 · a set naming an unregistered namespace is refused by the database", async () => {
    const boundaryId = B();
    await expect(proposeBoundarySourceSet(operator(), {
      boundaryId, setId: "set-a", setVersion: "1", memberNamespaceIds: ["ns-never-registered"], rationale: "r",
    })).rejects.toThrow();
  });

  it("10 · a binding for bytes never sighted is refused by the database", async () => {
    const boundaryId = B(); const ns = NS();
    await proposeSourceNamespace(operator(), { namespaceId: ns, namespaceVersion: "1", label: "L", rationale: "r" });
    await expect(proposeDatasetSourceBinding(operator(), {
      boundaryId, datasetFingerprint: FP(), namespaceId: ns, rationale: "r",
    })).rejects.toThrow();
  });
});

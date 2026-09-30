// Step 5/7 · The wiring. Lineage is stamped when authority exists, absent when it does not, and ORDINARY
// ASSESSMENT IS IDENTICAL EITHER WAY — which is the invariant the whole step is built around.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "../db";
import { SOURCE_NAMESPACE_RESOLUTION_AVAILABLE, leakInstanceIdentityStatus } from "../../src/contract/leakInstanceIdentity";
import { deriveExecutionId, hashExecutionBinding, type ExecutionBinding } from "../../src/contract/assessmentExecution";
import { createExecutionIfAbsent } from "../persistence/pilotExecutionStore";
import { sourceResolutionHash } from "../../src/contract/sourceNamespace";
import { projectExecutionInput } from "../../src/contract/assessmentExecution";
import type { ExpectationCycle } from "../../src/assessment/types";
import { money } from "../../src/domain/money";

const FP = () => randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");

/**
 * A real projected input with ONE cycle. `cycles: []` is refused by `cycle_count > 0` — the table insists an
 * execution ran on something — so the projection is built from a genuine cycle rather than faked.
 */
function projectedInput() {
  const cycle: ExpectationCycle = {
    cycleId: "c-1", sourceRowId: "row-1", entityId: "acct-1",
    expectationAt: "2026-01-01", observationAt: null, currency: "USD", statusRaw: null, attributes: {},
    monetaryEvent: { dueAt: "2026-02-01", amount: money(50_000, "USD"), paidAt: null, paidAmount: null,
      refundedAt: null, cancelledAt: null },
  };
  return projectExecutionInput([cycle]);
}

function binding(boundaryId: string, datasetFingerprint: string): ExecutionBinding {
  return {
    boundaryId, datasetFingerprint,
    admissionDecisionId: "AD-1", admissionPolicyId: "bar", admissionPolicyVersion: "1",
    admissionPolicyHash: `sha256:${"a".repeat(64)}`, contractVersion: "2.0.0",
    assessmentPolicy: { policyId: "p", policyVersion: "1", calculationMethodVersion: "calc-1",
      asOf: "2026-06-30", stallThresholdDays: 30, currency: "USD" },
    interpretation: { mappingId: "m-1", amountFormat: "auto", dateLocale: "auto" },
    recoveryCaseId: null,
  };
}

describe("Step 5/7 · source lineage on the execution", () => {
  it("1 · the execution IDENTITY is unchanged by the lineage — it is not in the hashed binding", async () => {
    // The load-bearing property: `deriveExecutionId` is the idempotency key, so two schedules of the same
    // submission must collide whether or not a source resolution happened.
    const boundaryId = `SYNTHETIC-b-${randomUUID().slice(0, 8)}`;
    const fingerprint = FP();
    const b = binding(boundaryId, fingerprint);
    const executionId = await deriveExecutionId(b);
    const bindingHash = await hashExecutionBinding(b);
    const lineage = {
      sourceNamespaceId: "ns-billing-primary", sourceNamespaceVersion: "1.0.0",
      sourceBindingMode: "inherited", sourcePermittedSetId: "set-a", sourcePermittedSetVersion: "1",
      sourceBindingRevision: null,
    };
    const first = await createExecutionIfAbsent({
      executionId, binding: b, bindingHash, inputHash: `sha256:${"b".repeat(64)}`,
      input: projectedInput(),
      scheduledByActorId: "a", scheduledByRole: "author", attributions: [],
      sourceResolution: { ...lineage, sourceResolutionHash: await sourceResolutionHash(boundaryId, fingerprint, lineage) },
    });
    expect(first.created).toBe(true);
    // The SAME binding with NO resolution derives the SAME id, so it is recognised as a repeat.
    const repeat = await createExecutionIfAbsent({
      executionId: await deriveExecutionId(b), binding: b, bindingHash, inputHash: `sha256:${"b".repeat(64)}`,
      input: projectedInput(),
      scheduledByActorId: "a", scheduledByRole: "author", attributions: [], sourceResolution: null,
    });
    expect(repeat.created).toBe(false);
    expect(repeat.execution.executionId).toBe(executionId);

    const row = await prisma.pilotAssessmentExecutionRecord.findUniqueOrThrow({ where: { executionId } });
    expect(row.sourceNamespaceId).toBe("ns-billing-primary");
    expect(row.sourceNamespaceVersion).toBe("1.0.0");
    expect(row.sourceBindingMode).toBe("inherited");
    expect(row.sourcePermittedSetId).toBe("set-a");
    expect(row.sourceBindingRevision).toBeNull();
    expect(row.sourceResolutionHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("2 · an execution with NO resolved authority stores NULL lineage and is otherwise normal", async () => {
    const boundaryId = `SYNTHETIC-b-${randomUUID().slice(0, 8)}`;
    const b = binding(boundaryId, FP());
    const executionId = await deriveExecutionId(b);
    const { created } = await createExecutionIfAbsent({
      executionId, binding: b, bindingHash: await hashExecutionBinding(b), inputHash: `sha256:${"c".repeat(64)}`,
      input: projectedInput(),
      scheduledByActorId: "a", scheduledByRole: "author", attributions: [], sourceResolution: null,
    });
    expect(created).toBe(true);
    const row = await prisma.pilotAssessmentExecutionRecord.findUniqueOrThrow({ where: { executionId } });
    for (const v of [row.sourceNamespaceId, row.sourceNamespaceVersion, row.sourceBindingMode,
      row.sourcePermittedSetId, row.sourcePermittedSetVersion, row.sourceBindingRevision, row.sourceResolutionHash]) {
      expect(v).toBeNull();
    }
    // Everything that makes an execution an execution is untouched.
    expect(row.bindingHash).toBe(await hashExecutionBinding(b));
    expect(row.contractVersion).toBe("2.0.0");
  });

  it("3 · a stamped lineage cannot be edited afterwards", async () => {
    const boundaryId = `SYNTHETIC-b-${randomUUID().slice(0, 8)}`;
    const b = binding(boundaryId, FP());
    const executionId = await deriveExecutionId(b);
    await createExecutionIfAbsent({
      executionId, binding: b, bindingHash: await hashExecutionBinding(b), inputHash: `sha256:${"d".repeat(64)}`,
      input: projectedInput(),
      scheduledByActorId: "a", scheduledByRole: "author", attributions: [], sourceResolution: null,
    });
    // Immutability here comes from the append-only trigger, not from the binding hash — which is exactly why
    // the hash's silence about these columns is safe.
    await expect(
      prisma.$executeRaw`UPDATE pilot_assessment_executions SET source_namespace_id = 'ns-injected' WHERE execution_id = ${executionId}`,
    ).rejects.toThrow(/append-only/);
  });

  it("4 · THE GATE · the namespace prerequisite is closed; emission is still refused on the other one", () => {
    // Step 5 made an authoritative namespace resolvable. It did NOT add an obligation identifier, and could
    // not: that is a data-contract change, explicitly out of scope. So emission stays blocked, and it names
    // the REMAINING reason rather than the one that was closed.
    expect(SOURCE_NAMESPACE_RESOLUTION_AVAILABLE).toBe(true);
    const status = leakInstanceIdentityStatus();
    expect(status.establishable).toBe(false);
    expect(status.reason).toBe("leak_instance_identity_unavailable");
  });
});

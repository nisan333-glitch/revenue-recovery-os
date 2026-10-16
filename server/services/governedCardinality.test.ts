// Step 5 · Proving that SERIALIZATION ALONE IS NOT ENOUGH.
//
// The claim under test is not "a lock exists" but "two concurrent activations cannot leave two ACTIVE
// authorities". Those are different claims: two transactions can serialize perfectly and both still activate
// if the second never re-reads. So every control here is paired with a FALSIFIER — the same scenario run
// against a deliberately naive activation — and the falsifier must produce the broken state. A control whose
// failure mode cannot be demonstrated proves nothing.
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../db";
import { deriveState, type PolicyLifecycleEvent } from "../../src/contract/policyLifecycle";
import {
  activeSubjects,
  lockScope,
  withCardinalityGuardedActivation,
  type ScopedSubject,
} from "./governedCardinality";

const NS = () => `ns-test-${randomUUID().slice(0, 8)}`;

async function registerNamespaceWithVersions(namespaceId: string, versions: readonly string[]): Promise<void> {
  await prisma.pilotSourceNamespaceRecord.create({
    data: { namespaceId, registeredByActorId: "operator@x", registeredByRole: "operator" },
  });
  for (const namespaceVersion of versions) {
    await prisma.pilotSourceNamespaceVersionRecord.create({
      data: { namespaceId, namespaceVersion, label: `Billing ${namespaceVersion}`,
        registeredByActorId: "operator@x", registeredByRole: "operator" },
    });
    await prisma.pilotSourceNamespaceEventRecord.create({
      data: { id: randomUUID(), namespaceId, namespaceVersion, transition: "PROPOSED",
        actorId: "operator@x", actorRole: "operator", rationale: "proposed for test" },
    });
  }
}

/** Read every version of a namespace with its event log — the scope, as the guard requires. */
async function readScope(namespaceId: string, client: typeof prisma | Parameters<Parameters<typeof prisma.$transaction>[0]>[0] = prisma): Promise<readonly ScopedSubject[]> {
  const versions = await client.pilotSourceNamespaceVersionRecord.findMany({ where: { namespaceId } });
  const out: ScopedSubject[] = [];
  for (const v of versions) {
    const rows = await client.pilotSourceNamespaceEventRecord.findMany({
      where: { namespaceId, namespaceVersion: v.namespaceVersion }, orderBy: { at: "asc" },
    });
    out.push({
      subjectKey: v.namespaceVersion,
      events: rows.map((r): PolicyLifecycleEvent => ({
        transition: r.transition as PolicyLifecycleEvent["transition"],
        actorId: r.actorId, actorRole: r.actorRole, rationale: r.rationale, at: r.at.toISOString(),
      })),
    });
  }
  return out;
}

async function activeVersions(namespaceId: string): Promise<readonly string[]> {
  return activeSubjects(await readScope(namespaceId)).map((s) => s.subjectKey).sort();
}

const guarded = (namespaceId: string, version: string, mode: "activate" | "replace", replaces?: string) =>
  withCardinalityGuardedActivation({
    scopeKey: `nh-source-namespace:${namespaceId}`,
    mode, subjectKey: version, replacesSubjectKey: replaces,
    reread: (tx) => readScope(namespaceId, tx),
    append: async (tx, subjectKey, transition) => {
      await tx.pilotSourceNamespaceEventRecord.create({
        data: { id: randomUUID(), namespaceId, namespaceVersion: subjectKey, transition,
          actorId: "steward@x", actorRole: "steward", rationale: `${transition} under the cardinality guard` },
      });
    },
  });

/**
 * THE FALSIFIER. Locks the scope but does NOT re-read inside the transaction — it trusts a state read
 * before the lock was taken. This is exactly the shape of the existing `transitionAnalysisTerms`, and it is
 * what the controls below must be able to catch.
 */
async function naiveActivate(namespaceId: string, version: string): Promise<void> {
  const stale = await readScope(namespaceId); // read BEFORE the lock — the defect
  const self = stale.find((s) => s.subjectKey === version)!;
  if (deriveState([...self.events]) !== "DRAFT") throw new Error("not activatable");
  await prisma.$transaction(async (tx) => {
    await lockScope(`nh-source-namespace:${namespaceId}`, tx);
    await tx.pilotSourceNamespaceEventRecord.create({
      data: { id: randomUUID(), namespaceId, namespaceVersion: version, transition: "ACTIVATED",
        actorId: "steward@x", actorRole: "steward", rationale: "activated without re-reading" },
    });
  });
}

describe("Step 5 · cardinality-guarded activation", () => {
  beforeEach(() => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for this suite");
  });

  it("1 · FALSIFIER · locking without re-reading leaves TWO ACTIVE versions", async () => {
    // The control this file exists for is only meaningful if the broken state is reachable. It is.
    const ns = NS();
    await registerNamespaceWithVersions(ns, ["1.0.0", "2.0.0"]);
    await Promise.all([naiveActivate(ns, "1.0.0"), naiveActivate(ns, "2.0.0")]);
    expect(await activeVersions(ns)).toEqual(["1.0.0", "2.0.0"]);
  });

  it("2 · two CONCURRENT guarded activations leave exactly ONE ACTIVE", async () => {
    const ns = NS();
    await registerNamespaceWithVersions(ns, ["1.0.0", "2.0.0"]);
    const results = await Promise.allSettled([guarded(ns, "1.0.0", "activate"), guarded(ns, "2.0.0", "activate")]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason.message).toMatch(/already active in this scope/);
    const active = await activeVersions(ns);
    expect(active).toHaveLength(1);
    expect(active[0]).toBe((fulfilled[0] as PromiseFulfilledResult<{ activated: string }>).value.activated);
  });

  it("3 · repeated under contention, the invariant never breaks", async () => {
    // One run could be luck. Five independent scopes, each with three racing activations.
    for (let i = 0; i < 5; i += 1) {
      const ns = NS();
      await registerNamespaceWithVersions(ns, ["1.0.0", "2.0.0", "3.0.0"]);
      await Promise.allSettled([
        guarded(ns, "1.0.0", "activate"), guarded(ns, "2.0.0", "activate"), guarded(ns, "3.0.0", "activate"),
      ]);
      expect(await activeVersions(ns), `scope ${i}`).toHaveLength(1);
    }
  });

  it("4 · a sequential second activation is refused — no implicit displacement", async () => {
    const ns = NS();
    await registerNamespaceWithVersions(ns, ["1.0.0", "2.0.0"]);
    await guarded(ns, "1.0.0", "activate");
    await expect(guarded(ns, "2.0.0", "activate")).rejects.toThrow(/does not implicitly displace an incumbent/);
    expect(await activeVersions(ns)).toEqual(["1.0.0"]);
  });

  it("5 · REPLACE retires and activates atomically — never zero, never two", async () => {
    const ns = NS();
    await registerNamespaceWithVersions(ns, ["1.0.0", "2.0.0"]);
    await guarded(ns, "1.0.0", "activate");
    const outcome = await guarded(ns, "2.0.0", "replace", "1.0.0");
    expect(outcome).toEqual({ activated: "2.0.0", retired: "1.0.0" });
    expect(await activeVersions(ns)).toEqual(["2.0.0"]);
    // RETIRED is terminal, so the replaced version can never come back — and its history is intact.
    const scope = await readScope(ns);
    expect(deriveState([...scope.find((s) => s.subjectKey === "1.0.0")!.events])).toBe("RETIRED");
  });

  it("6 · REPLACE must name the incumbent, and must name the RIGHT one", async () => {
    const ns = NS();
    await registerNamespaceWithVersions(ns, ["1.0.0", "2.0.0", "3.0.0"]);
    await guarded(ns, "1.0.0", "activate");
    await expect(guarded(ns, "2.0.0", "replace")).rejects.toThrow(/must name the authority it replaces/);
    await expect(guarded(ns, "2.0.0", "replace", "3.0.0")).rejects.toThrow(/not the sole active authority/);
    expect(await activeVersions(ns)).toEqual(["1.0.0"]);
  });

  it("7 · a failed REPLACE leaves the incumbent ACTIVE — no partial retire survives", async () => {
    const ns = NS();
    await registerNamespaceWithVersions(ns, ["1.0.0", "2.0.0"]);
    await guarded(ns, "1.0.0", "activate");
    // Fail AFTER the retire has been appended inside the transaction. Rollback must undo it.
    let appends = 0;
    await expect(
      withCardinalityGuardedActivation({
        scopeKey: `nh-source-namespace:${ns}`, mode: "replace", subjectKey: "2.0.0", replacesSubjectKey: "1.0.0",
        reread: (tx) => readScope(ns, tx),
        append: async (tx, subjectKey, transition) => {
          appends += 1;
          if (appends > 1) throw new Error("injected failure after the retire was written");
          await tx.pilotSourceNamespaceEventRecord.create({
            data: { id: randomUUID(), namespaceId: ns, namespaceVersion: subjectKey, transition,
              actorId: "steward@x", actorRole: "steward", rationale: "partial replace" },
          });
        },
      }),
    ).rejects.toThrow(/injected failure/);
    expect(appends).toBeGreaterThan(1); // the failure provably landed mid-replacement
    expect(await activeVersions(ns)).toEqual(["1.0.0"]);
  });

  it("8 · activation is refused from a state that may not activate", async () => {
    const ns = NS();
    await registerNamespaceWithVersions(ns, ["1.0.0"]);
    await guarded(ns, "1.0.0", "activate");
    await expect(guarded(ns, "1.0.0", "activate")).rejects.toThrow(/cannot activate from ACTIVE/);
    await expect(guarded(ns, "9.9.9", "activate")).rejects.toThrow(/does not exist in this scope/);
  });
});

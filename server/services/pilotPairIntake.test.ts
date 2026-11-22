// T1 · the two-extract intake, exercised positively and negatively with no database.
//
// THE FIXTURES ARE THE COMMITTED CUSTOMER EXAMPLES, not shapes invented here. `docs/pilot-intake/`
// holds the two files a customer is actually asked to send, and `pilot:verify` already runs them
// through the real validators — so a test that passes on them is testing what a real export meets.
// Where a case needs something the examples do not contain, the example is EXTENDED by appending a
// row, never replaced by a hand-made file.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PAIR_MAX_BYTES,
  PAIR_MAX_ROWS,
  PILOT_PAIR_INTAKE_VERSION,
  submitPilotPair,
  type PairTaskQueue,
} from "./pilotPairIntakeService";
import { RECONCILIATION_AGENT_ID } from "../agents/reconciliationObserver";
import type { ActorContext } from "../auth/identity";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const EXPECTATION = readFileSync(resolve(REPO, "docs/pilot-intake/expectation_example.csv"), "utf8");
const BILLING = readFileSync(resolve(REPO, "docs/pilot-intake/billing_example.csv"), "utf8");

const BOUNDARY = "pb-pair-intake";
const OPERATOR: ActorContext = { actorId: "op-1", role: "operator", boundaryIds: [BOUNDARY] };
const AUTHOR: ActorContext = { actorId: "au-1", role: "author", boundaryIds: [BOUNDARY] };
const APPROVER: ActorContext = { actorId: "ap-1", role: "approver", boundaryIds: [BOUNDARY] };
const STEWARD: ActorContext = { actorId: "st-1", role: "steward", boundaryIds: [BOUNDARY] };
const OTHER_TENANT: ActorContext = { actorId: "op-9", role: "operator", boundaryIds: ["pb-elsewhere"] };

/** A queue that records what it was asked to enqueue and enforces ON CONFLICT DO NOTHING. */
class MemoryQueue implements PairTaskQueue {
  readonly enqueued: { taskId: string; boundaryId: string; agentId: string; idempotencyKey: string;
    payload: Record<string, unknown> }[] = [];

  async enqueueIfAbsent(input: {
    taskId: string; boundaryId: string; agentId: string; idempotencyKey: string;
    payload: Readonly<Record<string, unknown>>; now: number;
  }): Promise<{ created: boolean }> {
    // THE REAL STORE'S PROPERTY, NOT A PERMISSIVE DOUBLE: a repeat of the same task id adds nothing.
    // A double more generous than its subject is how a wrong design survives.
    if (this.enqueued.some((t) => t.taskId === input.taskId)) return { created: false };
    this.enqueued.push({ ...input, payload: { ...input.payload } });
    return { created: true };
  }
}

const submit = (q: MemoryQueue, over: Partial<{ expectationCsv: string; billingCsv: string; currency: string; boundaryId: string }> = {}, actor = OPERATOR) =>
  submitPilotPair(q, actor, {
    boundaryId: over.boundaryId ?? BOUNDARY,
    expectationCsv: over.expectationCsv ?? EXPECTATION,
    billingCsv: over.billingCsv ?? BILLING,
    currency: over.currency ?? "USD",
  });

let q: MemoryQueue;
beforeEach(() => { q = new MemoryQueue(); });

describe("the positive path", () => {
  it("accepts the committed customer examples and enqueues ONE reconciliation task", async () => {
    const out = await submit(q);
    expect(out.accepted).toBe(true);
    expect(out.refusal).toBeNull();
    expect(out.queued).toBe(true);
    expect(q.enqueued).toHaveLength(1);
    expect(q.enqueued[0]!.agentId).toBe(RECONCILIATION_AGENT_ID);
    expect(q.enqueued[0]!.boundaryId).toBe(BOUNDARY);
    expect(out.taskId).toBe(q.enqueued[0]!.taskId);
  });

  it("reports the readiness level and the per-side counts, from the REAL evaluator", async () => {
    const out = await submit(q);
    expect(out.readinessLevel).toMatch(/^L[0-9]/);
    expect(out.expectation!.usable).toBe(true);
    expect(out.billing!.usable).toBe(true);
    expect(out.expectation!.acceptedRows).toBeGreaterThan(0);
    expect(out.billing!.acceptedRows).toBeGreaterThan(0);
  });

  it("the payload is exactly the five fields the observer accepts, and nothing else", async () => {
    // A SIXTH FIELD WOULD MAKE THE OBSERVER THROW — it refuses any payload whose key set differs —
    // so a task that can only fail would be queued and nobody would see it.
    await submit(q);
    expect(Object.keys(q.enqueued[0]!.payload).sort()).toEqual([
      "actionAvailable", "billing", "currency", "expectation", "observedAt",
    ]);
  });

  it("stamps `actionAvailable: true` and an `observedAt` the caller cannot choose", async () => {
    // `actionAvailable: false` makes the observer emit NO signals, so a request field for it would be
    // a silent switch for suppressing detection of one's own exposure.
    const before = Date.now();
    const out = await submit(q);
    const payload = q.enqueued[0]!.payload as { actionAvailable: boolean; observedAt: string };
    expect(payload.actionAvailable).toBe(true);
    expect(Date.parse(payload.observedAt)).toBeGreaterThanOrEqual(before - 1000);
    expect(Date.parse(payload.observedAt)).toBeLessThanOrEqual(Date.now() + 1000);
    expect(out.provisional).toBe(true);
  });

  it("says in the response what it did NOT establish", async () => {
    const out = await submit(q);
    expect(out.establishes).toMatch(/NO Recovery Case/);
    expect(out.establishes).toMatch(/NO proof/);
    expect(out.establishes).toMatch(/Revenue Opportunity/);
    expect(out.establishes).toMatch(/PROVISIONAL/);
  });
});

describe("idempotency — the first mechanism against a duplicate case", () => {
  it("the SAME pair submitted twice enqueues nothing the second time", async () => {
    const first = await submit(q);
    const second = await submit(q);
    expect(first.queued).toBe(true);
    expect(second.queued).toBe(false);
    expect(second.accepted).toBe(true);
    expect(second.taskId).toBe(first.taskId);
    expect(q.enqueued).toHaveLength(1);
  });

  it("a DIFFERENT pair enqueues a second task — the key is content, not a constant", async () => {
    // A guard that refused every second submission would satisfy the assertion above and be useless.
    await submit(q);
    await submit(q, { expectationCsv: `${EXPECTATION}ENT-2001,2026-04-01,2026-04-30,500.00,USD,PAYER-EAST,,,,,,SL-9100\n` });
    expect(q.enqueued).toHaveLength(2);
    expect(q.enqueued[0]!.taskId).not.toBe(q.enqueued[1]!.taskId);
  });

  it("the same files under a DIFFERENT governed term are a different observation", async () => {
    // The currency decides which rows count, so the same bytes read under another term is a
    // different reading and must not be absorbed as a repeat.
    await submit(q);
    const other = await submit(q, { currency: "EUR" });
    // EUR is structurally valid; whether rows survive it is the validators' business, not ours.
    expect(other.taskId === null || other.taskId !== q.enqueued[0]!.taskId).toBe(true);
  });

  it("one tenant's pair can never collide with another's", async () => {
    const a = await submit(q);
    const b = await submitPilotPair(q, { actorId: "op-2", role: "operator", boundaryIds: ["pb-second"] }, {
      boundaryId: "pb-second", expectationCsv: EXPECTATION, billingCsv: BILLING, currency: "USD",
    });
    expect(a.taskId).not.toBe(b.taskId);
    expect(q.enqueued).toHaveLength(2);
  });
});

describe("permissions", () => {
  it("the author and the operator may submit — both already hold SubmitPilotDataset", async () => {
    expect((await submit(q, {}, OPERATOR)).accepted).toBe(true);
    expect((await submit(new MemoryQueue(), {}, AUTHOR)).accepted).toBe(true);
  });

  it("the approver and the steward may NOT — no new capability and no new role was added", async () => {
    for (const actor of [APPROVER, STEWARD]) {
      await expect(submit(new MemoryQueue(), {}, actor)).rejects.toThrow();
    }
  });

  it("an actor who does not hold the boundary is refused, and learns NOTHING about the files", async () => {
    // THE BOUNDARY IS CHECKED FIRST, BEFORE ANYTHING IS PARSED. An actor who may not act for a tenant
    // must not learn whether that tenant's export even parses — so a malformed pair for a boundary
    // they do not hold must still fail on the boundary.
    const fresh = new MemoryQueue();
    await expect(
      submitPilotPair(fresh, OTHER_TENANT, {
        boundaryId: BOUNDARY, expectationCsv: "not,a,valid\nexport", billingCsv: "x", currency: "USD",
      }),
    ).rejects.toThrow();
    expect(fresh.enqueued).toHaveLength(0);
  });
});

describe("corrupt and malformed files are REFUSED, never enqueued", () => {
  it("a file that is not readable as CSV is refused with a transport code", async () => {
    const out = await submit(q, { expectationCsv: 'a,b\n"unterminated,1\n' });
    expect(out.accepted).toBe(false);
    expect(out.refusal).toBe("NH-PP-1001");
    expect(q.enqueued).toHaveLength(0);
  });

  it("a NUL byte is refused rather than carried into a hash preimage", async () => {
    const out = await submit(q, { billingCsv: `${BILLING}\u0000` });
    expect(out.refusal).toBe("NH-PP-1001");
    expect(q.enqueued).toHaveLength(0);
  });

  it("a mis-encoded export is refused, not transliterated", async () => {
    // `readFileSync(path, "utf8")` does not throw on invalid UTF-8 — Node substitutes U+FFFD — so a
    // cp1252 export from a European ERP would arrive with its identifiers quietly rewritten. An
    // identifier is a JOIN KEY, so a silently altered one is NH authoring the identity it reads.
    const out = await submit(q, { expectationCsv: EXPECTATION.replace("PAYER-NORTH", "PAYER-N�RTH") });
    expect(out.accepted).toBe(false);
    expect(q.enqueued).toHaveLength(0);
  });

  it("the WRONG FILE in the expectation slot is refused by the governed contract, with codes", async () => {
    // The most ordinary real mistake: the two exports swapped.
    const out = await submit(q, { expectationCsv: BILLING, billingCsv: EXPECTATION });
    expect(out.accepted).toBe(false);
    expect(out.refusal).toBe("NH-PP-1004");
    expect(out.refusalDetail).toMatch(/NH-(EX|BX)-\d{4}/);
    expect(q.enqueued).toHaveLength(0);
  });

  it("an empty export is refused and never read as `nothing was owed`", async () => {
    const out = await submit(q, { expectationCsv: `${EXPECTATION.split("\n")[0]}\n` });
    expect(out.accepted).toBe(false);
    expect(q.enqueued).toHaveLength(0);
  });

  it("a refusal carries CODES ONLY — never a cell, an identifier or an amount", async () => {
    // THE ATTACK, AND WHAT ACTUALLY STOPS IT HERE — measured, not assumed. A headerless export makes
    // the first DATA row the header, which is how `UNDECLARED_COLUMN`'s detail came to quote a real
    // entitlement reference and a real amount. Through THIS door it never reaches the validator at
    // all: both example files carry blank optional cells, so the promoted row has an empty column
    // name and `parseStrictCsv` refuses it as a TRANSPORT fault first. A second, stricter case below
    // drives a file that does reach the contract verdict.
    const headerless = EXPECTATION.split("\n").slice(1).join("\n");
    const out = await submit(q, { expectationCsv: headerless });
    expect(out.accepted).toBe(false);
    expect(out.refusal).toBe("NH-PP-1001");
    const rendered = JSON.stringify(out);
    for (const leak of ["ENT-1001", "PAYER-NORTH", "2400.00", "SL-7781"]) {
      expect(rendered, `the refusal leaked ${leak}`).not.toContain(leak);
    }
    for (const code of out.refusalDetail!.match(/NH-[A-Z]{2}-\d{4}/g) ?? []) {
      expect(code).toMatch(/^NH-(EX|BX)-\d{4}$/);
    }
  });

  it("a non-ISO currency is refused before anything is parsed", async () => {
    const out = await submit(q, { currency: "usd" });
    expect(out.refusal).toBe("NH-PP-1005");
    expect(out.readinessLevel).toBeNull();
    expect(q.enqueued).toHaveLength(0);
  });
});

describe("bounds — the door may not admit what the engine will refuse", () => {
  it("a file over the byte limit is refused with its own code", async () => {
    const huge = `${EXPECTATION}${"#".repeat(PAIR_MAX_BYTES + 1)}`;
    const out = await submit(q, { expectationCsv: huge });
    expect(out.refusal).toBe("NH-PP-1002");
    expect(q.enqueued).toHaveLength(0);
  });

  it("a file over the OBSERVER's row bound is refused here, not queued to fail in a worker", async () => {
    const header = EXPECTATION.split("\n")[0]!;
    const row = "ENT-9999,2026-01-01,2026-01-31,10.00,USD,PAYER-BULK,,,,,,SL-BULK";
    const tooMany = [header, ...Array.from({ length: PAIR_MAX_ROWS + 1 }, () => row)].join("\n");
    const out = await submit(q, { expectationCsv: tooMany });
    expect(out.refusal).toBe("NH-PP-1003");
    expect(out.refusalDetail).toMatch(/Split the pilot extract rather than truncating it/);
    expect(q.enqueued).toHaveLength(0);
  });
});

describe("what this module is NOT", () => {
  it("reaches no proof, no monetary and no reconciliation module — asserted on import specifiers", () => {
    const src = readFileSync(resolve(REPO, "server/services/pilotPairIntakeService.ts"), "utf8");
    const specifiers = [...src.matchAll(/from "([^"]+)"/g)].map((m) => m[1]!);
    for (const forbidden of [
      "proofService", "proofStore", "outcomeEvidence", "invariants", "outcomes", "approval",
      "reconciliationCore", "settlementClaim", "externalSettlement",
    ]) {
      expect(
        specifiers.some((s) => s.includes(forbidden)),
        `the intake imports ${forbidden} — it decides intake, never money`,
      ).toBe(false);
    }
    // And it holds no database client: the queue is a port.
    expect(specifiers.some((s) => s.includes("prisma") || s.endsWith("/db"))).toBe(false);
  });

  it("the scripts re-export is the SAME FUNCTION OBJECT, not an agreeing copy", async () => {
    // *A finite agreement is necessary evidence of equivalence and never a proof of it.* The CLI and
    // the route must run one implementation of parse → validate → evaluate, not two that match today.
    const fromSrc = await import("../../src/contract/pairAssessment");
    const fromScripts = await import("../../scripts/data-readiness/assessPairCore");
    expect(fromScripts.assessPairFromCsv).toBe(fromSrc.assessPairFromCsv);
  });

  it("OUR OWN failure is re-thrown, never reported as unreadable input", async () => {
    // THE BRANCH THE MUTATION PASS EXPOSED AS UNTESTED. A transport fault is about the file and carries
    // `NH-PP-1001`; anything else is ours. Reporting our own bug as the customer's bad data is the
    // `NH-AX-1009` mistake — blaming the data for a claim we made — and it would have an operator
    // re-exporting a file that was always fine.
    vi.resetModules();
    vi.doMock("../../src/contract/pairAssessment", () => ({
      assessPairFromCsv: () => { throw new TypeError("a bug of ours, not a bad file"); },
    }));
    try {
      const { submitPilotPair: freshSubmit } = await import("./pilotPairIntakeService");
      await expect(
        freshSubmit(new MemoryQueue(), OPERATOR, {
          boundaryId: BOUNDARY, expectationCsv: EXPECTATION, billingCsv: BILLING, currency: "USD",
        }),
      ).rejects.toThrow(/a bug of ours/);
    } finally {
      vi.doUnmock("../../src/contract/pairAssessment");
      vi.resetModules();
    }
  });

  it("a refusal carries no HEADER CELL either — an undeclared column name is customer data", async () => {
    // THE CASE THAT DOES REACH THE CONTRACT VERDICT. An export with one extra column is the most
    // ordinary real shape — a customer's own reference carried along for their convenience — and
    // `UNDECLARED_COLUMN`'s detail quotes that column NAME verbatim. The intake never holds a
    // validator `detail` (the report surfaces `extractFaultCodes` only), but it does hold the PARSED
    // HEADER, and rendering that would reintroduce the same leak by another route.
    const secret = "ACME-INTERNAL-LEDGER-7731";
    const withExtra = BILLING.trimEnd().split("\n")
      .map((line, i) => `${line},${i === 0 ? secret : "x"}`).join("\n");
    const out = await submit(q, { billingCsv: withExtra });
    expect(out.accepted).toBe(false);
    expect(out.refusal).toBe("NH-PP-1004");            // the contract verdict, not transport
    expect(out.refusalDetail).toMatch(/NH-BX-\d{4}/);   // and it says WHICH fault, by code
    expect(JSON.stringify(out), "the refusal leaked the undeclared column name")
      .not.toContain(secret);
  });

  it("the version is pinned, because a change in what it accepts is a new id", () => {
    expect(PILOT_PAIR_INTAKE_VERSION).toBe("pair-intake-2026.1");
  });
});

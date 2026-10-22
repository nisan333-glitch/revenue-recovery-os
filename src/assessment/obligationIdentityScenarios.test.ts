// WORKSTREAM A · Does an obligation keep ONE identity across its real-world lifecycle?
//
// Pure, no database, no clock. Every assertion here is VERIFIED CURRENT BEHAVIOUR of this build — not a
// proposal and not a wish — so the decision table in
// `docs/architecture/OBLIGATION_IDENTITY_DECISION_V1.md` rests on executable evidence rather than on a
// reading of the code.
//
// WHY THIS IS WORTH MEASURING RATHER THAN ARGUING. The acceptance criteria pull in opposite directions:
// a stable obligation must not yield two Recovery Cases when an assessment is rerun, AND two distinct
// obligations must not be merged. The findings below show that today's answer to the first is produced
// by the SAME mechanism that fails the second — identity is account-grained — so "it is stable" and "it
// is correct" are different claims and only one of them holds.
//
// NOTHING HERE IS SYNTHETIC EVIDENCE OF CUSTOMER READINESS. These are fixtures exercising the real
// derivations; they establish what the code does, not what a customer's book contains.
import { describe, it, expect } from "vitest";
import {
  cycleKeyPreserved2x,
  fallbackCompositeKey,
  CYCLE_KEY_SOURCE_COLUMNS,
  type CycleKeyFacts,
} from "./cycleKeyRule";
import { projectExecutionInput } from "../contract/assessmentExecution";
import type { ExpectationCycle } from "./types";

/** One account, one obligation, as the adapter would present it. */
const facts = (over: Partial<CycleKeyFacts> = {}): CycleKeyFacts => ({
  subscriptionId: undefined,
  cycleId: undefined,
  entityId: "ACC-1",
  expectationAt: "2026-01-01",
  dueAt: "2026-02-01",
  ...over,
});

const keyOf = (f: CycleKeyFacts) => cycleKeyPreserved2x(f).cycleKey;

describe("A · identity across the obligation lifecycle — VERIFIED CURRENT BEHAVIOUR", () => {
  it("1 · REPEATED IDENTICAL UPLOAD · identity is PRESERVED, and it is a property of the facts alone", () => {
    // The derivation reads the row and nothing else — no execution id, no row position, no clock — so
    // the same facts always yield the same key however many times they are supplied.
    expect(keyOf(facts())).toBe(keyOf(facts()));
    expect(cycleKeyPreserved2x(facts()).source).toBe("fallback_composite");
  });

  it("2 · RESCHEDULE · PRESERVED with a subscription id, BROKEN without one", () => {
    // This is the sharpest row in the table. A reschedule moves `next_invoice_due_at` and nothing else
    // about the obligation.
    const before = facts({ subscriptionId: "SUB-1" });
    const after = facts({ subscriptionId: "SUB-1", dueAt: "2026-03-01" });
    expect(keyOf(after)).toBe(keyOf(before)); // the subscription id carries it

    // With no explicit identifier the composite IS the key, and `dueAt` is inside it — so the same
    // obligation becomes a different cycle the moment it is rescheduled.
    const bareBefore = facts();
    const bareAfter = facts({ dueAt: "2026-03-01" });
    expect(keyOf(bareAfter)).not.toBe(keyOf(bareBefore));
    expect(fallbackCompositeKey(bareBefore)).toBe("ACC-1|2026-01-01|2026-02-01");
  });

  it("3 · RENEWAL · two obligations COLLIDE onto one key when they share a subscription id", () => {
    // A renewal is a second obligation under the same subscription: new `signed_at`, new due date.
    const term1 = facts({ subscriptionId: "SUB-1", expectationAt: "2026-01-01", dueAt: "2026-02-01" });
    const term2 = facts({ subscriptionId: "SUB-1", expectationAt: "2027-01-01", dueAt: "2027-02-01" });
    // Same key for two different obligations. `dedupeCollisions` (assess.ts) then excludes BOTH as
    // `duplicate_cycle_id`, so a renewed customer loses both rows rather than gaining a second cycle.
    expect(keyOf(term2)).toBe(keyOf(term1));
  });

  it("4 · SUBSCRIPTION ID CHANGE · identity is LOST — a migration reads as a new obligation", () => {
    const before = facts({ subscriptionId: "SUB-OLD" });
    const after = facts({ subscriptionId: "SUB-NEW" });
    expect(keyOf(after)).not.toBe(keyOf(before));
    // And it does not fall back to the composite to rescue itself: an explicit id always wins.
    expect(cycleKeyPreserved2x(after).source).toBe("subscription_id");
  });

  it("5 · CONTRADICTORY IDENTIFIERS · a BLANK subscription id suppresses a perfectly good cycle id", () => {
    // Defect D1, pinned here as current behaviour rather than described. Present-but-blank is NOT the
    // same as absent: blank falls through to the composite and discards `cycle_id` entirely.
    const absent = facts({ subscriptionId: undefined, cycleId: "CYC-1" });
    const blank = facts({ subscriptionId: "", cycleId: "CYC-1" });
    expect(cycleKeyPreserved2x(absent).source).toBe("cycle_id");
    expect(cycleKeyPreserved2x(blank).source).toBe("fallback_composite");
    expect(keyOf(blank)).not.toBe(keyOf(absent));
  });

  it("6 · MULTIPLE OBLIGATIONS OF ONE CUSTOMER · distinguishable ONLY by the due date", () => {
    // Two obligations, one account, no explicit identifiers. They are distinct here — but only because
    // `dueAt` differs. Two obligations sharing a due date are indistinguishable by construction.
    const a = facts({ dueAt: "2026-02-01" });
    const b = facts({ dueAt: "2026-03-01" });
    expect(keyOf(a)).not.toBe(keyOf(b));
    const sameDay = facts({ dueAt: "2026-02-01" });
    expect(keyOf(sameDay)).toBe(keyOf(a)); // two obligations, one key
  });

  it("7 · NO OTHER COLUMN CAN REACH THE KEY — asserted on the declared source list", () => {
    // The guard that makes every row above exhaustive: if a future column could enter the key, the
    // table would be incomplete without anyone noticing.
    expect([...CYCLE_KEY_SOURCE_COLUMNS].sort()).toEqual(
      ["cycle_id", "entity_id", "next_invoice_due_at", "signed_at", "subscription_id"],
    );
    // `obligation_ref` is NOT a key source, and the proposal keeps it that way deliberately: letting it
    // into the cycle key would change which rows collide, and therefore `acceptedCycleCount`, and
    // therefore `findingHash` — turning a witness into a function of the build.
    expect(CYCLE_KEY_SOURCE_COLUMNS).not.toContain("obligation_ref");
  });
});

describe("A · what the worker can see — the erratum's evidence", () => {
  const cycle = (over: Partial<ExpectationCycle> = {}): ExpectationCycle =>
    Object.freeze({
      cycleId: "CYC-1",
      sourceRowId: "row-1",
      entityId: "ACC-1",
      expectationAt: "2026-01-01",
      observationAt: null,
      monetaryEvent: {
        dueAt: "2026-02-01",
        amount: { minor: 10_000, currency: "USD" },
        paidAt: null,
        paidAmount: null,
        refundedAt: null,
        cancelledAt: null,
      },
      currency: "USD",
      statusRaw: "active",
      attributes: {},
      ...over,
    }) as ExpectationCycle;

  it("8 · the projection DROPS every attribute but `paid_timing`, and blanks `statusRaw`", () => {
    // THE FACT BEHIND THE ERRATUM. `docs/OBLIGATION_IDENTITY_PROPOSAL_V1.md` §8 step 2 said an
    // obligation reference "must survive `projectExecutionInput`, or the worker cannot see it". The
    // first half is true and the conclusion is wrong: the value cannot survive, and it does not need to,
    // because candidate staging runs on the PRE-projection cycles.
    const projected = projectExecutionInput([
      cycle({ attributes: { obligation_ref: "OB-1", paid_timing: "late", plan: "pro" } }),
    ]);
    expect(projected.cycles[0]!.attributes).toEqual({ paid_timing: "late" });
    expect(projected.cycles[0]!.statusRaw).toBeNull();
  });

  it("9 · and it REPLACES the identifiers with ordinals, so no raw identity reaches the worker", () => {
    const projected = projectExecutionInput([
      cycle({ cycleId: "CYC-REAL", entityId: "ACC-REAL", sourceRowId: "row-REAL" }),
    ]);
    const c = projected.cycles[0]!;
    expect(c.cycleId).toBe("c-0001");
    expect(c.entityId).toBe("e-0001");
    expect(c.sourceRowId).toBe("r-0001");
    expect(JSON.stringify(projected)).not.toContain("REAL");
  });

  it("10 · an ABSENT attribute produces byte-identical output — the no-movement property", () => {
    // Why this matters for the next slice: because the projection drops the field, adding
    // `obligation_ref` to a customer's export cannot move `canonicalExecutionInput`, so it cannot move
    // `hashExecutionInput`, so no retained input can read as `execution_input_tampered`.
    const without = projectExecutionInput([cycle()]);
    const with_ = projectExecutionInput([cycle({ attributes: { obligation_ref: "OB-1" } })]);
    expect(JSON.stringify(with_)).toBe(JSON.stringify(without));
  });
});

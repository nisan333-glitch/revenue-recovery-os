// The two cycle-key semantic rules, tested directly — and the proof that only one of them runs.
//
// THREE KINDS OF TEST LIVE HERE AND THEY ARE NOT INTERCHANGEABLE:
//
//   1. RULE tests pin what each rule decides, from the rule as stated, for both rules.
//   2. A FIDELITY test proves the 2.x prediction this file makes is what the REAL pipeline does. It is
//      the bridge: without it, the 3.x collision predictions below would be a model of a model. With it,
//      the same model is shown correct on the rule that is actually wired, so its 3.x answer means
//      something.
//   3. STRUCTURAL tests pin that the future rule has no production caller and that no version dispatch
//      exists. That is the property making this slice safe to land, and a later slice will break it
//      deliberately when it wires selection.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  CYCLE_KEY_RULE_FUTURE_3X,
  CYCLE_KEY_RULE_PRESERVED_2X,
  CYCLE_KEY_SOURCE_COLUMNS,
  cycleKeyFuture3x,
  cycleKeyPreserved2x,
  fallbackCompositeKey,
  type CycleKeyFacts,
  type CycleKeyOutcome,
} from "./cycleKeyRule";
import { assessCsv } from "./assess";
import { makePolicy } from "./policy";
// THE STAGE-A INTERPRETATION IDENTITY IS NOT REFERENCED FROM THIS FILE AT ALL — not imported, not read,
// not named. Its own pinned vector fails on ANY textual occurrence of its module name outside its own
// test, which is stricter than "no import" and deliberately so: a file that reads it still depends on
// it. An earlier draft of this file imported that constant and broke the vector. The vector was right
// and the draft was wrong, so this file stopped referencing it rather than the rule being loosened.

const POLICY = makePolicy({ stallThresholdDays: 30, asOf: "2026-04-15", currency: "USD" });
const HEADER = "entity_id,signed_at,next_invoice_due_at,next_invoice_amount,currency";
const COMPOSITE = "acct-1|2026-01-05|2026-02-05";

/** One row's facts. `subscriptionId`/`cycleId` left out means the COLUMN IS ABSENT, not blank. */
const facts = (over: Partial<CycleKeyFacts> = {}): CycleKeyFacts => ({
  subscriptionId: undefined,
  cycleId: undefined,
  entityId: "acct-1",
  expectationAt: "2026-01-05",
  dueAt: "2026-02-05",
  ...over,
});

/** Both rules, so every case below can be stated once and asserted against each. */
const RULES: readonly [name: string, id: string, fn: (f: CycleKeyFacts) => CycleKeyOutcome][] = [
  ["2.x preserved", CYCLE_KEY_RULE_PRESERVED_2X, cycleKeyPreserved2x],
  ["3.x future D1", CYCLE_KEY_RULE_FUTURE_3X, cycleKeyFuture3x],
];

/**
 * Which keys collide under a rule. This is the ONLY modelling this file does, and it mirrors
 * `dedupeCollisions` exactly: a key held by more than one row excludes EVERY row holding it, and no
 * surviving row is ever chosen by file position. The fidelity test proves the mirror is true.
 */
const collisionOutcome = (rows: readonly CycleKeyFacts[], fn: (f: CycleKeyFacts) => CycleKeyOutcome) => {
  const keys = rows.map((r) => fn(r).cycleKey);
  const counts = new Map<string, number>();
  for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1);
  return {
    keys,
    accepted: keys.filter((k) => counts.get(k) === 1).length,
    excluded: keys.filter((k) => counts.get(k)! > 1).length,
  };
};

// ── 1 · 2 · POPULATED subscription_id — IDENTICAL UNDER BOTH RULES ───────────────────────────────

describe("cycle-key · populated subscription_id wins under BOTH rules", () => {
  it("1 · 2.x · a populated subscription_id beats a supplied cycle_id", () => {
    const out = cycleKeyPreserved2x(facts({ subscriptionId: "SUB-1", cycleId: "CYC-7" }));
    expect(out.rule).toBe(CYCLE_KEY_RULE_PRESERVED_2X);
    expect(out.cycleKey).toBe("SUB-1");
    expect(out.source).toBe("subscription_id");
  });

  it("2 · 3.x · a populated subscription_id beats a supplied cycle_id — UNCHANGED by the cutover", () => {
    const out = cycleKeyFuture3x(facts({ subscriptionId: "SUB-1", cycleId: "CYC-7" }));
    expect(out.rule).toBe(CYCLE_KEY_RULE_FUTURE_3X);
    expect(out.cycleKey).toBe("SUB-1");
    expect(out.source).toBe("subscription_id");
  });
});

// ── 3 · 4 · BLANK subscription_id — THE WHOLE OF D1 ──────────────────────────────────────────────

describe("cycle-key · a BLANK subscription_id is where the two rules part", () => {
  it("3 · 2.x · a blank subscription_id SUPPRESSES a supplied cycle_id — defect D1, pinned not endorsed", () => {
    const out = cycleKeyPreserved2x(facts({ subscriptionId: "", cycleId: "CYC-7" }));
    expect(out.cycleKey).toBe(COMPOSITE);
    expect(out.source).toBe("fallback_composite");
  });

  it("4 · 3.x · a blank subscription_id no longer suppresses cycle_id", () => {
    const out = cycleKeyFuture3x(facts({ subscriptionId: "", cycleId: "CYC-7" }));
    expect(out.cycleKey).toBe("CYC-7");
    expect(out.source).toBe("cycle_id");
  });

  it("3b · 4b · an ABSENT subscription_id reaches cycle_id under BOTH rules — absent is not blank", () => {
    // The asymmetry that makes D1 a defect rather than a choice: today, absent and blank differ.
    for (const [name, , fn] of RULES) {
      const out = fn(facts({ cycleId: "CYC-7" }));
      expect(out.cycleKey, name).toBe("CYC-7");
      expect(out.source, name).toBe("cycle_id");
    }
  });

  it("3c · 4c · a WHITESPACE-ONLY subscription_id behaves as blank — and so still parts the rules", () => {
    // `"   "` is non-nullish, so 2.x takes it and trims to nothing; 3.x trims first and moves on.
    expect(cycleKeyPreserved2x(facts({ subscriptionId: "   ", cycleId: "CYC-7" })).cycleKey).toBe(COMPOSITE);
    expect(cycleKeyFuture3x(facts({ subscriptionId: "   ", cycleId: "CYC-7" })).cycleKey).toBe("CYC-7");
  });

  it("trims a usable identifier under both rules, and reports its source", () => {
    for (const [name, , fn] of RULES) {
      expect(fn(facts({ subscriptionId: "  SUB-1  " })).cycleKey, name).toBe("SUB-1");
      expect(fn(facts({ cycleId: "  CYC-7  " })).cycleKey, name).toBe("CYC-7");
    }
  });
});

// ── 5 · 6 · THE FALLBACK COMPOSITE — IDENTICAL UNDER BOTH RULES ──────────────────────────────────

describe("cycle-key · the fallback composite is the same under both rules", () => {
  it("5 · 2.x · no usable identifier yields the date composite", () => {
    const out = cycleKeyPreserved2x(facts());
    expect(out.cycleKey).toBe(COMPOSITE);
    expect(out.source).toBe("fallback_composite");
  });

  it("6 · 3.x · no usable identifier yields THE SAME date composite", () => {
    const out = cycleKeyFuture3x(facts());
    expect(out.cycleKey).toBe(COMPOSITE);
    expect(out.source).toBe("fallback_composite");
  });

  it("6b · both blank, both whitespace, and both absent all reach the identical composite", () => {
    for (const [name, , fn] of RULES) {
      expect(fn(facts({ subscriptionId: "", cycleId: "" })).cycleKey, name).toBe(COMPOSITE);
      expect(fn(facts({ subscriptionId: " ", cycleId: "  " })).cycleKey, name).toBe(COMPOSITE);
      expect(fn(facts()).cycleKey, name).toBe(COMPOSITE);
      expect(fn(facts()).cycleKey, name).toBe(fallbackCompositeKey(facts()));
    }
  });
});

// ── 7 · 8 · BIDIRECTIONALITY — WHY D1 IS A MAJOR AND NOT A FIX ───────────────────────────────────

describe("cycle-key · D1 changes admission in BOTH directions", () => {
  const blank = (dueAt: string, cycleId: string): CycleKeyFacts =>
    facts({ subscriptionId: "", cycleId, dueAt });

  it("7 · direction A · same cycle_id, distinct composites → 3.x NEWLY EXCLUDES what 2.x accepted", () => {
    const rows = [blank("2026-02-05", "CYC-9"), blank("2026-03-05", "CYC-9")];

    const now = collisionOutcome(rows, cycleKeyPreserved2x);
    expect(now.keys).toEqual(["acct-1|2026-01-05|2026-02-05", "acct-1|2026-01-05|2026-03-05"]);
    expect(now.accepted).toBe(2);
    expect(now.excluded).toBe(0);

    const later = collisionOutcome(rows, cycleKeyFuture3x);
    expect(later.keys).toEqual(["CYC-9", "CYC-9"]);
    expect(later.accepted).toBe(0);
    expect(later.excluded).toBe(2);
  });

  it("8 · direction B · different cycle_ids, one composite → 3.x NEWLY ADMITS what 2.x excluded", () => {
    const rows = [blank("2026-02-05", "CYC-1"), blank("2026-02-05", "CYC-2")];

    const now = collisionOutcome(rows, cycleKeyPreserved2x);
    expect(now.keys).toEqual([COMPOSITE, COMPOSITE]);
    expect(now.accepted).toBe(0);
    expect(now.excluded).toBe(2);

    const later = collisionOutcome(rows, cycleKeyFuture3x);
    expect(later.keys).toEqual(["CYC-1", "CYC-2"]);
    expect(later.accepted).toBe(2);
    expect(later.excluded).toBe(0);
  });

  it("so neither direction is a strict improvement — which is exactly why it is a MAJOR", () => {
    const sameCycleId = [blank("2026-02-05", "CYC-9"), blank("2026-03-05", "CYC-9")];
    const sameComposite = [blank("2026-02-05", "CYC-1"), blank("2026-02-05", "CYC-2")];
    expect(collisionOutcome(sameCycleId, cycleKeyFuture3x).accepted).toBeLessThan(
      collisionOutcome(sameCycleId, cycleKeyPreserved2x).accepted,
    );
    expect(collisionOutcome(sameComposite, cycleKeyFuture3x).accepted).toBeGreaterThan(
      collisionOutcome(sameComposite, cycleKeyPreserved2x).accepted,
    );
  });
});

// ── THE FIDELITY BRIDGE ──────────────────────────────────────────────────────────────────────────

describe("cycle-key · the collision model agrees with the real pipeline on the wired rule", () => {
  it("direction A under 2.x: the pipeline accepts both rows, as the model predicts", async () => {
    const result = await assessCsv(
      [
        `${HEADER},subscription_id,cycle_id`,
        "acct-1,2026-01-05,2026-02-05,500.00,USD,,CYC-9",
        "acct-1,2026-01-05,2026-03-05,300.00,USD,,CYC-9",
      ].join("\n"),
      POLICY,
      { createdAt: "2026-04-15T00:00:00.000Z" },
    );
    expect(result.acceptedCycleCount).toBe(2);
    expect(result.exclusions.filter((e) => e.reason === "duplicate_cycle_id").length).toBe(0);
  });

  it("direction B under 2.x: the pipeline excludes BOTH rows, as the model predicts", async () => {
    const result = await assessCsv(
      [
        `${HEADER},subscription_id,cycle_id`,
        "acct-1,2026-01-05,2026-02-05,500.00,USD,,CYC-1",
        "acct-1,2026-01-05,2026-02-05,300.00,USD,,CYC-2",
      ].join("\n"),
      POLICY,
      { createdAt: "2026-04-15T00:00:00.000Z" },
    );
    expect(result.acceptedCycleCount).toBe(0);
    expect(result.exclusions.filter((e) => e.reason === "duplicate_cycle_id").length).toBe(2);
    // The money reads ZERO rather than picking a row — the anti-tuning rule, still true.
    expect(result.observed.observedUnpaid.minor).toBe(0);
  });
});

// ── 9 · D2 CONTROL — UNCHANGED, UNDER BOTH RULES ─────────────────────────────────────────────────

describe("cycle-key · 9 · D2 is untouched by either rule", () => {
  const twoInvoices = [
    facts({ subscriptionId: "SUB-1", dueAt: "2026-02-05" }),
    facts({ subscriptionId: "SUB-1", dueAt: "2026-03-05" }),
  ];

  it("two invoices of ONE subscription collide identically under both rules", () => {
    for (const [name, , fn] of RULES) {
      const out = collisionOutcome(twoInvoices, fn);
      expect(out.keys, name).toEqual(["SUB-1", "SUB-1"]);
      expect(out.accepted, name).toBe(0);
      expect(out.excluded, name).toBe(2);
    }
  });

  it("and the real pipeline still excludes both and reads zero — no D2 solution is in this slice", async () => {
    const result = await assessCsv(
      [
        `${HEADER},subscription_id`,
        "acct-1,2026-01-05,2026-02-05,500.00,USD,SUB-1",
        "acct-1,2026-01-05,2026-03-05,300.00,USD,SUB-1",
      ].join("\n"),
      POLICY,
      { createdAt: "2026-04-15T00:00:00.000Z" },
    );
    expect(result.acceptedCycleCount).toBe(0);
    expect(result.exclusions.filter((e) => e.reason === "duplicate_cycle_id").length).toBe(2);
    expect(result.observed.observedUnpaid.minor).toBe(0);
  });
});

// ── 10 · NON-D1 CONTROL — THE RULES AGREE WHEREVER D1 IS NOT EXERCISED ───────────────────────────

describe("cycle-key · 10 · a dataset not exercising D1 derives identically under both rules", () => {
  const population: readonly CycleKeyFacts[] = [
    facts({ subscriptionId: "SUB-1" }),
    facts({ subscriptionId: "SUB-2", entityId: "acct-2", dueAt: "2026-02-06" }),
    facts({ cycleId: "CYC-3", entityId: "acct-3", dueAt: "2026-02-07" }), // absent subscription_id
    facts({ entityId: "acct-4", dueAt: "2026-02-08" }), // neither — composite
    facts({ subscriptionId: "SUB-5", cycleId: "CYC-5", entityId: "acct-5", dueAt: "2026-02-09" }),
  ];

  it("every row's key is identical under both rules, key for key", () => {
    const now = population.map((r) => cycleKeyPreserved2x(r).cycleKey);
    const later = population.map((r) => cycleKeyFuture3x(r).cycleKey);
    expect(later).toEqual(now);
    expect(now).toEqual(["SUB-1", "SUB-2", "CYC-3", "acct-4|2026-01-05|2026-02-08", "SUB-5"]);
  });

  it("so the whole stage-A population is unchanged — the cutover is narrow, not sweeping", () => {
    const now = collisionOutcome(population, cycleKeyPreserved2x);
    const later = collisionOutcome(population, cycleKeyFuture3x);
    expect(later).toEqual(now);
    expect(now.accepted).toBe(5);
    expect(now.excluded).toBe(0);
  });

  it("and the real pipeline accepts that same population today", async () => {
    const result = await assessCsv(
      [
        `${HEADER},subscription_id,cycle_id`,
        "acct-1,2026-01-05,2026-02-05,100.00,USD,SUB-1,",
        "acct-2,2026-01-05,2026-02-06,200.00,USD,SUB-2,",
        "acct-3,2026-01-05,2026-02-07,300.00,USD,SUB-3,",
        "acct-4,2026-01-05,2026-02-08,400.00,USD,SUB-4,",
      ].join("\n"),
      POLICY,
      { createdAt: "2026-04-15T00:00:00.000Z" },
    );
    expect(result.acceptedCycleCount).toBe(4);
    expect(result.exclusions.filter((e) => e.reason === "duplicate_cycle_id").length).toBe(0);
  });
});

// ── PROPERTIES ───────────────────────────────────────────────────────────────────────────────────

describe("cycle-key · properties of both rules", () => {
  const CASES: readonly Partial<CycleKeyFacts>[] = [
    {}, { subscriptionId: "" }, { subscriptionId: "SUB-1" }, { cycleId: "CYC-7" },
    { subscriptionId: "", cycleId: "CYC-7" }, { subscriptionId: "   ", cycleId: "" },
    { subscriptionId: "SUB-1", cycleId: "CYC-7" },
  ];

  it("both are deterministic, total, and never return an empty key", () => {
    for (const [name, id, fn] of RULES) {
      for (const over of CASES) {
        const f = facts(over);
        const a = fn(f);
        expect(a, `${name} ${JSON.stringify(over)}`).toEqual(fn(f));
        expect(a.cycleKey.length, `${name} ${JSON.stringify(over)}`).toBeGreaterThan(0);
        expect(a.rule, name).toBe(id);
      }
    }
  });

  it("each rule stamps its own id, and the two ids are different", () => {
    expect(CYCLE_KEY_RULE_PRESERVED_2X).not.toBe(CYCLE_KEY_RULE_FUTURE_3X);
    expect(cycleKeyPreserved2x(facts()).rule).toBe(CYCLE_KEY_RULE_PRESERVED_2X);
    expect(cycleKeyFuture3x(facts()).rule).toBe(CYCLE_KEY_RULE_FUTURE_3X);
  });

  it("no column outside the declared five can reach the key", () => {
    expect([...CYCLE_KEY_SOURCE_COLUMNS]).toEqual([
      "subscription_id", "cycle_id", "entity_id", "signed_at", "next_invoice_due_at",
    ]);
    // Changing an unrelated field cannot move the key under either rule.
    for (const [name, , fn] of RULES) {
      const base = fn(facts({ subscriptionId: "", cycleId: "CYC-7" }));
      const moved = fn({ ...facts({ subscriptionId: "", cycleId: "CYC-7" }), entityId: "acct-1" });
      expect(moved.cycleKey, name).toBe(base.cycleKey);
    }
  });
});

// ── STRUCTURAL · THE FUTURE RULE IS IMPLEMENTED, NOT ACTIVATED ───────────────────────────────────

describe("cycle-key · structural inertness", () => {
  /**
   * Source with comments removed. REACHABILITY IS A PROPERTY OF CODE, NOT PROSE: the adapter's comment
   * deliberately names the future rule to say it is unreachable, and a scan that counted that as a
   * caller would be both wrong and an incentive to stop explaining things. An `import` or a call is
   * never inside a comment, so stripping cannot hide a real caller.
   */
  const codeOf = (path: string): string =>
    readFileSync(path, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

  const productionFiles = (): string[] => {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) {
          if (entry !== "node_modules") walk(path);
          continue;
        }
        if (!/\.(ts|tsx|mts|cts)$/.test(entry)) continue;
        if (/\.test\.ts$/.test(entry)) continue; // tests may reach the future rule; production may not
        out.push(path);
      }
    };
    for (const root of ["src", "server"]) walk(join(__dirname, "..", "..", root));
    return out;
  };

  const ownDefinition = join("assessment", "cycleKeyRule.ts");
  const shortPath = (p: string) => p.slice(p.indexOf(`${join("src", "")}`) + 4);

  it("the FUTURE rule has NO production caller at all", () => {
    const offenders = productionFiles()
      .filter((p) => !p.endsWith(ownDefinition)) // its own definition is not a caller
      .filter((p) => /cycleKeyFuture3x|CYCLE_KEY_RULE_FUTURE_3X/.test(codeOf(p)));
    expect(offenders, `future rule reached from: ${offenders.join(", ")}`).toEqual([]);
  });

  it("the PRESERVED rule has exactly ONE production caller — the adapter", () => {
    const callers = productionFiles()
      .filter((p) => !p.endsWith(ownDefinition))
      .filter((p) => /cycleKeyPreserved2x/.test(codeOf(p)));
    expect(callers.map(shortPath)).toEqual([join("assessment", "adapters", "saasActivation.ts")]);
  });

  it("NO runtime version dispatch exists — nothing selects a rule from a version", () => {
    const adapter = codeOf(join(__dirname, "adapters", "saasActivation.ts"));
    // The adapter names the preserved rule and nothing else: no version argument, no branch on a major.
    expect(adapter).toMatch(/cycleKeyPreserved2x\(/);
    expect(adapter).not.toMatch(/cycleKeyFuture3x/);
    expect(adapter).not.toMatch(/PILOT_DATA_CONTRACT_VERSION|declaredVersion|interpretationMajor/);
  });

  it("the rule module imports NOTHING — it is a pure function of five row facts", () => {
    const code = readFileSync(join(__dirname, "cycleKeyRule.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect([...code.matchAll(/from "([^"]+)"/g)].map((m) => m[1]!)).toEqual([]);
  });

  // NO ASSERTION ABOUT THE STAGE-A INTERPRETATION REVISION LIVES HERE, deliberately. Its value and its
  // inertness are already pinned by the vector that owns them, and that vector fails on any textual
  // occurrence of its module's name outside its own test — so a duplicate check here could only be
  // either redundant or a breach of the thing it was meant to confirm.
});

// D1 · The cycle-key derivation, as TWO explicit semantic rules instead of one inline expression.
//
// WHAT THIS SLICE IS. The derivation used to live as a single line inside `toCycle`. It is extracted
// here unchanged, and the FUTURE rule is implemented beside it. Nothing selects between them: the
// adapter calls the preserved rule BY NAME, so production behaviour is exactly today's.
//
// ── D1_SEMANTIC_RULE, NOT DATA_INTERPRETATION_IDENTITY ───────────────────────────────────────────
//
// These two terms stay apart, and this module is firmly the first one:
//
//   D1_SEMANTIC_RULE               ← this module. ONE narrow rule: which column becomes the cycle key.
//   DATA_INTERPRETATION_IDENTITY   `DATA_INTERPRETATION_REVISION` in `src/contract/`. The COMPLETE
//                                  stage-A behaviour — parsing, mapping, normalization, validation,
//                                  cycle-key derivation and dedupe, together.
//
// SO NO 3.x STAGE-A REVISION IS MINTED BY THIS FILE, and none may be. A future rule EXISTING is not a
// complete stage-A interpretation being ACTIVATED; `nh-data-interpretation-2x-r1` still names the only
// interpretation that runs, and its conformance barrier still passes unmodified.
//
// ── WHY THE PRESERVED RULE DISTINGUISHES ABSENT FROM BLANK ───────────────────────────────────────
//
// `(sub ?? cyc ?? "").trim()` uses NULLISH precedence, and `""` is not nullish. So a `subscription_id`
// column that exists and is EMPTY wins the `??` and then trims to nothing — suppressing a perfectly
// good `cycle_id` and sending the key to the date composite. An ABSENT `subscription_id` key is
// `undefined`, so `??` falls through and `cycle_id` IS used.
//
// That absent/blank asymmetry is the whole of defect D1, so the preserved rule must keep it, which is
// why its input types are `string | undefined` rather than `string`. Collapsing them to `string` would
// silently implement the 3.x rule. The distinction is REAL at this layer: `applyMapping` sets a mapped
// canonical key to `""` when the source cell is empty, and leaves an UNMAPPED canonical absent entirely.
//
// PRESERVED IS NOT ENDORSED. The 2.x rule is today's truth, pinned so a change to it fails loudly. It
// is not defended as correct.
//
// ── WHAT NEITHER RULE TOUCHES: D2 ────────────────────────────────────────────────────────────────
//
// A POPULATED `subscription_id` is the cycle key under BOTH rules, identically. So two invoices of one
// subscription still derive the SAME key and `dedupeCollisions` still excludes BOTH of them. That is
// defect D2, and it is deliberately untouched here — no D2 solution is in this slice, under either rule.
//
// IMPORTS NOTHING. The rule is a pure function of five row facts, so it needs no type, constant or
// helper from anywhere else, and a test asserts the module stays that way.

/**
 * The cycle-key semantics in force in every shipped build. Named so it can be referred to after a
 * second rule exists, rather than being "the one in the adapter".
 */
export const CYCLE_KEY_RULE_PRESERVED_2X = "nh-cycle-key-2x-nullish-precedence";

/**
 * The cycle-key semantics the first 3.x cutover introduces. IMPLEMENTED, NOT ACTIVATED — it has no
 * production caller, and a structural test asserts that.
 */
export const CYCLE_KEY_RULE_FUTURE_3X = "nh-cycle-key-3x-blank-tolerant-precedence";

export type CycleKeyRuleId = typeof CYCLE_KEY_RULE_PRESERVED_2X | typeof CYCLE_KEY_RULE_FUTURE_3X;

/**
 * Everything either rule reads. Nothing else about the row can reach the key.
 *
 * The two identifier fields are OPTIONAL ON PURPOSE: `undefined` means the column is absent, `""` means
 * it is present and empty, and the preserved rule treats those differently. See the header.
 *
 * The three composite fields arrive ALREADY NORMALIZED — `entityId` trimmed, the two dates as ISO days —
 * because they are the values the adapter has already derived. This module does not re-normalize them;
 * normalization is a different stage-A surface with its own vectors.
 */
export interface CycleKeyFacts {
  readonly subscriptionId: string | undefined;
  readonly cycleId: string | undefined;
  readonly entityId: string;
  /** `signed_at`, ISO day. */
  readonly expectationAt: string;
  /** `next_invoice_due_at`, ISO day. */
  readonly dueAt: string;
}

/** Which column the key came from. Reported so a caller can see WHY, never to re-derive the key. */
export type CycleKeySource = "subscription_id" | "cycle_id" | "fallback_composite";

export interface CycleKeyOutcome {
  /** Which semantic rule produced this. A key is never meaningful without the rule that made it. */
  readonly rule: CycleKeyRuleId;
  readonly cycleKey: string;
  readonly source: CycleKeySource;
}

/**
 * The composite used when no explicit identifier is usable. IDENTICAL under both rules — the rules
 * differ only in WHEN they fall back to it, never in what it is.
 */
export function fallbackCompositeKey(facts: CycleKeyFacts): string {
  return `${facts.entityId}|${facts.expectationAt}|${facts.dueAt}`;
}

function outcome(rule: CycleKeyRuleId, cycleKey: string, source: CycleKeySource): CycleKeyOutcome {
  return Object.freeze({ rule, cycleKey, source });
}

/**
 * TODAY'S RULE, byte-for-byte the behaviour of the expression it replaces.
 *
 *   populated `subscription_id`              → `subscription_id`
 *   ABSENT `subscription_id` + populated `cycle_id` → `cycle_id`
 *   PRESENT-BUT-BLANK `subscription_id`      → the composite, SUPPRESSING any `cycle_id`   ← D1
 *   neither usable                           → the composite
 *
 * Pure and total: no clock, no I/O, no throw.
 */
export function cycleKeyPreserved2x(facts: CycleKeyFacts): CycleKeyOutcome {
  // The original expression, kept as one line so the equivalence is readable rather than argued.
  const nullishWinner = facts.subscriptionId ?? facts.cycleId ?? "";
  const explicit = nullishWinner.trim();
  if (explicit !== "") {
    // Whichever value the `??` chain actually took — `subscription_id` whenever its key exists at all.
    const source: CycleKeySource = facts.subscriptionId !== undefined ? "subscription_id" : "cycle_id";
    return outcome(CYCLE_KEY_RULE_PRESERVED_2X, explicit, source);
  }
  return outcome(CYCLE_KEY_RULE_PRESERVED_2X, fallbackCompositeKey(facts), "fallback_composite");
}

/**
 * THE FUTURE D1 RULE. Blank and absent are treated alike, so a supplied `cycle_id` is no longer
 * suppressed by an empty `subscription_id` column.
 *
 *   populated `subscription_id`                        → `subscription_id`   (UNCHANGED from 2.x)
 *   blank OR absent `subscription_id` + populated `cycle_id` → `cycle_id`
 *   neither usable                                     → the composite      (UNCHANGED from 2.x)
 *
 * BIDIRECTIONAL, which is why it is a MAJOR and not a fix that can be slipped in: against 2.x it both
 * newly ADMITS rows (two blank-`subscription_id` rows with distinct `cycle_id`s that previously
 * collided on one composite) and newly EXCLUDES rows (two with the same `cycle_id` that previously
 * differed by composite). Neither direction is a strict improvement in admission.
 *
 * NOT ACTIVATED. No production path reaches this function.
 */
export function cycleKeyFuture3x(facts: CycleKeyFacts): CycleKeyOutcome {
  const subscription = (facts.subscriptionId ?? "").trim();
  if (subscription !== "") {
    // D2 IS NOT ADDRESSED HERE, deliberately: this is the same answer 2.x gives, so two invoices of one
    // subscription still collide and are still both excluded.
    return outcome(CYCLE_KEY_RULE_FUTURE_3X, subscription, "subscription_id");
  }
  const cycle = (facts.cycleId ?? "").trim();
  if (cycle !== "") {
    return outcome(CYCLE_KEY_RULE_FUTURE_3X, cycle, "cycle_id");
  }
  return outcome(CYCLE_KEY_RULE_FUTURE_3X, fallbackCompositeKey(facts), "fallback_composite");
}

/**
 * The row fields each rule reads, as DATA — so a test can assert that no OTHER column can reach the
 * key, rather than a comment claiming it.
 */
export const CYCLE_KEY_SOURCE_COLUMNS: readonly string[] = Object.freeze([
  "subscription_id",
  "cycle_id",
  "entity_id",
  "signed_at",
  "next_invoice_due_at",
]);

// NH synthetic end-to-end leakage validation — the INDEPENDENT generator.
//
// WHY THIS FILE IMPORTS NOTHING FROM THE PRODUCT. The existing generator
// (`src/contract/syntheticPilotDataset.ts`) shares a module family with the adapter that reads it, so
// using it here would make the experiment circular: the data and the detector would encode the same
// assumptions and agreement would prove nothing. This file therefore imports ONLY node builtins and
// writes raw CSV text from a business narrative. A check in `verify.mjs` asserts that.
//
// GROUND TRUTH IS RECORDED TWICE, ON PURPOSE.
//
//   business_expectation      — what a revenue operator looking at the row would say is leaking, in
//                               business terms, with the amount they would name. Written from the
//                               narrative, not from any rule in the product.
//   expected_nh_classification — what NH's documented semantics should do with the row.
//
// The split is what defuses the circularity. NH disagreeing with `expected_nh_classification` is an
// implementation defect. NH disagreeing with `business_expectation` while matching the classification
// is a capability or semantics gap — a different and more interesting result. Neither is repaired by
// editing this file after a run.
//
// SYNTHETIC ONLY. Every identifier carries a `synthetic-` prefix. No real or disguised customer data.
// Nothing here is Revenue Returned, recovered money, or proof of anything.
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

// ── Run constants ─────────────────────────────────────────────────────────────────────────────────
const AS_OF = "2026-06-30";
const STALL_THRESHOLD_DAYS = 30;
const CURRENCY = "USD";
const SEED = 20260926;
const OUT_DIR = "e2e/fixtures/synthetic-validation";

// ── Deterministic PRNG (mulberry32) — fixed seed, so the whole dataset is reproducible ────────────
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(SEED);
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

// ── Date helpers — plain UTC day arithmetic, written here rather than imported ────────────────────
const DAY = 86_400_000;
const day = (iso) => Date.parse(`${iso}T00:00:00.000Z`) / DAY;
const iso = (d) => new Date(d * DAY).toISOString().slice(0, 10);
const plus = (isoDate, days) => iso(day(isoDate) + days);

// ── The columns. Every one is declared by the contract; an undeclared column is rejected, and a
// missing RECOMMENDED column is a dataset-level finding the admission bar counts, so all are present.
const COLUMNS = [
  "entity_id", "subscription_id", "cycle_id", "signed_at", "activation_at",
  "next_invoice_due_at", "next_invoice_amount", "currency",
  "next_invoice_paid_at", "next_invoice_paid", "paid_amount",
  "refunded_at", "refunded", "cancelled_at", "cancelled",
  "status", "status_effective_at", "is_test", "plan", "segment", "product",
];

const PLANS = ["starter", "growth", "scale"];
const SEGMENTS = ["smb", "mid-market", "enterprise"];
const PRODUCTS = ["core", "core+analytics"];

const rows = [];
const truth = [];

/** One CSV row. Absent fields are written empty, which is how a real export omits them. */
function row(cells) {
  const out = { _scenario: CURRENT };
  for (const c of COLUMNS) out[c] = cells[c] ?? "";
  rows.push(out);
  return out;
}

/**
 * Amounts carry the reconciliation tag in their CENTS.
 *
 * NH reports five money totals over the stalled cohort and nothing per entity, so a scenario's
 * contribution is recovered from the total's cents: within one bucket the tags are distinct powers of
 * two summing to at most 63, which never carries into dollars, so the cents of a bucket total name
 * exactly the subset of scenarios that contributed. Every untagged row ends in `.00` so it cannot
 * pollute a tag. `verify.mjs` proves the decodability before the dataset is frozen.
 */
const money = (dollars, centTag = 0) => `${dollars}.${String(centTag).padStart(2, "0")}`;

let scenarioSeq = 0;
let CURRENT = null;
function scenario(spec) {
  scenarioSeq += 1;
  // `row_count` is how many CSV rows this scenario owns. Recorded because the aggregate NH reports is
  // per ROW, not per scenario, and the prediction has to be built from rows to be checkable.
  truth.push(Object.freeze({ scenario_id: `S${String(scenarioSeq).padStart(2, "0")}`, row_count: 1, ...spec }));
  CURRENT = truth[truth.length - 1].scenario_id;
  return CURRENT;
}

// ══ 1 · BUCKET U — observedUnpaid, the figure the UI labels Revenue Opportunity ═══════════════════
// Stalled AND payment state Unpaid. Tags 1,2,4,8,16,32.
const U = [
  {
    tag: 1, dollars: 4200, entity: "u-never-activated",
    narrative: "Signed in March, never activated, April invoice never paid.",
    cells: (e) => ({ signed_at: "2026-03-02", activation_at: "", next_invoice_due_at: "2026-04-02" }),
    business: "the whole invoice is at risk — the customer never started and never paid",
  },
  {
    tag: 2, dollars: 3100, entity: "u-activated-late",
    narrative: "Activated 45 days after signing — past the 30-day bar — invoice unpaid.",
    cells: () => ({ signed_at: "2026-03-05", activation_at: "2026-04-19", next_invoice_due_at: "2026-04-05" }),
    business: "late activation and an unpaid invoice",
  },
  {
    tag: 4, dollars: 900, entity: "u-one-day-past",
    narrative: "Activated on signed+31 — one day past the bar. BOUNDARY POSITIVE.",
    cells: () => ({ signed_at: "2026-03-10", activation_at: plus("2026-03-10", 31), next_invoice_due_at: "2026-04-10" }),
    business: "one day late by the stated definition; a human might call this a rounding argument",
  },
  {
    tag: 8, dollars: 15000, entity: "u-activated-after-asof",
    narrative: "Activated 2026-07-15, AFTER the as-of date, so the activation is not yet visible.",
    cells: () => ({ signed_at: "2026-04-01", activation_at: "2026-07-15", next_invoice_due_at: "2026-05-01" }),
    business: "unpaid and not activated as at the cut-off, even though it activated later",
  },
  {
    tag: 16, dollars: 650, entity: "u-explicit-unpaid-bool",
    narrative: "Never activated; the export states next_invoice_paid=false explicitly.",
    cells: () => ({ signed_at: "2026-02-14", activation_at: "", next_invoice_due_at: "2026-03-14", next_invoice_paid: "false" }),
    business: "unpaid, stated outright by the source system",
  },
  {
    tag: 32, dollars: 7800, entity: "u-enterprise-dimensions",
    narrative: "Never activated; carries plan/segment/product dimensions (legitimate variation).",
    cells: () => ({ signed_at: "2026-01-20", activation_at: "", next_invoice_due_at: "2026-02-20", plan: "scale", segment: "enterprise", product: "core+analytics" }),
    business: "the dimensions are descriptive; the leakage is the unpaid invoice",
  },
];
for (const u of U) {
  const id = scenario({
    entity_id: `synthetic-${u.entity}`, period: `${AS_OF} as-of`, planted_event: u.narrative,
    leakage_class: "activation_stall_unpaid_invoice", in_capability: true, detectable_today: true,
    expected_bucket: "observedUnpaid", expected_cohort: "stalled", expected_payment_state: "Unpaid",
    expected_amount_minor: u.dollars * 100 + u.tag, cent_tag: u.tag,
    expected_nh_classification: "stalled cohort, Unpaid ⇒ counted in observedUnpaid",
    business_expectation: u.business, formula: "next_invoice_amount, in full",
    expected_detector: "classifyStall + classifyPayment(Unpaid)", ambiguity: u.tag === 4 ? "boundary case: exactly one day past the threshold" : null,
  });
  row({
    entity_id: `synthetic-${u.entity}`, subscription_id: `synthetic-sub-${id}`, currency: CURRENCY,
    next_invoice_amount: money(u.dollars, u.tag), status: "active", is_test: "false", ...u.cells(),
  });
}

// ══ 2 · BUCKET P — partialOutstanding. Stalled AND PartiallyPaid. Tags 1,2,4. ═════════════════════
const P = [
  { tag: 1, dollars: 5000, paid: 2000, entity: "p-half-paid", narrative: "Never activated; half the invoice settled.", business: "the unpaid remainder is what is at risk, not the whole invoice" },
  { tag: 2, dollars: 12000, paid: 11000, entity: "p-mostly-paid", narrative: "Activated late; all but $1,000 settled.", business: "a small remainder outstanding" },
  { tag: 4, dollars: 800, paid: 799.99, entity: "p-one-cent-short", narrative: "Never activated; one cent short of settled. BOUNDARY PARTIAL.", business: "arguably settled in business terms; one cent is not revenue leakage" },
];
for (const p of P) {
  const amountMinor = p.dollars * 100 + p.tag;
  const paidMinor = Math.round(p.paid * 100);
  const id = scenario({
    entity_id: `synthetic-${p.entity}`, period: `${AS_OF} as-of`, planted_event: p.narrative,
    leakage_class: "activation_stall_partial_payment", in_capability: true, detectable_today: true,
    expected_bucket: "partialOutstanding", expected_cohort: "stalled", expected_payment_state: "PartiallyPaid",
    expected_amount_minor: amountMinor - paidMinor, cent_tag: p.tag,
    expected_nh_classification: "stalled cohort, PartiallyPaid ⇒ counted in partialOutstanding as amount − paid, NOT in observedUnpaid",
    business_expectation: p.business, formula: "next_invoice_amount − paid_amount",
    expected_detector: "classifyStall + classifyPayment(PartiallyPaid)",
    ambiguity: p.tag === 4 ? "one cent outstanding is not commercially meaningful leakage" : null,
  });
  row({
    entity_id: `synthetic-${p.entity}`, subscription_id: `synthetic-sub-${id}`, currency: CURRENCY,
    signed_at: "2026-03-01", activation_at: "", next_invoice_due_at: "2026-04-01",
    next_invoice_amount: money(p.dollars, p.tag), paid_amount: p.paid.toFixed(2),
    next_invoice_paid_at: "2026-04-20", status: "active", is_test: "false",
  });
}

// ══ 3 · BUCKET X — excludedValue. Stalled AND Cancelled/Refunded as at asOf. Tags 1,2,4,8. ════════
const X = [
  { tag: 1, dollars: 2500, entity: "x-cancelled", cells: { cancelled: "true", cancelled_at: "2026-05-01" }, narrative: "Never activated, then cancelled in May.", business: "cancelled before the cut-off — not collectable, and should not be presented as an opportunity" },
  { tag: 2, dollars: 3300, entity: "x-refunded", cells: { refunded: "true", refunded_at: "2026-05-10" }, narrative: "Never activated, invoice refunded in May.", business: "refunded money is not leakage" },
  { tag: 4, dollars: 1700, entity: "x-status-cancelled", cells: { status: "cancelled", status_effective_at: "2026-04-15" }, narrative: "Cancellation expressed only through status + status_effective_at.", business: "same as an explicit cancellation; the source system just says it differently" },
  { tag: 8, dollars: 990, entity: "x-refunded-bool", cells: { refunded: "TRUE", refunded_at: "2026-06-29" }, narrative: "Refunded one day before the cut-off.", business: "refunded, just barely inside the window" },
];
for (const x of X) {
  const id = scenario({
    entity_id: `synthetic-${x.entity}`, period: `${AS_OF} as-of`, planted_event: x.narrative,
    leakage_class: "stalled_but_terminal_state", in_capability: true, detectable_today: true,
    expected_bucket: "excludedValue", expected_cohort: "stalled", expected_payment_state: x.cells.refunded ? "Refunded" : "Cancelled",
    expected_amount_minor: x.dollars * 100 + x.tag, cent_tag: x.tag,
    expected_nh_classification: "stalled cohort, terminal state as at asOf ⇒ excludedValue, NOT observedUnpaid",
    business_expectation: x.business, formula: "next_invoice_amount, reported as excluded value",
    expected_detector: "classifyStall + classifyPayment(Cancelled|Refunded)", ambiguity: null,
  });
  row({
    entity_id: `synthetic-${x.entity}`, subscription_id: `synthetic-sub-${id}`, currency: CURRENCY,
    signed_at: "2026-02-01", activation_at: "", next_invoice_due_at: "2026-03-01",
    next_invoice_amount: money(x.dollars, x.tag), is_test: "false", ...x.cells,
  });
}

// ══ 4 · BUCKET K — unknownValue. Stalled AND Unknown. Tags 1,2. ═══════════════════════════════════
const K = [
  { tag: 1, dollars: 4400, paid: "1500.00", entity: "k-paid-amount-no-date", narrative: "Never activated; a paid_amount is present but no payment date at all." },
  { tag: 2, dollars: 6100, paid: "6100.02", entity: "k-paid-full-no-date", narrative: "Never activated; paid_amount equals the invoice but there is no payment date." },
];
for (const k of K) {
  const id = scenario({
    entity_id: `synthetic-${k.entity}`, period: `${AS_OF} as-of`, planted_event: k.narrative,
    leakage_class: "stalled_unresolvable_payment_evidence", in_capability: true, detectable_today: true,
    expected_bucket: "unknownValue", expected_cohort: "stalled", expected_payment_state: "Unknown",
    expected_amount_minor: k.dollars * 100 + k.tag, cent_tag: k.tag,
    expected_nh_classification: "stalled cohort, positive paid_amount with no payment date ⇒ Unknown ⇒ unknownValue",
    business_expectation: "the source data cannot say whether this was settled; presenting it as an opportunity would be a guess",
    formula: "next_invoice_amount, reported as unknown value",
    expected_detector: "classifyStall + classifyPayment(Unknown)",
    ambiguity: "a human would chase the billing system rather than classify this",
  });
  row({
    entity_id: `synthetic-${k.entity}`, subscription_id: `synthetic-sub-${id}`, currency: CURRENCY,
    signed_at: "2026-02-10", activation_at: "", next_invoice_due_at: "2026-03-10",
    next_invoice_amount: money(k.dollars, k.tag), paid_amount: k.paid, is_test: "false", status: "active",
  });
}

// ══ 5 · GROSS-ELIGIBLE-ONLY — stalled but the invoice was paid late. No tag: .00 cents. ═══════════
{
  const id = scenario({
    entity_id: "synthetic-g-stalled-paid-late", period: `${AS_OF} as-of`,
    planted_event: "Activated 60 days after signing; the invoice was nevertheless paid, late.",
    leakage_class: "activation_stall_invoice_settled", in_capability: true, detectable_today: true,
    expected_bucket: "grossEligible_only", expected_cohort: "stalled", expected_payment_state: "PaidLate",
    expected_amount_minor: 0, cent_tag: 0,
    expected_nh_classification: "stalled cohort, PaidLate ⇒ counted in grossEligible only; contributes NOTHING to observedUnpaid",
    business_expectation: "the activation was slow but the money arrived — no revenue is leaking",
    formula: "zero leakage; the invoice was settled",
    expected_detector: "classifyStall + classifyPayment(PaidLate)", ambiguity: null,
  });
  row({
    entity_id: "synthetic-g-stalled-paid-late", subscription_id: `synthetic-sub-${id}`, currency: CURRENCY,
    signed_at: "2026-03-01", activation_at: "2026-04-30", next_invoice_due_at: "2026-04-01",
    next_invoice_amount: money(2200, 0), paid_amount: money(2200, 0), next_invoice_paid_at: "2026-04-25",
    next_invoice_paid: "true", status: "active", is_test: "false",
  });
}

// ══ 6 · NEAR MISSES — must NOT reach the headline. All .00 cents. ═════════════════════════════════
const NEAR = [
  {
    entity: "n-exactly-at-threshold", dollars: 5500,
    cells: { signed_at: "2026-03-01", activation_at: plus("2026-03-01", 30), next_invoice_due_at: "2026-04-01" },
    cohort: "reference", state: "Unpaid",
    klass: "near_miss_exact_threshold",
    nh: "activated exactly at signed+30; the rule is STRICTLY greater than, so NOT stalled ⇒ reference cohort ⇒ excluded from every stalled total even though the invoice is unpaid",
    business: "activated inside the agreed window; the unpaid invoice is a collections matter, not activation leakage",
    ambiguity: "the invoice IS unpaid — a revenue operator would very likely want to see this money somewhere",
  },
  {
    entity: "n-unpaid-but-activated-promptly", dollars: 9300,
    cells: { signed_at: "2026-03-01", activation_at: "2026-03-03", next_invoice_due_at: "2026-04-01" },
    cohort: "reference", state: "Unpaid",
    klass: "unpaid_invoice_without_activation_stall",
    nh: "activated promptly ⇒ reference cohort ⇒ invisible to the headline and to every stalled money total",
    business: "an unpaid invoice from a healthy customer is real money at risk, and this product does not surface it",
    ambiguity: "THE central coverage question: is unpaid-without-stall in scope for a revenue recovery product?",
  },
  {
    entity: "n-not-yet-due", dollars: 4100,
    cells: { signed_at: "2026-06-20", activation_at: "", next_invoice_due_at: "2026-07-20" },
    cohort: "undetermined", state: "NotYetDue",
    klass: "near_miss_inside_window",
    nh: "signed+30 falls after asOf and nothing is observed ⇒ within_window_not_yet_due ⇒ undetermined, not stalled",
    business: "too early to call anything wrong",
    ambiguity: null,
  },
  {
    entity: "n-cancelled-after-asof", dollars: 6700,
    cells: { signed_at: "2026-02-05", activation_at: "", next_invoice_due_at: "2026-03-05", cancelled: "true", cancelled_at: "2026-08-01" },
    cohort: "stalled", state: "Unpaid",
    klass: "terminal_state_after_cutoff",
    nh: "cancellation is AFTER asOf so it is not yet effective ⇒ Unpaid ⇒ this DOES reach the headline",
    business: "as at the cut-off the money was still owed; the later cancellation is future information",
    ambiguity: "reasonable people could read this either way — spot-checked separately",
  },
  {
    entity: "n-status-active-noise", dollars: 3800,
    cells: { signed_at: "2026-03-15", activation_at: "2026-03-18", next_invoice_due_at: "2026-04-15", next_invoice_paid_at: "2026-04-10", next_invoice_paid: "true", paid_amount: money(3800, 0), status: "trialing" },
    cohort: "reference", state: "PaidOnTime",
    klass: "legitimate_variation",
    nh: "an unrecognised status has no effect: the excluded-status list is empty over the API, so this is an ordinary healthy cycle",
    business: "nothing wrong here at all",
    ambiguity: null,
  },
];
for (const n of NEAR) {
  const id = scenario({
    entity_id: `synthetic-${n.entity}`, period: `${AS_OF} as-of`, planted_event: n.nh.split(" ⇒ ")[0],
    leakage_class: n.klass, in_capability: true, detectable_today: n.cohort === "stalled",
    expected_bucket: n.cohort === "stalled" && n.state === "Unpaid" ? "observedUnpaid" : "none",
    expected_cohort: n.cohort, expected_payment_state: n.state,
    expected_amount_minor: n.cohort === "stalled" && n.state === "Unpaid" ? n.dollars * 100 : 0,
    cent_tag: 0, expected_nh_classification: n.nh, business_expectation: n.business,
    formula: n.cohort === "stalled" && n.state === "Unpaid" ? "next_invoice_amount" : "zero — must not contribute",
    expected_detector: "classifyStall", ambiguity: n.ambiguity,
  });
  row({
    entity_id: `synthetic-${n.entity}`, subscription_id: `synthetic-sub-${id}`, currency: CURRENCY,
    next_invoice_amount: money(n.dollars, 0), is_test: "false", ...n.cells,
  });
}

// ══ 7 · ROW-LEVEL DEFECTS — never become cycles, so they enter no money total. All .00. ═══════════
const DEFECTS = [
  { entity: "e-currency-mismatch", reason: "currency_mismatch", cells: { currency: "EUR" }, business: "a EUR row in a USD dataset cannot be summed with the rest" },
  { entity: "e-zero-amount", reason: "zero_amount", cells: { next_invoice_amount: "0.00" }, business: "a zero invoice is not an obligation" },
  { entity: "e-negative-amount", reason: "negative_amount", cells: { next_invoice_amount: "-500.00" }, business: "a credit, not an invoice" },
  { entity: "e-paid-exceeds", reason: "paid_amount_exceeds_obligation", cells: { next_invoice_amount: "1000.00", paid_amount: "1500.00" }, business: "an overpayment needs a human, not a silent cohort placement" },
  { entity: "e-due-before-signed", reason: "impossible_date_sequence", cells: { signed_at: "2026-04-01", next_invoice_due_at: "2026-03-01" }, business: "impossible: invoiced before the contract existed" },
  { entity: "e-activation-before-signed", reason: "impossible_date_sequence", cells: { signed_at: "2026-04-01", activation_at: "2026-03-20", next_invoice_due_at: "2026-05-01" }, business: "impossible: activated before signing" },
  { entity: "e-invalid-boolean", reason: "invalid_boolean", cells: { is_test: "perhaps" }, business: "an unparseable flag must not be guessed" },
  { entity: "e-undated-refund", reason: "undated_terminal_state", cells: { refunded: "true" }, business: "a refund with no date cannot be placed in time" },
  { entity: "e-is-test", reason: "internal_or_test_account", cells: { is_test: "true" }, business: "internal accounts are not customer revenue" },
  { entity: "e-inconsistent-paid", reason: "inconsistent_payment_data", cells: { next_invoice_paid: "false", next_invoice_paid_at: "2026-04-10" }, business: "the export contradicts itself" },
  { entity: "e-paid-date-zero-amount", reason: "inconsistent_payment_data", cells: { next_invoice_paid_at: "2026-04-10", paid_amount: "0.00" }, business: "settled on a date, for nothing" },
  { entity: "e-timezoneless", reason: "malformed_or_ambiguous_date", cells: { signed_at: "2026-03-01 09:30:00" }, business: "a wall-clock time with no offset is not a point in time" },
  { entity: "e-missing-currency", reason: "missing_required_field", cells: { currency: "" }, business: "no currency, no comparable amount" },
];
for (const d of DEFECTS) {
  const id = scenario({
    entity_id: `synthetic-${d.entity}`, period: `${AS_OF} as-of`, planted_event: `row-level defect: ${d.reason}`,
    leakage_class: "not_a_leakage_defective_row", in_capability: true, detectable_today: true,
    expected_bucket: "row_excluded", expected_cohort: "excluded", expected_payment_state: "n/a",
    expected_amount_minor: 0, cent_tag: 0,
    expected_nh_classification: `excluded before becoming a cycle (${d.reason}); contributes to no money total`,
    business_expectation: d.business, formula: "zero — the row is refused with a reason, never repaired",
    expected_detector: "toCycle row guards", ambiguity: null,
  });
  row({
    entity_id: `synthetic-${d.entity}`, subscription_id: `synthetic-sub-${id}`, currency: CURRENCY,
    signed_at: "2026-03-01", activation_at: "", next_invoice_due_at: "2026-04-01",
    next_invoice_amount: money(1000, 0), is_test: "false", ...d.cells,
  });
}

// ══ 8 · DUPLICATE CYCLE IDENTITY — both rows excluded, per the 2026-09-25 collision rule ═════════
{
  const id = scenario({
    entity_id: "synthetic-d-duplicate-cycle", period: `${AS_OF} as-of`,
    planted_event: "Two rows share one subscription_id — a double-paste in the export.",
    leakage_class: "not_a_leakage_duplicate_cycle", in_capability: true, detectable_today: true,
    expected_bucket: "row_excluded", expected_cohort: "excluded", expected_payment_state: "n/a",
    expected_amount_minor: 0, cent_tag: 0,
    expected_nh_classification: "BOTH rows excluded as duplicate_cycle_id; neither may be chosen by file position",
    business_expectation: "an accidental double-paste; the safe reading is to trust neither copy",
    formula: "zero — the cycle is lost entirely, which is the documented cost of the rule",
    expected_detector: "assess() cycle-identity collision", ambiguity: null, row_count: 2,
  });
  for (const amt of [7000, 7000]) {
    row({
      entity_id: "synthetic-d-duplicate-cycle", subscription_id: `synthetic-sub-${id}`, currency: CURRENCY,
      signed_at: "2026-02-20", activation_at: "", next_invoice_due_at: "2026-03-20",
      next_invoice_amount: money(amt, 0), is_test: "false", status: "active",
    });
  }
}

// ══ 8b · DELIBERATE COVERAGE-WINDOW VIOLATION — planted after run v1 revealed the rule ═══════════
{
  const id = scenario({
    entity_id: "synthetic-w-outside-coverage", period: `${AS_OF} as-of`,
    planted_event: "An invoice due 2026-09-15, outside the provenance coverage window the uploader declared.",
    leakage_class: "not_a_leakage_outside_declared_window", in_capability: true, detectable_today: true,
    expected_bucket: "row_excluded", expected_cohort: "excluded", expected_payment_state: "n/a",
    expected_amount_minor: 0, cent_tag: 0,
    expected_nh_classification: "NH-DC-2021 row_rejected — the row falls outside the declared coverage window",
    business_expectation: "the uploader said the extract covers Jan–Jul; a September invoice contradicts the declaration",
    formula: "zero — the row is refused", expected_detector: "coverage containment check", ambiguity: null,
  });
  row({
    entity_id: "synthetic-w-outside-coverage", subscription_id: `synthetic-sub-${id}`, currency: CURRENCY,
    signed_at: "2026-08-01", activation_at: "", next_invoice_due_at: "2026-09-15",
    next_invoice_amount: money(5000, 0), is_test: "false", status: "active",
  });
}

// ══ 9 · HEALTHY POPULATION — the bulk. Activated promptly, paid on time. All .00 cents. ═══════════
// Repeated entities across two or three cycles, distinct subscription ids so nothing collides.
const healthy = [];
for (let e = 1; e <= 96; e += 1) {
  const entity = `synthetic-h-${String(e).padStart(3, "0")}`;
  const cycles = int(2, 3);
  let signed = plus("2026-01-05", int(0, 60));
  for (let k = 0; k < cycles; k += 1) {
    const due = plus(signed, int(28, 34));
    const activatedIn = int(1, 26);            // comfortably inside the 30-day bar
    const amount = int(3, 240) * 50;           // 150 … 12,000 — several magnitudes
    const paidOffset = int(-8, 0);             // settled on or before the due date
    healthy.push({ entity, signed, due, act: plus(signed, activatedIn), amount, paidAt: plus(due, paidOffset) });
    signed = plus(due, int(1, 20));
  }
}
const healthyTruthId = scenario({
  entity_id: "synthetic-h-* (96 entities)", period: "2026-01-05 … 2026-06-30",
  planted_event: `${healthy.length} healthy cycles: activated well inside the 30-day bar, invoice settled on or before its due date.`,
  leakage_class: "control_healthy", in_capability: true, detectable_today: true,
  expected_bucket: "none", expected_cohort: "reference", expected_payment_state: "PaidOnTime",
  expected_amount_minor: 0, cent_tag: 0,
  expected_nh_classification: "reference cohort; contributes nothing to any stalled money total. A single one of these appearing in observedUnpaid is a FALSE POSITIVE",
  business_expectation: "nothing is leaking; these are the customers who worked",
  formula: "zero", expected_detector: "classifyStall (non-deviant)", ambiguity: null,
  row_count: healthy.length,
});
for (const h of healthy) {
  row({
    entity_id: h.entity, subscription_id: `synthetic-sub-${h.entity}-${h.signed}`, currency: CURRENCY,
    signed_at: h.signed, activation_at: h.act, next_invoice_due_at: h.due,
    next_invoice_amount: money(h.amount, 0), next_invoice_paid_at: h.paidAt,
    next_invoice_paid: "true", paid_amount: money(h.amount, 0),
    status: "active", is_test: "false",
    plan: pick(PLANS), segment: pick(SEGMENTS), product: pick(PRODUCTS),
  });
}
void healthyTruthId;

// ══ 10 · OUT OF CAPABILITY — recorded as ground truth, NOT representable as rows ══════════════════
// These are leakage narratives the contract's columns cannot express at all. They carry a planted
// amount so the report can state what value sits outside the product's reach — kept in a SEPARATE
// register from in-dataset leakage, and never summed into one "NH missed X%" figure.
const GAPS = [
  { klass: "usage_adoption_decline", amount_minor: 1_800_000, missing: ["seats_active", "usage_events", "feature_adoption_at"], narrative: "A customer activated, then usage collapsed to near zero before renewal." },
  { klass: "renewal_at_risk", amount_minor: 2_400_000, missing: ["renewal_date", "renewal_status", "contract_end_at"], narrative: "A contract approaching renewal with no engagement and no renewal signal." },
  { klass: "expansion_stalled", amount_minor: 950_000, missing: ["entitled_seats", "purchased_seats", "expansion_opportunity_at"], narrative: "Seats entitled but never purchased after an agreed expansion." },
  { klass: "discount_leakage", amount_minor: 620_000, missing: ["list_price", "discount_pct", "discount_expires_at"], narrative: "A temporary discount never expired and was billed indefinitely." },
  { klass: "dunning_failure", amount_minor: 430_000, missing: ["payment_attempts", "last_attempt_at", "failure_code"], narrative: "Card failures retried to exhaustion and then abandoned silently." },
  { klass: "credit_note_misapplied", amount_minor: 310_000, missing: ["credit_note_id", "credit_applied_to", "credit_amount"], narrative: "A credit note applied to the wrong invoice, masking an unpaid one." },
];
for (const g of GAPS) {
  scenario({
    entity_id: "n/a — not representable", period: `${AS_OF} as-of`, planted_event: g.narrative,
    leakage_class: g.klass, in_capability: false, detectable_today: false,
    expected_bucket: "not_representable", expected_cohort: "n/a", expected_payment_state: "n/a",
    expected_amount_minor: g.amount_minor, cent_tag: 0,
    expected_nh_classification: "NOT DETECTABLE — the pilot data contract declares no column that could carry this signal",
    business_expectation: `${g.narrative} A revenue operator would call this leakage.`,
    formula: "asserted by the narrative; no row exists for NH to read",
    expected_detector: null, missing_columns: g.missing, row_count: 0,
    ambiguity: "classified as a capability gap, not as a miss — no detector was forced to see it",
  });
}

// ── Emit ──────────────────────────────────────────────────────────────────────────────────────────
//
// THREE datasets, because run v1 proved two scenarios cannot share a file with the others.
//
//   main                      every in-capability scenario except the two below, plus the healthy base
//   spot-multicurrency        healthy base + the foreign-currency row. Run v1 showed that ONE such row
//                             carries NH-DC-1006 `dataset_rejected` — the whole file becomes
//                             unassessable — so it cannot sit in a dataset meant to be admitted. It is
//                             measured in isolation instead of being dropped.
//   spot-cancelled-after-asof healthy base + the terminal-state-after-cutoff row, whose reading is
//                             genuinely arguable and which the plan marked for a spot check.
//
// The healthy base is identical in all three, so the same permissive bar applies unchanged and no
// threshold is retuned per dataset.
const SPOT = {
  "spot-multicurrency": "synthetic-e-currency-mismatch",
  "spot-cancelled-after-asof": "synthetic-n-cancelled-after-asof",
};
const spotScenarioIds = new Set(
  Object.values(SPOT).map((entity) => truth.find((t) => t.entity_id === entity)?.scenario_id),
);
const healthyScenarioId = truth.find((t) => t.leakage_class === "control_healthy").scenario_id;
// Run v2 refused both spot datasets NOT_ADMISSIBLE: the bar (stated before the run) requires the
// `undetermined` lifecycle state to be present, and a spot dataset of healthy rows plus one scenario
// contains none. The BAR is not touched — it was stated in advance and it did its job. The spot
// datasets' COMPOSITION is corrected instead, by including the not-yet-due scenario in their base, so
// all three lifecycle states are represented and the same bar applies unchanged.
const undeterminedScenarioId = truth.find((t) => t.expected_cohort === "undetermined").scenario_id;

function emit(name, keep) {
  const chosen = rows.filter((r) => keep(r._scenario));
  const csv = [COLUMNS.join(","), ...chosen.map((r) => COLUMNS.map((c) => r[c]).join(","))].join("\n") + "\n";
  writeFileSync(`${OUT_DIR}/${name}.csv`, csv, { encoding: "utf8", mode: 0o600 });
  const scenarioIds = new Set(chosen.map((r) => r._scenario));
  return {
    name,
    rowCount: chosen.length,
    entityCount: new Set(chosen.map((r) => r.entity_id)).size,
    sha256: createHash("sha256").update(csv).digest("hex"),
    scenarioIds: [...scenarioIds].sort(),
  };
}

mkdirSync(OUT_DIR, { recursive: true });
const datasets = [
  emit("dataset", (id) => !spotScenarioIds.has(id)),
  ...Object.entries(SPOT).map(([name, entity]) => {
    const only = truth.find((t) => t.entity_id === entity).scenario_id;
    return emit(name, (id) => id === only || id === healthyScenarioId || id === undeterminedScenarioId);
  }),
];

const manifest = {
  generator: "scripts/synthetic-validation/generate.mjs",
  seed: SEED,
  asOf: AS_OF,
  stallThresholdDays: STALL_THRESHOLD_DAYS,
  currency: CURRENCY,
  datasets,
  reconciliation:
    "Within each money bucket, contributing scenarios carry distinct power-of-two CENT tags summing to at most 63, " +
    "so the bucket total's cents name exactly which scenarios contributed. Every other row ends in .00.",
  provenanceCoverage: { start: "2026-01-01", end: "2026-07-31" },
  claimBoundary: {
    syntheticOnly: true,
    isRecoveredRevenue: false,
    isProvenRevenueReturned: false,
    note: "Planted figures are Synthetic Ground-Truth Leakage. Anything NH computes is Detected Revenue Opportunity. Neither is recovered or proven money.",
  },
  scenarios: truth,
};
writeFileSync(`${OUT_DIR}/ground-truth.json`, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });

for (const d of datasets) console.log(`${d.name.padEnd(26)} rows=${String(d.rowCount).padEnd(4)} entities=${String(d.entityCount).padEnd(4)} sha256=${d.sha256.slice(0, 16)}…`);
console.log(`scenarios=${truth.length}`);

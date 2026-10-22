// NH RECONCILIATION · the realistic two-sided synthetic source-system package.
//
// WHY THIS FILE IMPORTS NOTHING FROM THE PRODUCT. The abstract examiner
// (`src/benchmark/reconciliationScenarios.ts`) and the core that reads it share a module family, so a
// realistic dataset built from those same types would encode the same assumptions and agreement would
// prove nothing. This file imports ONLY node builtins and writes CSV from a business narrative.
// `verify.mjs` asserts that, the way the EP-31 harness asserts it for its own generator.
//
// WHAT MAKES THIS DIFFERENT FROM THE EXISTING BENCHMARK. That one is 30 hand-authored cases, mostly one
// obvious row against one obvious row — the right shape for unit-level refusals and the wrong shape for
// "does NH survive a real export?". Here the planted defects sit inside ~800 rows of clean recurring
// business, under source-native identifiers that two different systems emit, and the mechanisms overlap.
//
// THE TWO SYSTEMS EMIT DIFFERENT IDENTIFIERS, WHICH IS THE WHOLE POINT. The contract system knows
// `entitlement_id` and `schedule_line_id`; billing knows `subscription_id` and `invoice_id`. Normally
// billing's subscription id equals the contract's entitlement id, because billing was provisioned from
// the contract — UNTIL a re-key or a migration, after which it does not. Collapsing these into one
// reconciliation grain is the D2 decision, and this package exists so the collapse can be MEASURED
// rather than assumed.
//
// GROUND TRUTH IS RECORDED TWICE, following the EP-31 discipline exactly:
//   business_expectation       — what a revenue operator reading the case would say is leaking, and the
//                                amount they would name, written from the narrative.
//   expected_nh_classification — what NH's documented semantics should do with it.
// NH disagreeing with the classification is an IMPLEMENTATION DEFECT. NH matching the classification
// while disagreeing with the business expectation is a CAPABILITY OR SEMANTICS GAP — a different and
// more interesting result. Neither is repaired by editing this file after a run.
//
// SYNTHETIC ONLY. Every identifier carries a synthetic marker. No real or disguised customer data.
// Nothing here is Revenue Returned, recovered money, or proof of anything.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const OUT = "e2e/fixtures/reconciliation-obligation-ref";
const SEED = 20261006;
const CURRENCY = "USD";
const PERIODS = ["01", "02", "03", "04", "05", "06"]; // Jan..Jun 2026
const MIGRATION_PERIOD = "05"; // billing cut-over: keys change from this period on

// Deterministic PRNG (mulberry32), so the package is byte-reproducible from the seed alone.
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
const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = (xs) => xs[Math.floor(rand() * xs.length)];

const lastDay = { "01": "31", "02": "28", "03": "31", "04": "30", "05": "31", "06": "30" };
const pStart = (m) => `2026-${m}-01`;
const pEnd = (m) => `2026-${m}-${lastDay[m]}`;
const money = (minor) => (minor / 100).toFixed(2);

// ── The roster ────────────────────────────────────────────────────────────────────────────────────
// 60 payers, a few of them parent/child groups so sibling-payer attribution has something real to
// stand on, and ~140 entitlements across them. Prices are plan-like, not random noise.
const PLANS = [
  { code: "SYN-STARTER", minor: 29_900 },
  { code: "SYN-TEAM", minor: 79_900 },
  { code: "SYN-BUSINESS", minor: 249_900 },
  { code: "SYN-ENTERPRISE", minor: 980_000 },
  { code: "SYN-PLATFORM", minor: 1_450_000 },
];

const payers = [];
for (let i = 1; i <= 60; i += 1) {
  const id = `syn-acct-${String(i).padStart(3, "0")}`;
  // Three parent groups, each with two children: the only authoritative payer relation in the package.
  const parent = i === 11 || i === 12 ? "syn-acct-010"
    : i === 31 || i === 32 ? "syn-acct-030"
    : i === 51 || i === 52 ? "syn-acct-050"
    : "";
  payers.push({ id, parent });
}

const entitlements = [];
let eSeq = 0;
for (const payer of payers) {
  for (let k = 0; k < int(1, 4); k += 1) {
    eSeq += 1;
    const plan = pick(PLANS);
    entitlements.push({
      entitlementId: `syn-ent-${String(eSeq).padStart(4, "0")}`,
      contractId: `syn-con-${payer.id.slice(-3)}-${String(k + 1).padStart(2, "0")}`,
      accountId: payer.id,
      payerAccountId: payer.id,
      parentAccountId: payer.parent,
      plan,
      // Not every entitlement runs the whole window: realistic staggered starts and ends.
      firstPeriod: PERIODS[Math.min(int(0, 2), PERIODS.length - 1)],
      mechanism: null,
    });
  }
}

// ── Assign the twenty mechanisms to real entitlements ─────────────────────────────────────────────
// Deliberately NOT one case per mechanism in isolation: M20 stacks several on one payer, and every
// other mechanism sits among neighbours that behave normally.
const MECHANISMS = [
  "M01-normal", "M02-missing-invoice", "M03-underbilled", "M04-partial-billing",
  "M05-split-invoice", "M06-consolidated-invoice", "M07-duplicate-masks-missing",
  "M08-wrong-entitlement", "M09-wrong-payer", "M10-billed-after-cancellation",
  "M11-missed-after-amendment", "M12-pause-resume", "M13-renewal", "M14-rekeyed-identity",
  "M15-billing-migration", "M16-unknown-expected-amount", "M17-ambiguous-identity",
  "M18-unsupported-relationship", "M19-cross-currency", "M20-multiple-mechanisms",
];
// COHORT SIZES, and they are not uniform on purpose. A single entitlement per mechanism was the first
// form of this file and it was unrealistic in the one place it matters most: a billing-system migration
// moves the WHOLE BOOK at once, and reading that as leakage is the largest false-positive available to
// this product. So the migration cohort is large, the ordinary operational mistakes are small, and the
// deliberate one-offs stay single.
const COHORT = {
  "M02-missing-invoice": 4,
  "M03-underbilled": 3,
  "M04-partial-billing": 3,
  "M05-split-invoice": 3,
  "M06-consolidated-invoice": 2,
  "M07-duplicate-masks-missing": 2,
  "M08-wrong-entitlement": 2,
  "M09-wrong-payer": 2,
  "M10-billed-after-cancellation": 2,
  "M11-missed-after-amendment": 3,
  "M12-pause-resume": 3,
  "M13-renewal": 4,
  "M14-rekeyed-identity": 3,
  "M15-billing-migration": 28, // ~24% of the book, cutting over on one date
  "M16-unknown-expected-amount": 4,
  "M17-ambiguous-identity": 2,
  "M18-unsupported-relationship": 1,
  "M19-cross-currency": 2,
  "M20-multiple-mechanisms": 1,
};

const assigned = new Map();
// Walk the roster with a stride so planted cases are spread through it rather than clustered, and so
// every cohort has unplanted neighbours on both sides.
let cursor = 3;
for (const m of MECHANISMS) {
  if (m === "M01-normal") continue; // M01 is every unplanted entitlement, not a special one
  const want = COHORT[m] ?? 1;
  const cohort = [];
  while (cohort.length < want && cursor < entitlements.length) {
    const candidate = entitlements[cursor];
    cursor += candidate.mechanism === null ? 1 : 1;
    if (candidate.mechanism === null) { candidate.mechanism = m; cohort.push(candidate); }
  }
  assigned.set(m, cohort);
}
// M20 takes two more entitlements on the SAME payer, so one account carries three mechanisms at once.
const multi = assigned.get("M20-multiple-mechanisms")[0];
const siblings = entitlements.filter((e) => e.accountId === multi.accountId && e.mechanism === null).slice(0, 2);
siblings.forEach((sib, i) => { sib.mechanism = `M20-multiple-mechanisms#${i + 2}`; });
if (siblings.length < 2) {
  // The chosen payer did not have two spare entitlements. Rather than silently plant a weaker case,
  // borrow unplanted entitlements and RE-POINT their payer, which is what a shared account looks like.
  const spare = entitlements.filter((e) => e.mechanism === null).slice(0, 2 - siblings.length);
  for (const e of spare) {
    e.accountId = multi.accountId; e.payerAccountId = multi.payerAccountId;
    e.parentAccountId = multi.parentAccountId;
    e.contractId = `${multi.contractId}-X`;
    e.mechanism = `M20-multiple-mechanisms#${siblings.length + spare.indexOf(e) + 2}`;
    siblings.push(e);
  }
}

// ── Emit ──────────────────────────────────────────────────────────────────────────────────────────
const E = []; // expectation rows (contract system)
const O = []; // observation rows (billing system)
const truth = []; // one row per planted case
let invSeq = 0;
const invoiceId = () => `syn-inv-${String((invSeq += 1)).padStart(5, "0")}`;

/** Billing's subscription key for an entitlement in a period — this is where migration bites. */
function subscriptionKey(ent, period) {
  const migrated = ent.mechanism === "M15-billing-migration" && period >= MIGRATION_PERIOD;
  return migrated ? { subscriptionId: `syn-sub-m2-${ent.entitlementId.slice(-4)}`, legacy: ent.entitlementId }
    : { subscriptionId: ent.entitlementId, legacy: "" };
}

function expectRow(ent, period, over = {}) {
  const row = {
    contract_id: ent.contractId,
    schedule_line_id: `${ent.entitlementId}-${period}`,
    entitlement_id: ent.entitlementId,
    account_id: ent.accountId,
    payer_account_id: ent.payerAccountId,
    parent_account_id: ent.parentAccountId,
    legacy_schedule_id: "",
    period_start: pStart(period),
    period_end: pEnd(period),
    expected_amount: money(ent.plan.minor),
    currency: CURRENCY,
    terminated_at: "",
    pause_start: "",
    pause_end: "",
    amended_at: "",
    supersedes_schedule_line_id: "",
    product_code: ent.plan.code,
    source_system: "syn-contract-system",
    ...over,
  };
  E.push(row);
  return row;
}

function observeRow(ent, period, over = {}) {
  const key = subscriptionKey(ent, period);
  const row = {
    invoice_id: over.invoice_id ?? invoiceId(),
    invoice_line_id: `L1`,
    invoice_number: `SYN-${period}-${String(invSeq).padStart(5, "0")}`,
    billing_account_id: `syn-bill-${ent.payerAccountId.slice(-3)}`,
    subscription_id: key.subscriptionId,
    legacy_subscription_id: key.legacy,
    payer_account_id: ent.payerAccountId,
    period_start: pStart(period),
    period_end: pEnd(period),
    billed_amount: money(ent.plan.minor),
    currency: CURRENCY,
    is_credit: "false",
    issued_at: `2026-${period}-0${int(2, 9)}`,
    source_system: period >= MIGRATION_PERIOD && ent.mechanism === "M15-billing-migration"
      ? "syn-billing-v2" : "syn-billing-v1",
    // THE ONE NEW BUSINESS FACT. Billing states which CONTRACT OBLIGATION this line settles, because
    // billing was provisioned with the reference and carries it onto every invoice it raises. It is
    // stated at emission, never inferred: nothing here reads an amount, a date, a payer or any NH
    // identifier to arrive at it.
    //
    // It defaults to the obligation the line was raised FOR, which is why it survives billing's own
    // re-keying (M14) and its whole-book migration (M15) — a stable external reference is not an
    // internal key. Where billing's ALLOCATION is itself the defect it carries billing's own belief,
    // so `over` can state a different obligation; see M08.
    obligation_ref: `${ent.entitlementId}-${period}`,
    ...over,
  };
  O.push(row);
  return row;
}

function plant(mechanism, ent, fields) {
  truth.push({
    mechanism,
    first_entitlement_id: ent.entitlementId,
    payer_account_id: ent.payerAccountId,
    ...fields,
  });
}

for (const ent of entitlements) {
  const periods = PERIODS.filter((p) => p >= ent.firstPeriod);
  const m = (ent.mechanism ?? "").split("#")[0];
  const price = ent.plan.minor;

  for (const period of periods) {
    switch (m) {
      case "M02-missing-invoice":
        // One period in the middle is simply never invoiced. Every other period bills normally.
        if (period === "03") { expectRow(ent, period); break; }
        expectRow(ent, period); observeRow(ent, period); break;

      case "M03-underbilled":
        // Billed at a stale lower price for one period.
        if (period === "04") {
          expectRow(ent, period);
          observeRow(ent, period, { billed_amount: money(Math.round(price * 0.8)) });
          break;
        }
        expectRow(ent, period); observeRow(ent, period); break;

      case "M04-partial-billing":
        // An invoice was raised for part of the obligation and the remainder never followed.
        if (period === "03") {
          expectRow(ent, period);
          observeRow(ent, period, { billed_amount: money(Math.round(price * 0.45)) });
          break;
        }
        expectRow(ent, period); observeRow(ent, period); break;

      case "M05-split-invoice": {
        // One obligation settled by two invoices that SUM correctly. Not leakage.
        expectRow(ent, period);
        if (period === "02") {
          const half = Math.round(price / 2);
          observeRow(ent, period, { billed_amount: money(half), invoice_line_id: "L1" });
          observeRow(ent, period, { billed_amount: money(price - half), invoice_line_id: "L1" });
        } else observeRow(ent, period);
        break;
      }

      case "M06-consolidated-invoice": {
        // Two periods carried on ONE invoice, allocated per line. Not leakage.
        expectRow(ent, period);
        if (period === "02") {
          const inv = invoiceId();
          observeRow(ent, "02", { invoice_id: inv, invoice_line_id: "L1" });
          observeRow(ent, "03", { invoice_id: inv, invoice_line_id: "L2" });
        } else if (period !== "03") observeRow(ent, period);
        break;
      }

      case "M07-duplicate-masks-missing":
        // THE BLIND SPOT. March is never invoiced; February is invoiced twice. Money nets to zero at
        // every grain, so no monetary method can see it — only an event check can.
        expectRow(ent, period);
        if (period === "02") { observeRow(ent, period); observeRow(ent, period); }
        else if (period !== "03") observeRow(ent, period);
        break;

      case "M08-wrong-entitlement": {
        // Billed, but allocated to a SIBLING entitlement of the same payer. The company was paid; the
        // dollar sits against the wrong obligation.
        expectRow(ent, period);
        if (period === "03") {
          const sib = entitlements.find((x) => x.payerAccountId === ent.payerAccountId && x !== ent);
          // Billing's own allocation record names the SIBLING's obligation, because the allocation
          // step is the thing that went wrong — so the reference agrees with the wrong
          // `subscription_id` and testifies to nothing new. The conservative reading, declared.
          const to = sib ? sib.entitlementId : ent.entitlementId;
          observeRow(ent, period, { subscription_id: to, obligation_ref: `${to}-${period}` });
        } else observeRow(ent, period);
        break;
      }

      case "M09-wrong-payer": {
        // Billed to the PARENT account instead of the child that owes it.
        expectRow(ent, period);
        if (period === "03") {
          observeRow(ent, period, {
            payer_account_id: ent.parentAccountId || ent.payerAccountId,
            billing_account_id: `syn-bill-${(ent.parentAccountId || ent.payerAccountId).slice(-3)}`,
          });
        } else observeRow(ent, period);
        break;
      }

      case "M10-billed-after-cancellation":
        // Cancelled end of February, with the date recorded — and billing kept going.
        expectRow(ent, period, { terminated_at: "2026-02-28" });
        observeRow(ent, period); // including AFTER the cancellation: an over-bill, not exposure
        break;

      case "M11-missed-after-amendment": {
        // An amendment raises the price from March. The old line is superseded; billing kept charging
        // the OLD amount, so the uplift was never invoiced.
        if (period >= "03") {
          expectRow(ent, period, { expected_amount: money(price), supersedes_schedule_line_id: "" });
          expectRow(ent, period, {
            schedule_line_id: `${ent.entitlementId}-${period}-A2`,
            expected_amount: money(Math.round(price * 1.3)),
            amended_at: "2026-02-20",
            supersedes_schedule_line_id: `${ent.entitlementId}-${period}`,
          });
          observeRow(ent, period, { billed_amount: money(price) });
        } else { expectRow(ent, period); observeRow(ent, period); }
        break;
      }

      case "M12-pause-resume":
        // Paused for March with both bounds recorded. Nothing owed, nothing billed. Not leakage.
        if (period === "03") { expectRow(ent, period, { pause_start: "2026-03-01", pause_end: "2026-03-31" }); break; }
        expectRow(ent, period); observeRow(ent, period); break;

      case "M13-renewal":
        // A term renews mid-window under a new contract id. Billing continues correctly.
        expectRow(ent, period, period >= "04" ? { contract_id: `${ent.contractId}-R2` } : {});
        observeRow(ent, period); break;

      case "M14-rekeyed-identity":
        // Billing re-keyed the subscription from March with NO mapping anywhere. The expectation still
        // names the old identity.
        expectRow(ent, period);
        observeRow(ent, period, period >= "03"
          ? { subscription_id: `syn-sub-rk-${ent.entitlementId.slice(-4)}` } : {});
        break;

      case "M15-billing-migration":
        // Whole-book migration from period 05: every billing key changes at once, legacy id retained.
        expectRow(ent, period); observeRow(ent, period); break;

      case "M16-unknown-expected-amount":
        // A usage-based line the contract system cannot price. BLANK, never zero.
        expectRow(ent, period, period === "03" ? { expected_amount: "" } : {});
        if (period !== "03") observeRow(ent, period);
        break;

      case "M17-ambiguous-identity":
        // Two schedule lines claim the same entitlement and period with NO supersession between them.
        expectRow(ent, period);
        if (period === "03") {
          expectRow(ent, period, {
            schedule_line_id: `${ent.entitlementId}-${period}-DUP`,
            expected_amount: money(Math.round(price * 0.6)),
          });
        }
        observeRow(ent, period); break;

      case "M18-unsupported-relationship": {
        // An unrelated payer's surplus happens to offset this one's shortfall EXACTLY. No mechanism
        // links them, so they must never be paired or netted.
        expectRow(ent, period);
        if (period === "03") break; // unbilled here
        observeRow(ent, period);
        if (period === "04") {
          const stranger = entitlements.find((x) => x.payerAccountId !== ent.payerAccountId
            && !x.parentAccountId && x.plan.minor === price && x !== ent);
          if (stranger) observeRow(stranger, period, { billed_amount: money(price * 2) });
        }
        break;
      }

      case "M19-cross-currency":
        // The contract is in EUR; billing raised USD. No governed rate exists, so no comparison is made.
        expectRow(ent, period, { currency: "EUR" });
        observeRow(ent, period); break;

      case "M20-multiple-mechanisms":
        // One payer, three entitlements, three different defects at once.
        if (ent.mechanism === "M20-multiple-mechanisms") {
          if (period === "03") { expectRow(ent, period); break; } // missing invoice
          expectRow(ent, period); observeRow(ent, period);
        } else if (ent.mechanism.endsWith("#2")) {
          expectRow(ent, period);
          observeRow(ent, period, period === "03" ? { billed_amount: money(Math.round(price * 0.7)) } : {});
        } else {
          expectRow(ent, period, { terminated_at: "2026-03-31" });
          observeRow(ent, period);
        }
        break;

      default:
        // M01 · clean recurring business. The noise the planted cases hide inside.
        expectRow(ent, period);
        observeRow(ent, period);
        // Realistic, valid messiness that must change no answer: an occasional credit note against a
        // correctly billed period, and an occasional re-issued invoice number.
        if (rand() < 0.04) {
          observeRow(ent, period, { billed_amount: money(Math.round(price * 0.1)), is_credit: "true" });
        }
    }
  }
}

// ── Ground truth, written from the narrative above ────────────────────────────────────────────────
const T = (mechanism, fields) => {
  const cohort = assigned.get(mechanism) ?? [];
  if (cohort.length === 0) return;
  plant(mechanism, cohort[0], {
    cohort_size: cohort.length,
    cohort_entitlements: cohort.map((e) => e.entitlementId).join(" "),
    ...fields,
  });
};
/** Σ plan price across the mechanism's cohort — the exposure is the cohort's, not one row's. */
const px = (m) => (assigned.get(m) ?? []).reduce((n, e) => n + e.plan.minor, 0);

T("M02-missing-invoice", {
  should_have_happened: "March was invoiced for the full plan amount",
  what_actually_happened: "no invoice exists for March",
  authoritative_exposure_minor: px("M02-missing-invoice"),
  expected_nh_classification: "UNDER_BILLED",
  business_expectation: "one month of revenue never invoiced",
  nh_should_detect: "yes", nh_must_refuse: "no", money_unknown: "no", attribution_possible: "yes",
  source_facts_required: "expectation row for the period; absence of a matching observation",
});
T("M03-underbilled", {
  should_have_happened: "billed at the plan price", what_actually_happened: "billed at 80% of it",
  authoritative_exposure_minor: Math.round(px("M03-underbilled") * 0.2),
  expected_nh_classification: "UNDER_BILLED", business_expectation: "20% of one month under-invoiced",
  nh_should_detect: "yes", nh_must_refuse: "no", money_unknown: "no", attribution_possible: "yes",
  source_facts_required: "authoritative expected amount and billed amount for the same period",
});
T("M04-partial-billing", {
  should_have_happened: "the whole obligation invoiced", what_actually_happened: "45% invoiced, remainder never followed",
  authoritative_exposure_minor: px("M04-partial-billing") - Math.round(px("M04-partial-billing") * 0.45),
  expected_nh_classification: "UNDER_BILLED", business_expectation: "the unbilled remainder of one month",
  nh_should_detect: "yes", nh_must_refuse: "no", money_unknown: "no", attribution_possible: "yes",
  source_facts_required: "expected and billed amounts at one grain",
});
T("M05-split-invoice", {
  should_have_happened: "the obligation settled", what_actually_happened: "settled by two invoices summing correctly",
  authoritative_exposure_minor: 0, expected_nh_classification: "MONETARILY_BALANCED",
  business_expectation: "nothing is owed; splitting an invoice is a billing choice",
  nh_should_detect: "no", nh_must_refuse: "no", money_unknown: "no", attribution_possible: "yes",
  source_facts_required: "both invoices allocated to the same obligation and period",
});
T("M06-consolidated-invoice", {
  should_have_happened: "two periods invoiced", what_actually_happened: "both carried on one invoice, allocated per line",
  authoritative_exposure_minor: 0, expected_nh_classification: "MONETARILY_BALANCED",
  business_expectation: "nothing is owed; consolidation is a billing choice",
  nh_should_detect: "no", nh_must_refuse: "no", money_unknown: "no", attribution_possible: "yes",
  source_facts_required: "per-line period allocation on the consolidated invoice",
});
T("M07-duplicate-masks-missing", {
  should_have_happened: "February once and March once",
  what_actually_happened: "February twice, March never",
  authoritative_exposure_minor: px("M07-duplicate-masks-missing"),
  expected_nh_classification: "MONETARILY_BALANCED",
  business_expectation: "a month of revenue is missing AND a customer was double-billed; two problems",
  nh_should_detect: "no", nh_must_refuse: "no", money_unknown: "no", attribution_possible: "no",
  source_facts_required: "PER-OBLIGATION EVENT IDENTITY — the money nets to zero at every grain",
});
T("M08-wrong-entitlement", {
  should_have_happened: "billed against this entitlement", what_actually_happened: "billed against a sibling of the same payer",
  authoritative_exposure_minor: px("M08-wrong-entitlement"),
  expected_nh_classification: "UNDER_BILLED paired SIBLING_ENTITLEMENT_SAME_PAYER",
  business_expectation: "the company was paid in full; the dollar sits against the wrong obligation",
  nh_should_detect: "yes", nh_must_refuse: "no", money_unknown: "no", attribution_possible: "yes",
  source_facts_required: "payer identity on both sides, to reach the sibling",
});
T("M09-wrong-payer", {
  should_have_happened: "billed to the child account", what_actually_happened: "billed to the parent",
  authoritative_exposure_minor: px("M09-wrong-payer"),
  expected_nh_classification: "UNDER_BILLED paired SIBLING_PAYER_UNDER_HIERARCHY",
  business_expectation: "paid in full, by the wrong entity in the same group",
  nh_should_detect: "yes", nh_must_refuse: "no", money_unknown: "no", attribution_possible: "yes",
  source_facts_required: "AUTHORITATIVE payer hierarchy, supplied as governed terms",
});
T("M10-billed-after-cancellation", {
  should_have_happened: "billing stopped after February", what_actually_happened: "billing continued for months after a dated cancellation",
  authoritative_exposure_minor: 0, expected_nh_classification: "OVER_BILLED / NOT_EXPECTED",
  business_expectation: "the company owes money back; a liability, never recovered revenue",
  nh_should_detect: "yes", nh_must_refuse: "no", money_unknown: "no", attribution_possible: "yes",
  source_facts_required: "DATED termination on the expectation side",
});
T("M11-missed-after-amendment", {
  should_have_happened: "the amended (higher) price invoiced from March",
  what_actually_happened: "the old price kept being invoiced",
  authoritative_exposure_minor: Math.round(px("M11-missed-after-amendment") * 0.3) * 4, // 4 periods (Mar-Jun)
  expected_nh_classification: "UNDER_BILLED",
  business_expectation: "the uplift from the amendment was never billed, four months running",
  nh_should_detect: "yes", nh_must_refuse: "no", money_unknown: "no", attribution_possible: "yes",
  source_facts_required: "amendment date AND supersession link, or the old line reads as still owed",
});
T("M12-pause-resume", {
  should_have_happened: "nothing owed for March", what_actually_happened: "nothing billed for March",
  authoritative_exposure_minor: 0, expected_nh_classification: "NOT_EXPECTED",
  business_expectation: "correct; a dated pause voids the period",
  nh_should_detect: "no", nh_must_refuse: "no", money_unknown: "no", attribution_possible: "yes",
  source_facts_required: "BOTH pause bounds dated",
});
T("M13-renewal", {
  should_have_happened: "billing continues across the renewal", what_actually_happened: "it did",
  authoritative_exposure_minor: 0, expected_nh_classification: "MONETARILY_BALANCED",
  business_expectation: "nothing owed; a renewal under a new contract id is not a leak",
  nh_should_detect: "no", nh_must_refuse: "no", money_unknown: "no", attribution_possible: "yes",
  source_facts_required: "identity that survives a contract-id change",
});
T("M14-rekeyed-identity", {
  should_have_happened: "the same obligation billed under whatever key billing now uses",
  what_actually_happened: "billing re-keyed with no mapping; the expectation still names the old key",
  authoritative_exposure_minor: 0, expected_nh_classification: "REFUSED_UNMATCHED_IDENTITY",
  business_expectation: "NOTHING is owed — the invoices exist, under another name",
  nh_should_detect: "no", nh_must_refuse: "YES", money_unknown: "no", attribution_possible: "no",
  source_facts_required: "an AUTHORITATIVE alias map; without it the honest answer is a refusal",
});
T("M15-billing-migration", {
  should_have_happened: "the book billed normally after the migration", what_actually_happened: "it did, under new keys, with the legacy key retained",
  authoritative_exposure_minor: 0, expected_nh_classification: "MONETARILY_BALANCED where the legacy key is used, REFUSED otherwise",
  business_expectation: "nothing is owed; a migration is not a leak, and reading it as one would be the single largest false positive available",
  nh_should_detect: "no", nh_must_refuse: "depends on grain", money_unknown: "no", attribution_possible: "yes",
  source_facts_required: "the retained legacy identity, or a governed alias",
});
T("M16-unknown-expected-amount", {
  should_have_happened: "a usage-based period invoiced for its actual usage",
  what_actually_happened: "the contract system cannot price it and left it blank; nothing was billed",
  authoritative_exposure_minor: null, expected_nh_classification: "NO_RESIDUAL_UNPRICED",
  business_expectation: "something is probably owed and NOBODY CAN SAY HOW MUCH — counted, never valued",
  nh_should_detect: "as UNKNOWN", nh_must_refuse: "no", money_unknown: "YES", attribution_possible: "yes",
  source_facts_required: "an authoritative amount, which does not exist for this line",
});
T("M17-ambiguous-identity", {
  should_have_happened: "one obligation for the period", what_actually_happened: "two schedule lines claim it with no supersession between them",
  authoritative_exposure_minor: null, expected_nh_classification: "REFUSED / quarantined at validation (NH-EX-2016)",
  business_expectation: "unknowable from this export; summing them would state an amount neither line asserts",
  nh_should_detect: "no", nh_must_refuse: "YES", money_unknown: "YES", attribution_possible: "no",
  source_facts_required: "a supersession link, or one line per obligation",
});
T("M18-unsupported-relationship", {
  should_have_happened: "this obligation billed; the stranger billed its own amount",
  what_actually_happened: "this one unbilled; an UNRELATED payer over-billed by exactly the same figure",
  authoritative_exposure_minor: px("M18-unsupported-relationship"),
  expected_nh_classification: "UNDER_BILLED, UNPAIRED",
  business_expectation: "a real shortfall here and a separate over-bill there; two problems, and their sum is zero problems, which is false",
  nh_should_detect: "yes", nh_must_refuse: "no", money_unknown: "no", attribution_possible: "no",
  source_facts_required: "nothing further — the point is that NO mechanism links them, so pairing is forbidden",
});
T("M19-cross-currency", {
  should_have_happened: "a EUR obligation invoiced in EUR", what_actually_happened: "invoiced in USD",
  authoritative_exposure_minor: null, expected_nh_classification: "REFUSED_CURRENCY_MISMATCH",
  business_expectation: "unknowable without a rate NH does not hold and must not invent",
  nh_should_detect: "no", nh_must_refuse: "YES", money_unknown: "YES", attribution_possible: "no",
  source_facts_required: "a governed conversion rate, which is deliberately absent",
});
// M20's exposure spans the SIBLINGS too, which `px` does not see because they are not in the cohort
// map. The first form of this entry counted only the first entitlement and therefore UNDERSTATED the
// planted truth — a ground-truth error, and the kind that makes a detector look better than it is.
const m20Sibling2 = siblings[0];
const m20Exposure = px("M20-multiple-mechanisms")
  + (m20Sibling2 ? Math.round(m20Sibling2.plan.minor * 0.3) : 0);
T("M20-multiple-mechanisms", {
  should_have_happened: "three entitlements of one payer billed correctly",
  what_actually_happened: "one month missing on the first, a 30% under-bill on the second, billing past a dated cancellation on the third",
  sibling_entitlements: siblings.map((e) => e.entitlementId).join(" "),
  authoritative_exposure_minor: m20Exposure,
  expected_nh_classification: "UNDER_BILLED on two units, OVER_BILLED/NOT_EXPECTED on the third",
  business_expectation: "three independent problems on one account; they must be reported separately and never netted",
  nh_should_detect: "yes", nh_must_refuse: "no", money_unknown: "no", attribution_possible: "yes",
  source_facts_required: "per-unit residuals, and no netting across the account",
});

// ── Write ─────────────────────────────────────────────────────────────────────────────────────────
//
// THE SCHEMA IS DECLARED, NOT INFERRED FROM THE FIRST ROW.
//
// The first form of this writer took its columns from `Object.keys(rows[0])`. Any field present only on
// a LATER row was therefore dropped silently, and one was: `sibling_entitlements` exists on the M20
// truth row and in `planted-register.json`, but never reached `ground-truth.csv`. The scorer could not
// see that `syn-ent-0001` belongs to M20 and charged $89.70 of correctly-detected money as fabricated.
//
// A measurement defect, not a product defect — the authoritative register never lost the field. But it
// is the worst kind, because it was invisible: nothing errored, nothing was malformed, and the figure
// it corrupted looked exactly like a real result.
//
// So the column list is now REQUIRED and EXPLICIT, and the writer asserts that every key on every row
// appears in it. A late field can no longer be lost silently, because it now fails loudly instead.
const EXPECTATION_COLUMNS = [
  "contract_id", "schedule_line_id", "entitlement_id", "account_id", "payer_account_id",
  "parent_account_id", "legacy_schedule_id", "period_start", "period_end", "expected_amount",
  "currency", "terminated_at", "pause_start", "pause_end", "amended_at",
  "supersedes_schedule_line_id", "product_code", "source_system",
];
const OBSERVATION_COLUMNS = [
  "invoice_id", "invoice_line_id", "invoice_number", "billing_account_id", "subscription_id",
  "legacy_subscription_id", "payer_account_id", "period_start", "period_end", "billed_amount",
  "currency", "is_credit", "issued_at", "source_system",
  "obligation_ref",
];
/** The governed ground-truth schema. `sibling_entitlements` is here because it is part of the truth. */
const GROUND_TRUTH_COLUMNS = [
  "mechanism", "first_entitlement_id", "payer_account_id", "cohort_size", "cohort_entitlements",
  "sibling_entitlements", "should_have_happened", "what_actually_happened",
  "authoritative_exposure_minor", "expected_nh_classification", "business_expectation",
  "nh_should_detect", "nh_must_refuse", "money_unknown", "attribution_possible",
  "source_facts_required",
];

const csv = (rows, declaredColumns) => {
  if (!Array.isArray(declaredColumns) || declaredColumns.length === 0) {
    throw new Error("csv() requires an explicit column schema — inferring it from a row is the defect");
  }
  // THE GUARANTEE. Any key on any row that the schema does not declare stops the generator dead.
  const declared = new Set(declaredColumns);
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!declared.has(key)) {
        throw new Error(`field "${key}" is not in the declared schema — it would have been silently dropped`);
      }
    }
  }
  if (rows.length === 0) return "";
  const cell = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [declaredColumns.join(","), ...rows.map((r) => declaredColumns.map((c) => cell(r[c])).join(","))].join("\n");
};

mkdirSync(OUT, { recursive: true });
const files = {
  "expectation.csv": csv(E, EXPECTATION_COLUMNS),
  "observation.csv": csv(O, OBSERVATION_COLUMNS),
  "ground-truth.csv": csv(
    truth.map((t) => ({ ...t, authoritative_exposure_minor: t.authoritative_exposure_minor ?? "UNKNOWN" })),
    GROUND_TRUTH_COLUMNS,
  ),
  "planted-register.json": `${JSON.stringify({
    seed: SEED, currency: CURRENCY, periods: PERIODS, migrationPeriod: MIGRATION_PERIOD,
    payerCount: payers.length, entitlementCount: entitlements.length,
    expectationRows: E.length, observationRows: O.length,
    mechanisms: MECHANISMS,
    plantedCases: truth,
    claimBoundary: {
      synthetic: true, observationOnly: true, constitutesProof: false, constitutesRevenue: false,
      note: "No figure here is Revenue Returned, recovered money, or evidence about any real customer.",
    },
  }, null, 2)}\n`,
};
for (const [name, text] of Object.entries(files)) writeFileSync(`${OUT}/${name}`, text);

// The freeze gate. A composite hash over every artefact, so the experiment cannot be adjusted after a
// result is seen — the discipline the EP-31 harness established and this one inherits.
const sha = (t) => createHash("sha256").update(t).digest("hex");
const record = {
  frozenAt: "2026-10-07", variant: "OBLIGATION_REF", derivedFrom: "V3", seed: SEED,
  files: Object.fromEntries(Object.entries(files).map(([n, t]) => [n, sha(t)])),
  // The generator hashes ITSELF. Without this the freeze would cover the outputs while leaving the
  // narrative that produced them editable, which is the half of the experiment most worth pinning.
  generator: sha(readFileSync(new URL(import.meta.url), "utf8")),
  counts: { payers: payers.length, entitlements: entitlements.length, expectation: E.length, observation: O.length, plantedCases: truth.length },
};
writeFileSync(`${OUT}/FROZEN.json`, `${JSON.stringify({ ...record, compositeSha256: sha(JSON.stringify(record)) }, null, 2)}\n`);

process.stdout.write(
  `wrote ${OUT}\n  payers ${payers.length} · entitlements ${entitlements.length}\n` +
  `  expectation rows ${E.length} · observation rows ${O.length}\n` +
  `  planted cases ${truth.length} of ${MECHANISMS.length} mechanisms\n`,
);

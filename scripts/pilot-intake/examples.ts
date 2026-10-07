// THE EXAMPLE ROWS, authored once and shared by the emitter and the verifier.
//
// They are SYNTHETIC and obviously fictional. Every identifier is in a visibly made-up namespace, there
// is no personal data of any kind, and the amounts are round numbers no real book would carry.
//
// WHAT THEY ARE FOR. A template tells a data owner which columns to produce; it cannot show them what a
// correct row LOOKS like, and the cases that go wrong in practice are exactly the ones a header cannot
// express — a pause, an amendment, a consolidated invoice, a credit, a re-keyed subscription, and an
// amount the contract system genuinely cannot state.
//
// WHAT THEY DELIBERATELY DO NOT SHOW. There is no additive-component column, because the expectation
// contract declares none. Where two obligation lines legitimately co-exist for one period, NH REFUSES to
// price that unit rather than guess, and the fact that would unlock it is not something a customer should
// be invited to invent — claiming distinctness inflates exposure, which is beneficiary-adverse. Showing a
// deliberately-refused row in a customer example would teach the wrong lesson, so the examples stay valid
// and the limitation is stated in the dictionary and in WHAT_NH_WILL_DO.
//
// They are not decoration: the verifier runs them through the REAL validators and the REAL readiness
// evaluator, so an example that would be rejected in practice fails the build here instead.

/** One expected obligation per row. Column order follows the governed field list, asserted by the verifier. */
export const EXPECTATION_EXAMPLE: readonly Readonly<Record<string, string>>[] = Object.freeze([
  // A plain monthly obligation, three periods running.
  Object.freeze({
    entitlement_ref: "ENT-1001", period_start: "2026-01-01", period_end: "2026-01-31",
    expected_amount: "2400.00", currency: "USD", payer_ref: "PAYER-NORTH",
    terminated_at: "", pause_start: "", pause_end: "", supersedes_ref: "", amended_at: "",
    schedule_line_ref: "SL-7781",
  }),
  Object.freeze({
    entitlement_ref: "ENT-1001", period_start: "2026-02-01", period_end: "2026-02-28",
    expected_amount: "2400.00", currency: "USD", payer_ref: "PAYER-NORTH",
    terminated_at: "", pause_start: "", pause_end: "", supersedes_ref: "", amended_at: "",
    schedule_line_ref: "SL-7782",
  }),
  // March was originally $2,400 — and then amended. BOTH rows are supplied: the original stays, and the
  // replacement points at it. That is what lets NH know the first is no longer owed, instead of reading
  // two live obligations for one month and refusing to price either.
  Object.freeze({
    entitlement_ref: "ENT-1001", period_start: "2026-03-01", period_end: "2026-03-31",
    expected_amount: "2400.00", currency: "USD", payer_ref: "PAYER-NORTH",
    terminated_at: "", pause_start: "", pause_end: "", supersedes_ref: "", amended_at: "",
    schedule_line_ref: "SL-7783",
  }),
  Object.freeze({
    entitlement_ref: "ENT-1001", period_start: "2026-03-01", period_end: "2026-03-31",
    expected_amount: "2750.00", currency: "USD", payer_ref: "PAYER-NORTH",
    terminated_at: "", pause_start: "", pause_end: "",
    supersedes_ref: "SL-7783", amended_at: "2026-02-20",
    schedule_line_ref: "SL-7783-A2",
  }),
  // Service paused for the whole month, with BOTH bounds. One bound without the other is refused, because
  // an open-ended pause cannot be told from a data-entry slip.
  Object.freeze({
    entitlement_ref: "ENT-1002", period_start: "2026-02-01", period_end: "2026-02-28",
    expected_amount: "900.00", currency: "USD", payer_ref: "PAYER-SOUTH",
    terminated_at: "", pause_start: "2026-02-01", pause_end: "2026-02-28",
    supersedes_ref: "", amended_at: "", schedule_line_ref: "SL-8120",
  }),
  // Ended, with the date. Without the date a finished entitlement reads as live and every later period
  // reads as unbilled — the single largest source of false findings.
  Object.freeze({
    entitlement_ref: "ENT-1003", period_start: "2026-01-01", period_end: "2026-01-31",
    expected_amount: "1500.00", currency: "USD", payer_ref: "PAYER-SOUTH",
    terminated_at: "2026-01-31", pause_start: "", pause_end: "",
    supersedes_ref: "", amended_at: "", schedule_line_ref: "SL-8440",
  }),
  // An obligation the contract system cannot price — a usage line. The amount is LEFT BLANK. It is not 0,
  // not 0.00 and not a dash: a blank is a fact NH handles correctly, and a zero would assert that nothing
  // was owed.
  Object.freeze({
    entitlement_ref: "ENT-1004", period_start: "2026-03-01", period_end: "2026-03-31",
    expected_amount: "", currency: "USD", payer_ref: "PAYER-WEST",
    terminated_at: "", pause_start: "", pause_end: "",
    supersedes_ref: "", amended_at: "", schedule_line_ref: "SL-9005",
  }),
]);

/** One settlement line per row. */
export const SETTLEMENT_EXAMPLE: readonly Readonly<Record<string, string>>[] = Object.freeze([
  // A plain invoice line, naming the obligation it settles.
  Object.freeze({
    invoice_ref: "INV-55010", invoice_line_ref: "1", settled_at: "2026-01-05",
    settled_amount: "2400.00", currency: "USD", payer_ref: "PAYER-NORTH",
    obligation_ref: "SL-7781", is_credit: "false",
    period_start: "2026-01-01", period_end: "2026-01-31",
    legacy_subscription_ref: "", source_system: "BILL-CORE",
  }),
  Object.freeze({
    invoice_ref: "INV-55044", invoice_line_ref: "1", settled_at: "2026-02-04",
    settled_amount: "2400.00", currency: "USD", payer_ref: "PAYER-NORTH",
    obligation_ref: "SL-7782", is_credit: "false",
    period_start: "2026-02-01", period_end: "2026-02-28",
    legacy_subscription_ref: "", source_system: "BILL-CORE",
  }),
  // ONE INVOICE, TWO OBLIGATIONS — a consolidated invoice, which is perfectly normal. Each line names its
  // own obligation and its own service period, so NH reads two settlements rather than one double charge.
  Object.freeze({
    invoice_ref: "INV-55100", invoice_line_ref: "1", settled_at: "2026-02-06",
    settled_amount: "900.00", currency: "USD", payer_ref: "PAYER-SOUTH",
    obligation_ref: "SL-8120", is_credit: "false",
    period_start: "2026-02-01", period_end: "2026-02-28",
    legacy_subscription_ref: "", source_system: "BILL-CORE",
  }),
  // ...and the second line covers a DIFFERENT month from the date the invoice was raised, which is why the
  // service period is its own fact and the issue date cannot stand in for it.
  Object.freeze({
    invoice_ref: "INV-55100", invoice_line_ref: "2", settled_at: "2026-02-06",
    settled_amount: "1500.00", currency: "USD", payer_ref: "PAYER-SOUTH",
    obligation_ref: "SL-8440", is_credit: "false",
    period_start: "2026-01-01", period_end: "2026-01-31",
    legacy_subscription_ref: "", source_system: "BILL-CORE",
  }),
  // A CREDIT, reversing the paused month. Negative, and marked. A negative line that is not marked is
  // refused, because reading it as a charge would subtract it from billed money.
  Object.freeze({
    invoice_ref: "INV-55210", invoice_line_ref: "1", settled_at: "2026-03-03",
    settled_amount: "-900.00", currency: "USD", payer_ref: "PAYER-SOUTH",
    obligation_ref: "SL-8120", is_credit: "true",
    period_start: "2026-02-01", period_end: "2026-02-28",
    legacy_subscription_ref: "", source_system: "BILL-CORE",
  }),
  // A RE-KEYED SUBSCRIPTION. Billing moved this account to a new platform and its internal key changed —
  // the old one is retained and the system is named. THE OBLIGATION REFERENCE DID NOT CHANGE, because it
  // was never billing's internal key. That is the whole reason it is worth asking for: a migration that
  // would otherwise make an entire book read as unbilled passes straight through.
  Object.freeze({
    invoice_ref: "INV-55300", invoice_line_ref: "1", settled_at: "2026-03-05",
    settled_amount: "2750.00", currency: "USD", payer_ref: "PAYER-NORTH",
    obligation_ref: "SL-7783-A2", is_credit: "false",
    period_start: "2026-03-01", period_end: "2026-03-31",
    legacy_subscription_ref: "SUB-OLD-4471", source_system: "BILL-CORE-2",
  }),
  // A settlement against the obligation whose expected amount is UNKNOWN. NH records that it was settled
  // and still reports the obligation as unpriced — it does not treat the billed figure as what was owed.
  Object.freeze({
    invoice_ref: "INV-55310", invoice_line_ref: "1", settled_at: "2026-03-06",
    settled_amount: "1800.00", currency: "USD", payer_ref: "PAYER-WEST",
    obligation_ref: "SL-9005", is_credit: "false",
    period_start: "2026-03-01", period_end: "2026-03-31",
    legacy_subscription_ref: "", source_system: "BILL-CORE",
  }),
]);

/** The row whose amount must stay blank, named so the verifier checks the right one. */
export const UNKNOWN_AMOUNT_OBLIGATION = "SL-9005";

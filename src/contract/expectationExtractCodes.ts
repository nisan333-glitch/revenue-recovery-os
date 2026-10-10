// Reason codes for the EXPECTATION EXTRACT — a THIRD catalogue, and deliberately not a branch of
// either existing one.
//
// `NH-DC-####` answers "is this observation file valid?" and `NH-AG-####` answers "is this dataset fit
// for a pilot?". Neither question is this one, which is "did the source state an obligation NH can
// trust?". Folding these into NH-DC would be worse than untidy: a customer reading a parse error would
// think a re-export fixes something that is actually a missing capability, and the 2.0.0 catalogue
// would silently acquire codes about a file it never describes.
//
//   1xxx — the EXTRACT is unusable as a whole.
//   2xxx — one ROW cannot be trusted. The row is QUARANTINED, never counted — not in a detector, not
//          in a union, not in a recall denominator. (The rule the Detector #3 work established.)
//   3xxx — a CAPABILITY is unavailable. This is an UNKNOWN, NOT a rejection: the extract is still
//          valid and still measures money through every capability that remains. Turning a missing
//          optional fact into a dataset rejection would discard datasets that measure real money,
//          which is the mistake `leakInstanceIdentityStatus` and `SOURCE_NAMESPACE_RESOLUTION_AVAILABLE`
//          are separately named to avoid.
//
// Codes are permanent. A superseded code is RETIRED, never recycled — same rule as the other two
// catalogues, for the same reason: a historical record cites a code, and a recycled code silently
// rewrites what that record said.

export type ExpectationCodeSeverity =
  /** The whole extract cannot be read. */
  | "extract_unusable"
  /** One row is quarantined. The rest of the extract is unaffected. */
  | "row_quarantined"
  /** A named capability is closed. Nothing is rejected and no money is lost. */
  | "capability_unavailable";

export interface ExpectationCodeSpec {
  readonly code: string;
  readonly severity: ExpectationCodeSeverity;
  readonly title: string;
  /** What someone must actually do. For 3xxx this is often "supply a column", not "fix a value". */
  readonly remediation: string;
  readonly since: string;
}

function code(spec: ExpectationCodeSpec): ExpectationCodeSpec {
  return Object.freeze(spec);
}

// ── 1xxx · the extract is unusable ────────────────────────────────────────────────────────────────

export const EXTRACT_CODES = Object.freeze({
  EMPTY_EXTRACT: code({
    code: "NH-EX-1001",
    severity: "extract_unusable",
    title: "The expectation extract contains no rows.",
    remediation:
      "Supply the obligations the source system expects to bill for the period under analysis. An empty extract is not the same as 'nothing was owed' and is never read as such — NH cannot tell the two apart, so it refuses rather than reporting a clean zero.",
    since: "1.0.0",
  }),
  MISSING_REQUIRED_COLUMN: code({
    code: "NH-EX-1002",
    severity: "extract_unusable",
    title: "A required column is absent from the extract header.",
    remediation:
      "Add the named column. Only five facts are required — the entitlement, both period bounds, the amount column and the currency — because without them no reconciliation unit exists at all. Every other fact is a named capability and never a reason to refuse a file.",
    since: "1.0.0",
  }),
  UNDECLARED_COLUMN: code({
    code: "NH-EX-1003",
    severity: "extract_unusable",
    title: "The extract carries a column this contract does not declare.",
    remediation:
      "Remove the column or raise it for declaration. An undeclared column is refused rather than ignored: silently dropping it would let a customer believe NH read a fact it never looked at.",
    since: "1.0.0",
  }),
  DUPLICATE_COLUMN: code({
    code: "NH-EX-1004",
    severity: "extract_unusable",
    title: "The same column appears more than once in the header.",
    remediation:
      "Emit each column once. Which duplicate wins would otherwise be decided by file position, and file position is the author's lever — the pilot-dataset collision rule applies here too.",
    since: "1.0.0",
  }),
});

// ── 2xxx · one row is quarantined ─────────────────────────────────────────────────────────────────

export const ROW_CODES = Object.freeze({
  MISSING_REQUIRED_VALUE: code({
    code: "NH-EX-2001",
    severity: "row_quarantined",
    title: "A required cell is blank.",
    remediation:
      "Populate it. NOTE the one deliberate exception: a blank `expected_amount` is NOT this error — it is a declared UNKNOWN, which is counted and never valued.",
    since: "1.0.0",
  }),
  MALFORMED_DATE: code({
    code: "NH-EX-2002",
    severity: "row_quarantined",
    title: "A date cannot be parsed.",
    remediation: "Use YYYY-MM-DD. NH does not guess at a date it cannot read.",
    since: "1.0.0",
  }),
  AMBIGUOUS_DATE: code({
    code: "NH-EX-2003",
    severity: "row_quarantined",
    title: "A numeric date is ambiguous and no locale was supplied.",
    remediation:
      "Emit ISO dates, or register the extract's date locale as a governed term. 03/04/2026 is two different days and NH will not pick one.",
    since: "1.0.0",
  }),
  PERIOD_END_BEFORE_START: code({
    code: "NH-EX-2004",
    severity: "row_quarantined",
    title: "The period ends before it starts.",
    remediation: "Correct the bounds. NH never reorders a period to make it valid.",
    since: "1.0.0",
  }),
  MALFORMED_AMOUNT: code({
    code: "NH-EX-2005",
    severity: "row_quarantined",
    title: "The expected amount is present but cannot be parsed as money.",
    remediation:
      "Emit a plain decimal, or register the amount format as a governed term. A cell that cannot be parsed is NOT treated as an unknown amount — an unknown is a BLANK, and the two must stay distinguishable.",
    since: "1.0.0",
  }),
  EXPLICIT_ZERO_AMOUNT: code({
    code: "NH-EX-2018",
    severity: "row_quarantined",
    title: "The expected amount is explicitly zero.",
    remediation:
      "An obligation of zero is not an obligation. If the amount is genuinely UNKNOWN, leave the cell BLANK — that is a declared unknown and the expectation survives it. Writing 0 asserts that nothing is owed, which is a different claim and one that would silently satisfy itself against any billing at all.",
    since: "1.1.0",
  }),
  NEGATIVE_AMOUNT: code({
    code: "NH-EX-2019",
    severity: "row_quarantined",
    title: "The expected amount is negative.",
    remediation:
      "A negative expectation is a credit, and a credit belongs to the observation side — never to a statement of what is owed. Kept separate from an explicit zero because the two are different source errors with different fixes: one is a modelling mistake, the other is a row in the wrong file.",
    since: "1.1.0",
  }),
  UNSUPPORTED_CURRENCY: code({
    code: "NH-EX-2007",
    severity: "row_quarantined",
    title: "The row's currency is not one whose minor units NH knows.",
    remediation: "Use a supported ISO 4217 code. NH never assumes a minor-unit exponent.",
    since: "1.0.0",
  }),
  CURRENCY_NOT_GOVERNED: code({
    code: "NH-EX-2008",
    severity: "row_quarantined",
    title: "The row's currency is not the governed currency for this analysis.",
    remediation:
      "Submit the rows of each currency under their own governed terms. NH holds no exchange rate and will not convert: a converted amount is a number NH authored, not one the source stated.",
    since: "1.0.0",
  }),
  PAUSE_BOUNDS_INCOMPLETE: code({
    code: "NH-EX-2009",
    severity: "row_quarantined",
    title: "One pause bound is present without the other.",
    remediation:
      "Supply both. An open-ended pause would void every later period, which is the largest single false-NEGATIVE a lifecycle fact can cause, and NH will not close it with an assumed date.",
    since: "1.0.0",
  }),
  PAUSE_END_BEFORE_START: code({
    code: "NH-EX-2010",
    severity: "row_quarantined",
    title: "The pause ends before it starts.",
    remediation:
      "Correct the bounds. NH does not swap them to make the pause valid: a reversed pair may equally be a typo in either date, and guessing which would decide whether a period was owed.",
    since: "1.0.0",
  }),
  AMENDMENT_WITHOUT_DATE: code({
    code: "NH-EX-2011",
    severity: "row_quarantined",
    title: "A row supersedes another but carries no amendment date.",
    remediation:
      "Supply the date the amendment took effect. Without it two lines claim one period and nothing orders them, so NH cannot tell which is in force.",
    since: "1.0.0",
  }),
  SUPERSEDES_SELF: code({
    code: "NH-EX-2012",
    severity: "row_quarantined",
    title: "A row supersedes itself.",
    remediation: "Point the reference at the line actually replaced, or remove it.",
    since: "1.0.0",
  }),
  SUPERSEDES_UNRESOLVED: code({
    code: "NH-EX-2013",
    severity: "row_quarantined",
    title: "A supersession points at a schedule line that is not in this extract.",
    remediation:
      "Include the superseded line, or omit the reference. A dangling supersession is refused rather than ignored: ignoring it would silently promote the amendment to an unamended obligation.",
    since: "1.0.0",
  }),
  SUPERSESSION_CYCLE: code({
    code: "NH-EX-2014",
    severity: "row_quarantined",
    title: "Supersession references form a cycle.",
    remediation:
      "Amendment lineage is an ordering and an ordering has a first element. NH refuses the cycle rather than entering it.",
    since: "1.0.0",
  }),
  DUPLICATE_SCHEDULE_LINE: code({
    code: "NH-EX-2015",
    severity: "row_quarantined",
    title: "Two rows share one schedule-line identity.",
    remediation:
      "Emit each line once. ALL rows sharing the identity are quarantined, regardless of order or identical content — no surviving row may be chosen by file position. This is the pilot-dataset collision rule, applied to the expectation side.",
    since: "1.0.0",
  }),
  AMBIGUOUS_LIVE_LINES: code({
    code: "NH-EX-2016",
    severity: "row_quarantined",
    title: "Two unsuperseded lines claim one entitlement and one period.",
    remediation:
      "Link the replacement to what it replaces. Summing them would state an obligation neither line asserts, and choosing one would be NH picking the customer's number for them — this is exactly the case that manufactures money when the supersession link is missing.",
    since: "1.0.0",
  }),
  CONTRADICTORY_TERMINATION: code({
    code: "NH-EX-2017",
    severity: "row_quarantined",
    title: "One entitlement carries two different termination dates.",
    remediation:
      "An entitlement ends once. Two dates is a source contradiction, and NH refuses rather than taking the earlier (which would hide money) or the later (which would manufacture it).",
    since: "1.0.0",
  }),
});

// ── 3xxx · a capability is unavailable (an UNKNOWN, never a rejection) ────────────────────────────

export const CAPABILITY_CODES = Object.freeze({
  PAYER_RELATION_UNAVAILABLE: code({
    code: "NH-EX-3001",
    severity: "capability_unavailable",
    title: "No payer is stated, so sibling-entitlement attribution is closed.",
    remediation:
      "Supply `payer_ref` on every row. Without it a positive residual whose counterpart sits on a sibling entitlement stays in the headline as UNEXPLAINED exposure. That is the conservative direction — the money is still reported, just not attributed.",
    since: "1.0.0",
  }),
  LIFECYCLE_TERMINATION_UNAVAILABLE: code({
    code: "NH-EX-3002",
    severity: "capability_unavailable",
    title: "Terminations are not reported, so an ended obligation cannot be recognised.",
    remediation:
      "Declare `terminated_at`. Without the column every terminated entitlement reads as live and its periods read as unbilled — a FALSE POSITIVE, and the benchmark prices one at exactly $100.00.",
    since: "1.0.0",
  }),
  LIFECYCLE_PAUSE_UNAVAILABLE: code({
    code: "NH-EX-3003",
    severity: "capability_unavailable",
    title: "Pauses are not reported, so a suspended period cannot be recognised.",
    remediation:
      "Declare `pause_start` and `pause_end`. Without them a paused period reads as unbilled — the same false positive, priced at $100.00 in the benchmark.",
    since: "1.0.0",
  }),
  AMENDMENT_LINEAGE_UNAVAILABLE: code({
    code: "NH-EX-3004",
    severity: "capability_unavailable",
    title: "Amendment lineage is not reported, so a superseded line cannot be retired.",
    remediation:
      "Declare `supersedes_ref` and `amended_at`. Without them a replaced obligation reads as still owed alongside its replacement — $100.00 in the benchmark.",
    since: "1.0.0",
  }),
  EVENT_IDENTITY_UNAVAILABLE: code({
    code: "NH-EX-3005",
    severity: "capability_unavailable",
    title: "No per-obligation identity, so event reconciliation and correlation are closed.",
    remediation:
      "Supply `schedule_line_ref` on every row. MONETARY reconciliation is unaffected and still measures every dollar it can. What is lost is the class of leak only an event check can see — a duplicate invoice masking an omission nets to zero money at every grain, so no monetary method can reach it.",
    since: "1.0.0",
  }),
});

export const UNIT_CAPABILITY_CODES = Object.freeze({
  MONETARY_QUANTIFICATION_UNAVAILABLE: code({
    code: "NH-EX-3006",
    severity: "capability_unavailable",
    title: "This unit has no authoritative amount, so it cannot be quantified in money.",
    remediation:
      "Supply the amount if the source can state it authoritatively; otherwise this is the correct and final answer for this unit. The EXPECTATION IS STILL REAL and is still carried — what is unavailable is its monetary quantification, and every capability that needs an exact figure fails closed for this unit alone. The amount is never estimated, never averaged from prior invoices, never taken from a plan price and never rendered as $0.00.",
    since: "1.1.0",
  }),
});

/**
 * RETIRED. Never recycled, never re-pointed at a new meaning.
 *
 * `NH-EX-2006` once meant "zero or negative", which conflated two different source errors — a
 * modelling mistake and a row in the wrong file — behind one remediation. It is replaced by
 * `NH-EX-2018` and `NH-EX-2019`, one meaning each.
 *
 * Nothing ever cited it: the validator has no production consumer, nothing is persisted and no
 * customer received it, so narrowing it in place would have been harmless IN FACT. It is retired
 * anyway, because the rule in this file's header is stated without an exception and a rule that bends
 * when breaking it is convenient is not a rule. The cost of honouring it here is one unused integer.
 */
export const RETIRED_CODES: readonly { readonly code: string; readonly meant: string; readonly replacedBy: readonly string[] }[] =
  Object.freeze([
    Object.freeze({
      code: "NH-EX-2006",
      meant: "The expected amount is zero or negative.",
      replacedBy: Object.freeze(["NH-EX-2018", "NH-EX-2019"]),
    }),
  ]);

/** Every code, for the exhaustiveness and uniqueness guards. */
export const ALL_EXPECTATION_CODES: readonly ExpectationCodeSpec[] = Object.freeze([
  ...Object.values(EXTRACT_CODES),
  ...Object.values(ROW_CODES),
  ...Object.values(CAPABILITY_CODES),
  ...Object.values(UNIT_CAPABILITY_CODES),
]);

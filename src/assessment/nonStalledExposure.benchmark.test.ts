// GROUND-TRUTH BENCHMARK for Detector #2 — how much planted money it finds, and how much it invents.
//
// Driven through the REAL path: CSV → contract adapter → `assessCsv`. Constructing cycles directly would
// prove the arithmetic works; driving the CSV proves the capability works on admitted customer data,
// which is the only claim worth making.
//
// THE REGRESSION TARGET comes from the frozen independent business register
// (`e2e/fixtures/synthetic-validation-2026-09-27/ground-truth.json`), which priced the blind spot before
// this detector existed. Enumerating every planted scenario whose cohort is reference/undetermined and
// whose payment state is Unpaid or PartiallyPaid gives exactly two obligations:
//
//   S18  n-unpaid-but-activated-promptly   930 000 minor   unpaid_invoice_without_activation_stall
//   S17  n-exactly-at-threshold            550 000 minor   near_miss_exact_threshold
//   ----------------------------------------------------------------------------------------
//        1 480 000 minor = $14,800.00   = the audit's "Representable, not detected | 2 | $14,800.00"
//
// $9,300 is S18 alone — the figure the audit named — and it is NOT replaced here. $5,500 is S17, the
// audit's second representable-but-undetected class. Both are Unpaid; the frozen corpus contains NO
// non-stalled PartiallyPaid obligation at all, so the partial path gets its own ground truth below rather
// than a borrowed claim.
//
// Both frozen rows carry `expected_amount_minor: 0` and `expected_bucket: "none"`. Those remain TRUE:
// they are claims about the stalled surface, which this slice leaves byte-identical. A new, separately
// named bucket is something the frozen register says nothing about.
//
// THIS IS SYNTHETIC VALIDATION, NOT RECOVERY PROOF. No dollar here is recovered, recoverable, returned or
// proven, and one fixture supports no claim about the other 23 families of the revenue chain.
import { describe, it, expect } from "vitest";
import { assessCsv } from "./assess";
import { makePolicy } from "./policy";

const HEADER =
  "entity_id,subscription_id,signed_at,activation_at,next_invoice_due_at," +
  "next_invoice_paid_at,paid_amount,next_invoice_amount,currency,status,refunded_at,cancelled_at";
const CREATED = "2026-07-01T00:00:00.000Z";
/** N=30 and asOf match the frozen run's governed terms, so S17 sits exactly on the boundary. */
const policy = makePolicy({ stallThresholdDays: 30, asOf: "2026-06-30", currency: "USD" });

/** One planted obligation, with what the business register says it is worth to Detector #2. */
interface Planted {
  readonly id: string;
  readonly row: string;
  /** Minor units Detector #2 SHOULD report for this row. 0 means "must not contribute". */
  readonly expectUnpaidMinor: number;
  readonly expectPartialMinor: number;
  readonly why: string;
}

const PLANTED: readonly Planted[] = [
  // ── The two frozen regression targets ────────────────────────────────────────────────────────────
  {
    id: "S18-unpaid-but-activated-promptly",
    row: "S18,SUB-S18,2026-03-01,2026-03-03,2026-04-01,,,9300.00,USD,active,,",
    expectUnpaidMinor: 930_000, expectPartialMinor: 0,
    why: "activated promptly ⇒ reference cohort ⇒ invisible to every stalled total. THE audit's $9,300.",
  },
  {
    id: "S17-exactly-at-threshold",
    row: "S17,SUB-S17,2026-03-01,2026-03-31,2026-04-01,,,5500.00,USD,active,,",
    expectUnpaidMinor: 550_000, expectPartialMinor: 0,
    why: "activated at exactly signed+30; the rule is strictly greater-than ⇒ NOT stalled ⇒ reference.",
  },
  // ── Partial payment · this slice's own ground truth, since the frozen corpus has none ────────────
  {
    id: "P1-partial-remainder",
    row: "P1,SUB-P1,2026-03-01,2026-03-05,2026-04-01,2026-04-10,3000.00,8000.00,USD,active,,",
    expectUnpaidMinor: 0, expectPartialMinor: 500_000,
    why: "8000 obligated, 3000 settled ⇒ exposure is the 5000 remainder, never the full invoice.",
  },
  {
    id: "P2-partial-odd-cents",
    row: "P2,SUB-P2,2026-03-01,2026-03-05,2026-04-01,2026-04-10,1234.56,2000.01,USD,active,,",
    expectUnpaidMinor: 0, expectPartialMinor: 76_545,
    why: "exactness to the cent: 200001 − 123456 = 76545 minor, with no rounding anywhere.",
  },
  // ── Adversarial controls · every one of these must contribute ZERO ───────────────────────────────
  {
    id: "C1-not-yet-due",
    row: "C1,SUB-C1,2026-06-01,2026-06-03,2026-07-20,,,4100.00,USD,active,,",
    expectUnpaidMinor: 0, expectPartialMinor: 0,
    why: "due after asOf ⇒ NotYetDue. A future invoice is not a leak — the worst available false positive.",
  },
  {
    id: "C2-paid-on-time",
    row: "C2,SUB-C2,2026-03-01,2026-03-05,2026-04-01,2026-03-28,6000.00,6000.00,USD,active,,",
    expectUnpaidMinor: 0, expectPartialMinor: 0,
    why: "settled in full before the due date.",
  },
  {
    id: "C3-paid-late-in-full",
    row: "C3,SUB-C3,2026-03-01,2026-03-05,2026-04-01,2026-05-15,7000.00,7000.00,USD,active,,",
    expectUnpaidMinor: 0, expectPartialMinor: 0,
    why: "late is an operational signal, not OUTSTANDING money. Zero exposure, still counted as PaidLate.",
  },
  {
    id: "C4-dated-refund",
    row: "C4,SUB-C4,2026-03-01,2026-03-05,2026-04-01,,,4400.00,USD,refunded,2026-04-15,",
    expectUnpaidMinor: 0, expectPartialMinor: 0,
    why: "a DATED refund is excluded from company exposure and surfaced in its own bucket.",
  },
  {
    id: "C5-dated-cancellation",
    row: "C5,SUB-C5,2026-03-01,2026-03-05,2026-04-01,,,6700.00,USD,cancelled,,2026-04-20",
    expectUnpaidMinor: 0, expectPartialMinor: 0,
    why: "a DATED cancellation, likewise. An UNDATED one never reaches a cycle — the adapter rejects it.",
  },
  {
    id: "C6-settled-but-untimeable",
    row: "C6,SUB-C6,2026-03-01,2026-03-05,2026-04-01,,2500.00,9000.00,USD,active,,",
    expectUnpaidMinor: 0, expectPartialMinor: 0,
    why: "a paid amount with no payment date ⇒ Unknown. Zero-guess: we never infer when money arrived.",
  },
  {
    id: "C7-stalled-unpaid",
    row: "C7,SUB-C7,2026-03-01,,2026-04-01,,,8800.00,USD,active,,",
    expectUnpaidMinor: 0, expectPartialMinor: 0,
    why: "never activated ⇒ STALLED ⇒ belongs to the existing headline and must not be double counted.",
  },
];

const EXPECTED_UNPAID = PLANTED.reduce((n, p) => n + p.expectUnpaidMinor, 0);
const EXPECTED_PARTIAL = PLANTED.reduce((n, p) => n + p.expectPartialMinor, 0);
const EXPECTED_TOTAL = EXPECTED_UNPAID + EXPECTED_PARTIAL;

const csv = [HEADER, ...PLANTED.map((p) => p.row)].join("\n");

describe("Detector #2 · ground-truth benchmark through the real CSV path", () => {
  it("BEFORE/AFTER · the stalled surface misses the planted money and Detector #2 finds it", async () => {
    const r = await assessCsv(csv, policy, { createdAt: CREATED });

    // Every row must be ADMITTED. A benchmark that silently lost rows to the adapter would be measuring
    // the adapter, not the detector.
    expect(r.excludedRowCount, JSON.stringify(r.exclusions)).toBe(0);
    expect(r.acceptedCycleCount).toBe(PLANTED.length);

    // BEFORE — what the product reported before this slice. The two frozen regression targets contribute
    // nothing to the headline, exactly as `expected_amount_minor: 0` says they must.
    expect(r.observed.observedUnpaid.minor).toBe(880_000); // C7 alone: the one genuinely stalled row
    expect(r.observed.partialOutstanding.minor).toBe(0);

    // AFTER — Detector #2, on the same admitted data.
    expect(r.nonStalledExposure.overdueUnpaid.minor).toBe(EXPECTED_UNPAID);
    expect(r.nonStalledExposure.overduePartialOutstanding.minor).toBe(EXPECTED_PARTIAL);

    // And the headline figure is UNCHANGED by the slice — the money moved nowhere, it was merely seen.
    expect(r.observed.observedUnpaid.minor + r.nonStalledExposure.overdueUnpaid.minor).toBe(
      880_000 + EXPECTED_UNPAID,
    );
  });

  it("finds the audit's $9,300 and $5,500 as separate obligations, to the cent", async () => {
    // Each target isolated, so a total that happened to add up could not hide a wrong attribution.
    for (const p of PLANTED.filter((x) => x.id.startsWith("S1"))) {
      const one = await assessCsv([HEADER, p.row].join("\n"), policy, { createdAt: CREATED });
      expect(one.nonStalledExposure.overdueUnpaid.minor, p.id).toBe(p.expectUnpaidMinor);
      expect(one.observed.observedUnpaid.minor, `${p.id} must stay out of the headline`).toBe(0);
    }
  });

  it("every adversarial control contributes exactly ZERO, each measured on its own", async () => {
    // Row by row: a control that was being cancelled out by another row's error would pass a total check.
    for (const p of PLANTED.filter((x) => x.id.startsWith("C"))) {
      const one = await assessCsv([HEADER, p.row].join("\n"), policy, { createdAt: CREATED });
      expect(one.excludedRowCount, `${p.id} must be admitted: ${JSON.stringify(one.exclusions)}`).toBe(0);
      expect(one.nonStalledExposure.overdueUnpaid.minor, `${p.id} unpaid — ${p.why}`).toBe(0);
      expect(one.nonStalledExposure.overduePartialOutstanding.minor, `${p.id} partial — ${p.why}`).toBe(0);
    }
  });

  it("the partial remainders are exact to the cent, including an odd-cent obligation", async () => {
    for (const p of PLANTED.filter((x) => x.id.startsWith("P"))) {
      const one = await assessCsv([HEADER, p.row].join("\n"), policy, { createdAt: CREATED });
      expect(one.nonStalledExposure.overduePartialOutstanding.minor, p.id).toBe(p.expectPartialMinor);
      expect(one.nonStalledExposure.overdueUnpaid.minor, `${p.id} is partial, not unpaid`).toBe(0);
    }
  });

  it("MEASURE THE MONEY · monetary recall, precision and false-positive amount", async () => {
    const r = await assessCsv(csv, policy, { createdAt: CREATED });
    const detected =
      r.nonStalledExposure.overdueUnpaid.minor + r.nonStalledExposure.overduePartialOutstanding.minor;

    // False positives are measured where they can actually arise: value reported for a row whose ground
    // truth is zero. Measured per row, since a portfolio total cannot distinguish a missed leak from an
    // invented one that happens to be the same size.
    let falsePositiveMinor = 0;
    let truePositiveMinor = 0;
    let found = 0;
    for (const p of PLANTED) {
      const one = await assessCsv([HEADER, p.row].join("\n"), policy, { createdAt: CREATED });
      const got =
        one.nonStalledExposure.overdueUnpaid.minor +
        one.nonStalledExposure.overduePartialOutstanding.minor;
      const want = p.expectUnpaidMinor + p.expectPartialMinor;
      if (want === 0) falsePositiveMinor += got;
      else {
        truePositiveMinor += Math.min(got, want);
        if (got === want) found += 1;
      }
    }

    const plantedLeaks = PLANTED.filter((p) => p.expectUnpaidMinor + p.expectPartialMinor > 0).length;
    const monetaryRecall = truePositiveMinor / EXPECTED_TOTAL;
    const monetaryPrecision = detected === 0 ? 1 : truePositiveMinor / detected;

    // eslint-disable-next-line no-console
    console.log(
      [
        "",
        "  ── Detector #2 · synthetic monetary benchmark ──────────────────────────────",
        `  planted non-stalled leaks        : ${plantedLeaks}`,
        `  expected exposure (minor)       : ${EXPECTED_TOTAL}  ($${(EXPECTED_TOTAL / 100).toFixed(2)})`,
        `  detected exposure (minor)       : ${detected}  ($${(detected / 100).toFixed(2)})`,
        `  of which the frozen register    : 1480000  ($14,800.00)  = S18 930000 + S17 550000`,
        `  monetary recall                 : ${(monetaryRecall * 100).toFixed(2)}%`,
        `  monetary precision              : ${(monetaryPrecision * 100).toFixed(2)}%`,
        `  false-positive amount (minor)   : ${falsePositiveMinor}`,
        `  leaks found exactly             : ${found}/${plantedLeaks}`,
        "  SYNTHETIC VALIDATION — not recovery proof, and no claim beyond this fixture.",
        "  ───────────────────────────────────────────────────────────────────────────",
      ].join("\n"),
    );

    expect(detected).toBe(EXPECTED_TOTAL);
    expect(falsePositiveMinor).toBe(0);
    expect(monetaryRecall).toBe(1);
    expect(monetaryPrecision).toBe(1);
    expect(found).toBe(plantedLeaks);
    // The frozen register's figure, asserted as its own claim rather than folded into the total.
    expect(PLANTED.filter((p) => p.id.startsWith("S1")).reduce((n, p) => n + p.expectUnpaidMinor, 0))
      .toBe(1_480_000);
  });

  it("DISJOINT on real data · no row contributes to both surfaces", async () => {
    const r = await assessCsv(csv, policy, { createdAt: CREATED });
    // The populations partition the accepted set exactly.
    expect(r.stalledCount + r.nonStalledExposure.population).toBe(r.acceptedCycleCount);
    // The stalled row is in the headline and absent from the new surface; the reverse for S18/S17.
    expect(r.observed.stateCounts.Unpaid).toBe(1); // C7 only
    expect(r.nonStalledExposure.stateCounts.Unpaid).toBe(2); // S18, S17 only
  });
});

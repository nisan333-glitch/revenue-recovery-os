// Obligation Scope — the shared disclosure reaches BOTH Assessment screens and the export through the
// code path the UI really uses (runAssessment → screens/export). Server-rendered via react-dom/server,
// like screens.test.ts, so no DOM or config change is needed.
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { runAssessment } from "./runAssessment";
import { DataQualityCohortScreen } from "./DataQualityCohortScreen";
import { ObservedResultsScreen } from "./ObservedResultsScreen";
import { buildSummary } from "./exportSummary";
import { unavailableObligationScope } from "../../domain/obligationScope";

const noop = () => {};
const P = { n: 30, asOf: "2026-03-01", currency: "USD" };
const HEAD = "entity_id,signed_at,activation_at,next_invoice_due_at,next_invoice_amount,currency";
const COLLIDING =
  HEAD +
  "\n" +
  "E1,2026-01-01,,2026-02-01,10000.00,USD\n" +
  "E1,2026-01-01,,2026-02-01,4000.00,USD\n" +
  "E2,2026-01-01,2026-01-10,2026-02-01,5000.00,USD\n" +
  "E3,2026-01-01,,2026-02-01,7000.00,USD";

async function ran() {
  const o = await runAssessment(COLLIDING, P);
  if (!o.ok) throw new Error(o.error);
  return o;
}

describe("runAssessment hands the obligation scope to the UI beside the result", () => {
  it("returns result + obligationScope from the same run", async () => {
    const o = await ran();
    expect(o.result.observed.observedUnpaid.minor).toBe(7000_00); // only E3 is counted
    expect(o.obligationScope.recordedAbsorption.candidateExposureUpperBound).toEqual({ minor: 14_000_00, currency: "USD" });
  });
});

describe("both Assessment screens render the same shared disclosure", () => {
  it("Data quality screen shows the scope, the absorption and the upper-bound exposure", async () => {
    const o = await ran();
    const html = renderToStaticMarkup(
      createElement(DataQualityCohortScreen, { result: o.result, obligationScope: o.obligationScope, n: 30, error: null, onChangeN: noop, onBack: noop, onNext: noop }),
    );
    expect(html).toContain("Obligation scope");
    expect(html).toContain("single obligation: not established");
    expect(html).toContain("DERIVED_COMPOSITE");
    expect(html).toContain("Recorded absorption");
    expect(html).toContain("$14,000.00");
    for (const line of o.obligationScope.disclosure) expect(html).toContain(line.replace(/&/g, "&amp;"));
  });

  it("Observed screen shows the identical disclosure lines and no longer calls units 'invoices'", async () => {
    const o = await ran();
    const html = renderToStaticMarkup(createElement(ObservedResultsScreen, { result: o.result, obligationScope: o.obligationScope, onBack: noop }));
    expect(html).toContain("Obligation scope");
    expect(html).toContain("records in");
    expect(html).not.toContain("invoices in");
    expect(html).toContain("does not establish that each record is a single obligation");
    for (const line of o.obligationScope.disclosure) expect(html).toContain(line.replace(/&/g, "&amp;"));
    // The four money states and the headline are unchanged.
    expect(html).toContain("Observed unpaid");
    expect(html).toContain("Not calculated");
  });

  it("both screens fail CLOSED when handed no scope: the refusal still renders", async () => {
    const o = await ran();
    const refusal = unavailableObligationScope("ASSESSMENT").disclosure[0]!;
    const q = renderToStaticMarkup(createElement(DataQualityCohortScreen, { result: o.result, n: 30, error: null, onChangeN: noop, onBack: noop, onNext: noop }));
    const r = renderToStaticMarkup(createElement(ObservedResultsScreen, { result: o.result, onBack: noop }));
    for (const html of [q, r]) {
      expect(html).toContain("Obligation scope");
      expect(html).toContain("single obligation: not established");
      expect(html).toContain(refusal);
    }
  });
});

describe("the export carries the same disclosure", () => {
  it("buildSummary includes the Obligation scope section; without a scope it fails closed", async () => {
    const o = await ran();
    const withScope = buildSummary(o.result, o.obligationScope);
    expect(withScope).toContain("## Obligation scope");
    expect(withScope).toContain("- identity grain: DERIVED_COMPOSITE");
    expect(withScope).toContain("- single-obligation reading: REFUSED_UNSUPPORTED");
    for (const line of o.obligationScope.disclosure) expect(withScope).toContain(line);

    const without = buildSummary(o.result);
    expect(without).toContain("## Obligation scope");
    expect(without).toContain("SCOPE_NOT_COMPUTED");
    // Existing content is untouched.
    expect(without).toContain("OBSERVED: Unpaid value in the stalled cohort = $7,000.00");
  });
});

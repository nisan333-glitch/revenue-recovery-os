// Lightweight render coverage for the Assessment screens — server-rendered to a string via
// react-dom/server (an EXISTING dependency) and constructed with React.createElement, so it needs
// NO jsdom/RTL and NO config change. It verifies the critical content each screen must present.
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AssessmentResult } from "../../assessment/types";
import { assessCsv } from "../../assessment/assess";
import { makePolicy } from "../../assessment/policy";
import { DataQualityCohortScreen } from "./DataQualityCohortScreen";
import { ObservedResultsScreen } from "./ObservedResultsScreen";
import { UploadScreen } from "./UploadScreen";

const noop = () => {};

// One stalled + one reference (activated) + one undetermined (within window) → all three non-zero.
const CSV =
  "entity_id,signed_at,activation_at,next_invoice_due_at,next_invoice_amount,currency\n" +
  "E1,2026-01-01,,2026-02-01,10000.00,USD\n" + // stalled + observed unpaid
  "E2,2026-01-01,2026-01-10,2026-02-01,5000.00,USD\n" + // reference
  "E3,2026-02-20,,2026-03-15,7000.00,USD"; // undetermined (deadline 2026-03-22 > asOf)

async function sample(): Promise<AssessmentResult> {
  return assessCsv(CSV, makePolicy({ stallThresholdDays: 30, asOf: "2026-03-01", currency: "USD" }), {
    createdAt: "2026-03-02T00:00:00.000Z",
  });
}

describe("Assessment screens render the critical content", () => {
  it("DataQuality renders stalled / undetermined / reference separately", async () => {
    const r = await sample();
    expect(r.stalledCount).toBe(1);
    expect(r.undeterminedCount).toBe(1);
    expect(r.referenceCount).toBe(1);
    const html = renderToStaticMarkup(
      createElement(DataQualityCohortScreen, { result: r, n: 30, error: null, onChangeN: noop, onBack: noop, onNext: noop }),
    );
    expect(html).toContain("Stalled");
    expect(html).toContain("Undetermined");
    expect(html).toContain("Reference");
  });

  it("DataQuality shows a re-run error banner (no silent stale result)", async () => {
    const r = await sample();
    const html = renderToStaticMarkup(
      createElement(DataQualityCohortScreen, { result: r, n: 30, error: "unsupported currency", onChangeN: noop, onBack: noop, onNext: noop }),
    );
    expect(html).toContain("Re-run failed");
    expect(html).toContain("unsupported currency");
  });

  it("Observed renders the observed value, the not-calculated states, and export", async () => {
    const r = await sample();
    const html = renderToStaticMarkup(createElement(ObservedResultsScreen, { result: r, onBack: noop }));
    expect(html).toContain("Observed unpaid");
    expect(html).toContain("Not calculated"); // Estimated + Forecast
    expect(html).toContain("Export summary");
  });

  it("Upload surfaces a validation error and the client-side promise", () => {
    const html = renderToStaticMarkup(
      createElement(UploadScreen, {
        n: 30, setN: noop, asOf: "2026-03-01", setAsOf: noop, currency: "USD", setCurrency: noop,
        locale: "", setLocale: noop, amountFormat: "", setAmountFormat: noop,
        error: "CSV is missing required column(s): entity_id", onFile: noop, onReject: noop,
      }),
    );
    expect(html).toContain("never uploaded");
    expect(html).toContain("missing required column");
  });
});

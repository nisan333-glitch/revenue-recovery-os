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
import { PilotReadinessScreen } from "./PilotReadinessScreen";
import { EMPTY_PILOT_DECLARATIONS } from "../../assessment/intakeKit";

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

  // EP-13 · This screen previously promised the file was "never uploaded", and that was true when
  // validation was purely local. It is no longer true: the server is now the authoritative check.
  // The assertion is updated to the NEW promise rather than kept — a test asserting a claim the
  // product contradicts is worse than no test.
  const uploadProps = {
    n: 30, setN: noop, asOf: "2026-03-01", setAsOf: noop, currency: "USD", setCurrency: noop,
    locale: "" as const, setLocale: noop, amountFormat: "" as const, setAmountFormat: noop,
    onFile: noop, onReject: noop,
    boundaryId: "pilot-boundary-0001", setBoundaryId: noop,
    datasetId: "dataset-0001", setDatasetId: noop,
    provenance: {
      sourceSystems: { contract: "crm", billing: "billing", product: "telemetry" },
      dataOwnerRole: "revenue-operations", extractionMethod: "warehouse view",
      extractedAt: "2026-03-01T00:00:00.000Z", coverageStart: "2026-01-01", coverageEnd: "2026-03-31",
      assertedIndependentOfBeneficiary: false,
    },
    setProvenance: noop, validationPreliminary: false, validating: false,
  };

  it("Upload states the server-authoritative promise and surfaces a validation error", () => {
    const html = renderToStaticMarkup(
      createElement(UploadScreen, {
        ...uploadProps,
        error: "CSV is missing required column(s): entity_id",
        validation: null,
      }),
    );
    expect(html).toContain("on the server");
    expect(html).not.toContain("never uploaded"); // the old promise must not survive as stale copy
    expect(html).toContain("missing required column");
    expect(html).toContain("Download data request");
    // Tenancy is named here but authorized server-side — the screen says so.
    expect(html).toContain("authenticated access");
  });

  it("Upload shows the contract verdict: version, counts, codes and guidance", () => {
    const html = renderToStaticMarkup(
      createElement(UploadScreen, {
        ...uploadProps,
        error: null,
        validation: {
          contractRef: "nh.customer-pilot-data-contract@1.1.0",
          contractVersion: "1.1.0",
          declaredVersion: "1.1.0",
          boundaryId: "pilot-boundary-0001",
          datasetId: "dataset-0001",
          accepted: true,
          usableForAssessment: false,
          counts: { dataRows: 10, acceptedRows: 0, rejectedRows: 10, warnedRows: 2 },
          datasetFindings: [],
          rowFindings: [
            {
              sourceRowId: "row-2", rowNumber: 2, field: "signed_at", code: "NH-DC-2005",
              severity: "row_rejected" as const,
              title: "A timestamp carries a time of day but no UTC offset.",
              remediation: "Supply either a plain calendar day or a full UTC instant ending in Z.",
              detail: "2026-01-05 09:30:00",
            },
          ],
          datasetFingerprint: "f".repeat(64),
          idempotencyKey: "pds_test",
          recordedAt: null,
        },
      }),
    );
    expect(html).toContain("contract 1.1.0"); // version shown
    expect(html).toContain("NH-DC-2005"); // machine-readable code shown
    expect(html).toContain("no UTC offset"); // what went wrong
    expect(html).toContain("full UTC instant"); // actionable correction guidance
    expect(html).toContain("not usable"); // status
    expect(html).toContain("cannot continue into assessment"); // progression is blocked
    expect(html).toContain("nothing was stored"); // and nothing was persisted or repaired
  });

  it("Pilot readiness is conservative and exposes the claim boundary", async () => {
    const r = await sample();
    const html = renderToStaticMarkup(
      createElement(PilotReadinessScreen, {
        result: r,
        declarations: EMPTY_PILOT_DECLARATIONS,
        onChangeDeclarations: noop,
        onBack: noop,
        onNext: noop,
      }),
    );
    expect(html).toContain("CONDITIONAL");
    expect(html).toContain("Claim boundary");
    expect(html).toContain("0/7");
  });
});

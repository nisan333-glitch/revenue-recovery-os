// The Assessment container's run-logic, extracted as a pure async function so the critical flows
// (valid / BOM / missing-headers / invalid-currency / re-run) are unit-testable at the exact code
// path the UI uses — without a DOM. The container is a thin wiring layer around this.
import type { AssessmentResult } from "../../assessment/types";
import { assessCsv } from "../../assessment/assess";
import { makePolicy } from "../../assessment/policy";
import type { DateLocale } from "../../assessment/dateNormalize";

export interface RunParams {
  n: number;
  asOf: string;
  currency: string;
  locale?: DateLocale;
}

export type RunOutcome =
  | { ok: true; result: AssessmentResult }
  | { ok: false; error: string };

export async function runAssessment(csvText: string, params: RunParams): Promise<RunOutcome> {
  try {
    const policy = makePolicy({
      stallThresholdDays: params.n,
      asOf: params.asOf,
      currency: params.currency,
    });
    const result = await assessCsv(csvText, policy, {
      createdAt: new Date().toISOString(),
      locale: params.locale,
    });
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

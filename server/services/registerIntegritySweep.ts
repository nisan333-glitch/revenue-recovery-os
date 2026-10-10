// A READ-ONLY integrity sweep over both governed registers.
//
// WHY A SWEEP AT ALL. Verification is otherwise per-resolve: a row is checked when something tries to
// judge with it, put it in force, or read it. That is the right place for enforcement, but it means a
// migration or a restore that altered many rows is discovered one refusal at a time, by whoever happens
// to touch each row next — and a row nobody touches is never checked at all. The sweep asks the question
// of every record at once.
//
// IT REPAIRS NOTHING, AND CANNOT. There is no write in this module, no restamp, no backfill and no
// "fix" flag. A mismatch is reported with both hashes so a human can see what moved and decide; a sweep
// that could repair would be a sweep that could launder, and the whole value of a witness is that
// nothing may quietly bring it back into agreement.
//
// UNVERIFIABLE IS REPORTED SEPARATELY from MISMATCH. A row whose stored values no longer rebuild into a
// valid definition — a threshold out of range, a currency nothing maps to — has no hash to compare, so
// calling it a mismatch would assert a comparison that never happened.
import { prisma, type DbClient } from "../db";
import { makeAdmissionPolicy, type RequiredLifecycleState } from "../../src/contract/pilotAdmissionPolicy";
import { hashAdmissionPolicy } from "../../src/contract/policyHash";
import { makeAnalysisTerms } from "../../src/contract/analysisTerms";
import { hashAnalysisTerms } from "../../src/contract/analysisTerms";
import {
  compareIntegrity,
  unverifiable,
  type RegisterIntegrity,
} from "../../src/contract/registerIntegrity";

export type RegisterName = "admission_policy" | "analysis_terms";

export interface SweptRecord {
  readonly register: RegisterName;
  readonly boundaryId: string;
  /** `id@version` — a governance label, never a customer value. */
  readonly ref: string;
  readonly integrity: RegisterIntegrity;
}

export interface SweepReport {
  readonly checked: number;
  readonly intact: number;
  /** Every record that is not INTACT, in a stable order so two runs are comparable. */
  readonly failures: readonly SweptRecord[];
  readonly byRegister: Readonly<Record<RegisterName, { readonly checked: number; readonly failures: number }>>;
}

/** Did every record verify? The sweep's exit code is this and nothing else. */
export function sweepPassed(report: SweepReport): boolean {
  return report.failures.length === 0;
}

async function sweepAdmissionPolicies(client: DbClient): Promise<readonly SweptRecord[]> {
  // Raw rows, deliberately: `findAdmissionPolicy` rebuilds through the domain constructor and would
  // throw on exactly the rows this sweep has to be able to REPORT. Reading raw is what makes
  // UNVERIFIABLE reachable instead of fatal.
  const rows = await client.pilotAdmissionPolicyRecord.findMany({
    orderBy: [{ boundaryId: "asc" }, { policyId: "asc" }, { policyVersion: "asc" }],
  });
  const out: SweptRecord[] = [];
  for (const row of rows) {
    const ref = `${row.policyId}@${row.policyVersion}`;
    let integrity: RegisterIntegrity;
    try {
      const policy = makeAdmissionPolicy({
        policyId: row.policyId,
        policyVersion: row.policyVersion,
        calculationMethodVersion: row.calculationMethodVersion,
        minAcceptedRows: row.minAcceptedRows,
        minDistinctEntities: row.minDistinctEntities,
        maxRejectionRate: row.maxRejectionRate,
        maxSingleReasonShare: row.maxSingleReasonShare,
        maxDuplicateRate: row.maxDuplicateRate,
        minCoverageDays: row.minCoverageDays,
        requiredLifecycleStates: row.requiredLifecycleStates as readonly RequiredLifecycleState[],
        maxOrderingDefectRate: row.maxOrderingDefectRate,
        maxMissingRecommendedColumns: row.maxMissingRecommendedColumns,
        requireProvenanceDeclaration: row.requireProvenanceDeclaration,
      });
      integrity = compareIntegrity(row.policyHash, await hashAdmissionPolicy(policy));
    } catch {
      // The message is not propagated: a constructor message can name a field and a value, and this
      // report is read and pasted around. The field-level detail is on the governance read.
      integrity = unverifiable(row.policyHash, "the stored values do not rebuild into a valid admission policy");
    }
    out.push(Object.freeze({ register: "admission_policy" as const, boundaryId: row.boundaryId, ref, integrity }));
  }
  return out;
}

async function sweepAnalysisTerms(client: DbClient): Promise<readonly SweptRecord[]> {
  const rows = await client.pilotAnalysisTermsRecord.findMany({
    orderBy: [{ boundaryId: "asc" }, { termsId: "asc" }, { termsVersion: "asc" }],
  });
  const out: SweptRecord[] = [];
  for (const row of rows) {
    const ref = `${row.termsId}@${row.termsVersion}`;
    let integrity: RegisterIntegrity;
    try {
      const terms = makeAnalysisTerms({
        termsId: row.termsId,
        termsVersion: row.termsVersion,
        asOf: row.asOf,
        stallThresholdDays: row.stallThresholdDays,
        currency: row.currency,
        calculationMethodVersion: row.calculationMethodVersion,
      });
      integrity = compareIntegrity(row.termsHash, await hashAnalysisTerms(terms));
    } catch {
      integrity = unverifiable(row.termsHash, "the stored values do not rebuild into valid analysis terms");
    }
    out.push(Object.freeze({ register: "analysis_terms" as const, boundaryId: row.boundaryId, ref, integrity }));
  }
  return out;
}

/**
 * Sweep both registers. Every record, every boundary, no filter.
 *
 * NOT boundary-scoped, deliberately and unlike every request path: this is an operator tool asking
 * whether the database is intact, not a tenant asking about their own data. It returns governance
 * labels and hashes only — no customer value passes through it.
 */
export async function sweepRegisterIntegrity(client: DbClient = prisma): Promise<SweepReport> {
  const [policies, terms] = await Promise.all([sweepAdmissionPolicies(client), sweepAnalysisTerms(client)]);
  const all = [...policies, ...terms];
  const failures = all.filter((r) => r.integrity.status !== "INTACT");
  const count = (rs: readonly SweptRecord[]) =>
    Object.freeze({ checked: rs.length, failures: rs.filter((r) => r.integrity.status !== "INTACT").length });
  return Object.freeze({
    checked: all.length,
    intact: all.length - failures.length,
    failures: Object.freeze(failures),
    byRegister: Object.freeze({ admission_policy: count(policies), analysis_terms: count(terms) }),
  });
}

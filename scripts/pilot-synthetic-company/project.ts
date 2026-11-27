// THE FROZEN SYNTHETIC COMPANY, PROJECTED INTO THE GOVERNED CONTRACTS · read-only.
//
// WHY A PROJECTION AND NOT A NEW DATASET. `e2e/fixtures/reconciliation-synthetic/` already holds a
// realistic company — 613 expectation rows, 596 billing rows, 60 payers, 119 entitlements — and a
// ground truth of 19 planted mechanisms totalling $85,942.00, FROZEN on 2026-11-24 under a tracked
// lock, before this exercise was asked for. Generating a fresh company would mean authoring the truth
// and the result in the same week, which is the thing the freeze control exists to prevent. So the
// data is REUSED and this file only renames columns.
//
// THE MAP IS DECLARED, NEVER INFERRED. *A serialised artefact's schema is declared, never inferred
// from a sample of its own rows* — the V3 transport defect. Every governed column names its frozen
// source explicitly, an unmapped governed column is a build error, and a frozen column this map does
// not read is reported rather than silently dropped.
//
// THE FROZEN FILES ARE NEVER WRITTEN. This module reads them and returns strings. Nothing here opens
// a frozen path for writing, and the callers assert the lock still verifies afterwards.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const EXPECTATION_MAP: ReadonlyArray<readonly [governed: string, frozen: string | null]> =
  Object.freeze([
    ["entitlement_ref", "entitlement_id"],
    ["period_start", "period_start"],
    ["period_end", "period_end"],
    ["expected_amount", "expected_amount"],
    ["currency", "currency"],
    ["payer_ref", "payer_account_id"],
    ["terminated_at", "terminated_at"],
    ["pause_start", "pause_start"],
    ["pause_end", "pause_end"],
    ["supersedes_ref", "supersedes_schedule_line_id"],
    ["amended_at", "amended_at"],
    ["schedule_line_ref", "schedule_line_id"],
  ] as const);

export const BILLING_MAP: ReadonlyArray<readonly [governed: string, frozen: string | null]> =
  Object.freeze([
    ["invoice_ref", "invoice_id"],
    ["invoice_line_ref", "invoice_line_id"],
    ["invoice_raised_at", "issued_at"],
    ["invoice_line_amount", "billed_amount"],
    ["currency", "currency"],
    ["payer_ref", "payer_account_id"],
    // THE ONE COLUMN THAT IS NOT A RENAME. V3's billing side emits NO reference to the obligation a
    // line settles — `invoice_line_id` is a position within an invoice, which is why
    // `C_SCHEDULE_LINE` has been NOT CONSTRUCTIBLE since the grain study. The obligation-ref variant
    // package supplies `obligation_ref` and this map reads it when present; on V3 it is blank, and a
    // blank forfeits the capability rather than inventing a key.
    ["obligation_ref", "obligation_ref"],
    ["is_credit", "is_credit"],
    ["period_start", "period_start"],
    ["period_end", "period_end"],
    ["legacy_subscription_ref", "legacy_subscription_id"],
    ["source_system", "source_system"],
  ] as const);

/** RFC-4180 enough for these files: no embedded newline, quote only when needed. */
const cell = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export interface Projection {
  readonly csv: string;
  readonly rows: number;
  /** Frozen columns this map does not read — REPORTED, because a silent drop is the V3 defect. */
  readonly unreadFrozenColumns: readonly string[];
}

export function project(
  frozenCsv: string,
  map: ReadonlyArray<readonly [string, string | null]>,
): Projection {
  const lines = frozenCsv.replace(/\r\n/g, "\n").split("\n").filter((l) => l.length > 0);
  // AN EMPTY FILE IS AN ERROR, NOT AN EMPTY PROJECTION. A header-less projection would emit a file the
  // validator then rejects for the wrong reason, and the diagnosis would point at the contract.
  const first = lines[0];
  if (first === undefined) throw new Error("projection: the source CSV has no rows at all");
  const header = first.split(",");
  const index = new Map(header.map((h, i) => [h, i]));
  for (const [governed, frozen] of map) {
    if (frozen !== null && !index.has(frozen)) {
      // FAIL LOUDLY. A governed column whose source is absent would otherwise project as empty and
      // the dataset would read as "the customer did not supply it".
      throw new Error(`projection: governed column '${governed}' names absent frozen column '${frozen}'`);
    }
  }
  const read = new Set(map.map(([, f]) => f).filter((f): f is string => f !== null));
  const out = [map.map(([g]) => g).join(",")];
  for (const line of lines.slice(1)) {
    const parts = line.split(",");
    out.push(map.map(([, frozen]) => cell(frozen === null ? "" : (parts[index.get(frozen)!] ?? ""))).join(","));
  }
  return Object.freeze({
    csv: `${out.join("\n")}\n`,
    rows: lines.length - 1,
    unreadFrozenColumns: Object.freeze(header.filter((h) => !read.has(h))),
  });
}

export interface ProjectedPair {
  readonly expectationCsv: string;
  readonly billingCsv: string;
  readonly expectationRows: number;
  readonly billingRows: number;
  readonly unreadExpectation: readonly string[];
  readonly unreadBilling: readonly string[];
}

export function projectFrozenPackage(dir: string): ProjectedPair {
  const read = (name: string) => readFileSync(resolve(dir, name), "utf8");
  const e = project(read("expectation.csv"), EXPECTATION_MAP);
  const frozenBilling = read("observation.csv");
  const hasObligationRef = (frozenBilling.split("\n")[0] ?? "").split(",").includes("obligation_ref");
  const b = project(
    frozenBilling,
    hasObligationRef ? BILLING_MAP : BILLING_MAP.map(([g, f]) => (g === "obligation_ref" ? [g, null] : [g, f])),
  );
  return Object.freeze({
    expectationCsv: e.csv, billingCsv: b.csv,
    expectationRows: e.rows, billingRows: b.rows,
    unreadExpectation: e.unreadFrozenColumns, unreadBilling: b.unreadFrozenColumns,
  });
}

// Executable specification of the Customer Pilot Data Contract v1.
//
// These tests are the contract's teeth. Each one pins a promise the contract makes to a customer:
// what is required, what is rejected, what is never silently repaired, and what a dataset may and
// may not become downstream. A rule that stops firing fails here rather than quietly accepting bad
// data in a pilot.
import { describe, it, expect } from "vitest";
import {
  PILOT_DATA_CONTRACT_FIELDS,
  PILOT_DATA_CONTRACT_REF,
  PILOT_DATA_CONTRACT_VERSION,
  CONTRACT_REQUIRED_FIELDS,
  COMPATIBILITY_POLICY,
  MINIMIZATION_RULES,
  MONEY_RULES,
  TIME_RULES,
  contractField,
  isProhibitedFieldName,
  isSupportedContractVersion,
  looksLikePii,
  parseContractVersion,
} from "./pilotDataContract";
import { ALL_REJECTION_CODES, EXCLUSION_REASON_CODES, rejectionCode } from "./rejectionCodes";
import {
  validatePilotDataset,
  deriveIdempotencyKey,
  isDuplicateSubmission,
  tenantScopedIdentifier,
  type DatasetSubmission,
} from "./validateDataset";
import {
  SYNTHETIC_BOUNDARY,
  SYNTHETIC_PROVENANCE,
  syntheticPilotCsv,
  syntheticPilotRows,
  syntheticViolationCases,
  syntheticViolationCsv,
  toCsv,
} from "./syntheticPilotDataset";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { SAAS_CANONICAL_FIELDS, SAAS_REQUIRED } from "../assessment/adapters/saasActivation";
import { makePolicy } from "../assessment/policy";

const policy = makePolicy({ stallThresholdDays: 30, asOf: "2026-04-15", currency: "USD", excludedStatuses: [] });

function submission(csvText: string, over: Partial<DatasetSubmission> = {}): DatasetSubmission {
  return {
    declaredVersion: PILOT_DATA_CONTRACT_VERSION,
    boundary: SYNTHETIC_BOUNDARY,
    provenance: SYNTHETIC_PROVENANCE,
    csvText,
    policy,
    ...over,
  };
}

const codesFor = (findings: readonly { code: string }[]): string[] => findings.map((f) => f.code);

describe("contract declaration", () => {
  it("1 · required fields agree with the adapter — the two can never fork", () => {
    // If the adapter's REQUIRED changes without the contract, a customer is told one thing and
    // validated against another. That divergence is caught here, at build time.
    expect([...CONTRACT_REQUIRED_FIELDS].sort()).toEqual([...SAAS_REQUIRED].sort());
  });

  it("1 · every declared field exists in the adapter's canonical vocabulary", () => {
    for (const field of PILOT_DATA_CONTRACT_FIELDS) {
      expect(SAAS_CANONICAL_FIELDS, `contract declares unknown field '${field.name}'`).toContain(field.name);
    }
  });

  it("3 · time rules forbid guessing at an ambiguous or offset-less value", () => {
    expect(TIME_RULES.rejectLocalTimestampWithoutOffset).toBe(true);
    expect(TIME_RULES.rejectAmbiguousNumericDateWithoutLocale).toBe(true);
    expect(TIME_RULES.asOfIsTheOnlyClock).toBe(true);
    expect(TIME_RULES.dateGranularity).toBe("calendar_day");
  });

  it("4 · money rules forbid floats, conversion and silent rounding", () => {
    expect(MONEY_RULES.internalRepresentation).toBe("exact_integer_minor_units");
    expect(MONEY_RULES.rejectExcessPrecision).toBe(true);
    expect(MONEY_RULES.performsCurrencyConversion).toBe(false);
    expect(MONEY_RULES.singleCurrencyPerDataset).toBe(true);
  });

  it("6 · minimization rejects rather than strips", () => {
    expect(MINIMIZATION_RULES.rejectUndeclaredColumns).toBe(true);
    expect(MINIMIZATION_RULES.stripsOrRedactsSilently).toBe(false);
    expect(isProhibitedFieldName("Email")).toBe(true);
    expect(isProhibitedFieldName("entity_id")).toBe(false);
  });

  it("6 · PII shapes are detected without misfiring on ordinary identifiers", () => {
    expect(looksLikePii("person@example.com")).toBe("email");
    expect(looksLikePii("+1 415 555 0132")).toBe("phone");
    expect(looksLikePii("4111111111111111")).toBe("card"); // Luhn-valid test PAN
    expect(looksLikePii("synthetic-account-0001")).toBeNull();
    expect(looksLikePii("1234567890123456789")).toBeNull(); // long id, not Luhn-valid
    expect(looksLikePii("")).toBeNull();
  });

  it("6 · PII detection stays cheap on large hostile values, and detects regardless of length", () => {
    // These predicates run over uploaded CSV content, so a pathological value must not become a
    // denial-of-service lever. The budget is deliberately generous — it is a regression guard against
    // a future edit introducing super-linear matching, not a benchmark.
    const hostile = `${"a".repeat(50_000)}@${"b".repeat(50_000)}`; // long, no dot in the domain
    const started = Date.now();
    expect(looksLikePii(hostile)).toBeNull();
    expect(looksLikePii(`${"9".repeat(60_000)} `)).toBeNull();
    expect(Date.now() - started).toBeLessThan(1_000);
    // Detection has NO length cap: an absurdly long address is still caught, never waved through.
    expect(looksLikePii(`${"a".repeat(240)}@b.example`)).toBe("email");
    expect(looksLikePii(`${"a".repeat(3_000)}@b.example`)).toBe("email");
    expect(looksLikePii("a@@b.example")).toBeNull(); // two @ is not an address shape
    expect(looksLikePii("a@b")).toBeNull(); // no dot in the domain
  });

  it("8 · every code is unique, well-formed and carries a remediation", () => {
    const codes = ALL_REJECTION_CODES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const spec of ALL_REJECTION_CODES) {
      expect(spec.code).toMatch(/^NH-DC-\d{4}$/);
      expect(spec.remediation.length).toBeGreaterThan(0);
      expect(rejectionCode(spec.code)).toEqual(spec);
    }
  });

  it("8 · every adapter exclusion reason maps to a code — no uncoded rejection can reach a customer", () => {
    for (const [reason, spec] of Object.entries(EXCLUSION_REASON_CODES)) {
      expect(spec.code, `reason '${reason}' has no code`).toMatch(/^NH-DC-\d{4}$/);
    }
  });

  it("10 · version support is same-major, not-newer, and fails closed on nonsense", () => {
    expect(isSupportedContractVersion(PILOT_DATA_CONTRACT_VERSION)).toBe(true);
    expect(isSupportedContractVersion("1.0.0")).toBe(true);
    expect(isSupportedContractVersion("2.0.0")).toBe(false); // different major
    expect(isSupportedContractVersion("1.99.0")).toBe(false); // newer than implemented
    expect(isSupportedContractVersion("not-a-version")).toBe(false);
    expect(parseContractVersion("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(COMPATIBILITY_POLICY.acceptsNewerThanImplemented).toBe(false);
    // Changing a field's MEANING is breaking even when the name is untouched.
    expect(COMPATIBILITY_POLICY.major.join(" ")).toMatch(/MEANING/);
  });
});

describe("layering — the contract stays pure", () => {
  // EP-13 wired the contract into a real HTTP intake. That is exactly the moment a validator starts
  // quietly acquiring a network call or a database handle "just for this one check". It must not:
  // the same module runs in the browser as preflight and on the server as the authority, and it can
  // only be trusted in both if it depends on neither.
  const files = readdirSync(__dirname).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

  it("imports nothing from the network, server, persistence or app layers", () => {
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const code = readFileSync(join(__dirname, file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      const imports = [...code.matchAll(/from "([^"]+)"/g)].map((m) => m[1]!);
      for (const source of imports) {
        expect(source, `${file} imports '${source}'`).toMatch(/^\.\/|^\.\.\/assessment\/|^\.\.\/domain\//);
      }
      for (const forbidden of ["fetch(", "XMLHttpRequest", "node:fs", "node:net", "prisma", "process.env"]) {
        expect(code.includes(forbidden), `${file} references '${forbidden}'`).toBe(false);
      }
    }
  });
});

describe("dataset validation — the synthetic example", () => {
  it("11 · the published synthetic dataset is contract-valid and produces cycles", async () => {
    const report = await validatePilotDataset(submission(syntheticPilotCsv()));
    expect(report.datasetFindings).toEqual([]);
    expect(report.accepted).toBe(true);
    expect(report.usableForAssessment).toBe(true);
    expect(report.counts.dataRows).toBe(40);
    expect(report.counts.acceptedRows).toBe(40);
    expect(report.counts.rejectedRows).toBe(0);
    expect(report.acceptedCycles).toHaveLength(40);
    expect(report.contractRef).toBe(PILOT_DATA_CONTRACT_REF);
  });

  it("11 · the synthetic dataset contains no personal data and is self-evidently fake", () => {
    const csv = syntheticPilotCsv();
    expect(csv).not.toMatch(/@/); // no email anywhere
    for (const row of syntheticPilotRows(40)) {
      expect(row.entity_id).toMatch(/^synthetic-/);
      expect(looksLikePii(row.entity_id)).toBeNull();
    }
    // A synthetic source cannot assert independence from the beneficiary.
    expect(SYNTHETIC_PROVENANCE.assertedIndependentOfBeneficiary).toBe(false);
  });

  it("7 · validation is deterministic — same bytes, same verdict, same key", async () => {
    const csv = syntheticPilotCsv();
    const a = await validatePilotDataset(submission(csv));
    const b = await validatePilotDataset(submission(csv));
    expect(a).toEqual(b);
  });
});

describe("row-level rejection reporting", () => {
  it("8 · each synthetic violation is reported on its own row with its expected code", async () => {
    const report = await validatePilotDataset(submission(syntheticViolationCsv()));
    const cases = syntheticViolationCases();
    expect(report.counts.dataRows).toBe(cases.length);

    cases.forEach((violation, index) => {
      const rowNumber = index + 1;
      const forRow = report.rowFindings.filter((f) => f.rowNumber === rowNumber);
      expect(codesFor(forRow), `${violation.label} (data row ${rowNumber})`).toContain(violation.expectedCode);
    });

    // Every rejected row is addressable: row number, source id, and an actionable remedy.
    for (const finding of report.rowFindings) {
      expect(finding.rowNumber).toBeGreaterThan(0);
      expect(finding.sourceRowId).toMatch(/^row-/);
      expect(finding.remediation.length).toBeGreaterThan(0);
    }
    // Not one violating row reached the accepted set.
    expect(report.acceptedCycles).toHaveLength(0);
  });

  it("a rejected row is never repaired — no defaulting, no coercion, no silent drop", async () => {
    const csv =
      "entity_id,subscription_id,signed_at,next_invoice_due_at,next_invoice_amount,currency\n" +
      "synthetic-account-0001,synthetic-sub-0001,2026-01-05,2026-02-04,1000.00,USD\n" +
      "synthetic-account-0002,synthetic-sub-0002,2026-01-05,2026-02-04,,USD\n";
    const report = await validatePilotDataset(submission(csv));
    // The bad row is REPORTED, not dropped: the count still shows two rows read.
    expect(report.counts.dataRows).toBe(2);
    expect(report.counts.rejectedRows).toBe(1);
    expect(report.acceptedCycles).toHaveLength(1);
    const bad = report.rowFindings.filter((f) => f.rowNumber === 2);
    expect(codesFor(bad)).toContain("NH-DC-2002"); // missing required field
    // No amount was invented for the empty cell.
    expect(report.acceptedCycles.every((c) => c.monetaryEvent.amount.minor > 0)).toBe(true);
  });

  it("3 · a wall-clock timestamp with no offset is rejected, never assumed to be UTC", async () => {
    const rows = syntheticPilotRows(1).map((r) => ({ ...r, signed_at: "2026-01-05 09:30:00" }));
    const report = await validatePilotDataset(submission(toCsv(rows)));
    expect(codesFor(report.rowFindings)).toContain("NH-DC-2005");
    expect(report.acceptedCycles).toHaveLength(0);
  });

  it("2 · an email in an identifier column is rejected rather than masked", async () => {
    const rows = syntheticPilotRows(1).map((r) => ({ ...r, entity_id: "someone@synthetic.example" }));
    const report = await validatePilotDataset(submission(toCsv(rows)));
    const finding = report.rowFindings.find((f) => f.code === "NH-DC-3002");
    expect(finding).toBeDefined();
    expect(finding!.field).toBe("entity_id");
    expect(report.acceptedCycles).toHaveLength(0);
  });
});

describe("dataset-level rejection", () => {
  it("6 · an undeclared column is rejected, not ignored", async () => {
    const csv =
      "entity_id,signed_at,next_invoice_due_at,next_invoice_amount,currency,internal_notes\n" +
      "synthetic-account-0001,2026-01-05,2026-02-04,1000.00,USD,some free text\n";
    const report = await validatePilotDataset(submission(csv));
    expect(report.accepted).toBe(false);
    expect(codesFor(report.datasetFindings)).toContain("NH-DC-1005");
  });

  it("6 · a column whose NAME indicates personal data rejects the whole dataset", async () => {
    const csv =
      "entity_id,signed_at,next_invoice_due_at,next_invoice_amount,currency,email\n" +
      "synthetic-account-0001,2026-01-05,2026-02-04,1000.00,USD,a@b.example\n";
    const report = await validatePilotDataset(submission(csv));
    expect(codesFor(report.datasetFindings)).toContain("NH-DC-3001");
    expect(report.accepted).toBe(false);
  });

  it("1 · a missing required column rejects the dataset before any row is assessed", async () => {
    const csv = "entity_id,signed_at,next_invoice_due_at,next_invoice_amount\nsynthetic-account-0001,2026-01-05,2026-02-04,1000.00\n";
    const report = await validatePilotDataset(submission(csv));
    expect(codesFor(report.datasetFindings)).toContain("NH-DC-1002");
    expect(report.counts.acceptedRows).toBe(0);
    expect(report.acceptedCycles).toEqual([]);
  });

  it("4 · a dataset mixing currencies is rejected — amounts are never converted", async () => {
    const rows = [
      { ...syntheticPilotRows(2)[0]!, currency: "USD" },
      { ...syntheticPilotRows(2)[1]!, currency: "EUR" },
    ];
    const report = await validatePilotDataset(submission(toCsv(rows)));
    expect(codesFor(report.datasetFindings)).toContain("NH-DC-1006");
    expect(report.accepted).toBe(false);
  });

  it("10 · a newer or malformed contract version is refused, never interpreted optimistically", async () => {
    const csv = syntheticPilotCsv(2);
    const newer = await validatePilotDataset(submission(csv, { declaredVersion: "9.0.0" }));
    expect(codesFor(newer.datasetFindings)).toContain("NH-DC-5001");
    const malformed = await validatePilotDataset(submission(csv, { declaredVersion: "v1" }));
    expect(codesFor(malformed.datasetFindings)).toContain("NH-DC-5002");
  });

  it("5 · incomplete provenance rejects the dataset", async () => {
    const report = await validatePilotDataset(
      submission(syntheticPilotCsv(2), {
        provenance: { ...SYNTHETIC_PROVENANCE, dataOwnerRole: "", extractionMethod: "" },
      }),
    );
    expect(codesFor(report.datasetFindings)).toContain("NH-DC-1008");
  });

  it("5 · a row outside the declared coverage window is rejected", async () => {
    const report = await validatePilotDataset(
      submission(syntheticPilotCsv(4), {
        provenance: { ...SYNTHETIC_PROVENANCE, coverageStart: "2026-01-01", coverageEnd: "2026-01-31" },
      }),
    );
    expect(codesFor(report.rowFindings)).toContain("NH-DC-2021");
  });
});

describe("tenant boundaries and identifiers", () => {
  it("2 · the tenant boundary is required and is never read from the file", async () => {
    const report = await validatePilotDataset(
      submission(syntheticPilotCsv(2), { boundary: { boundaryId: "  ", datasetId: "d" } }),
    );
    expect(codesFor(report.datasetFindings)).toContain("NH-DC-1007");
    // The contract declares no field through which a row could name its own tenant.
    expect(PILOT_DATA_CONTRACT_FIELDS.map((f) => f.name)).not.toContain("boundary_id");
    expect(contractField("tenant_id")).toBeUndefined();
  });

  it("2 · ingesting a dataset into a different boundary than it declares is refused", async () => {
    const report = await validatePilotDataset(
      submission(syntheticPilotCsv(2), { ingestionBoundaryId: "synthetic-boundary-9999" }),
    );
    expect(codesFor(report.datasetFindings)).toContain("NH-DC-4002");
    expect(report.accepted).toBe(false);
  });

  it("2 · pseudonymous identifiers are stable per tenant and never collide across tenants", async () => {
    const a1 = await tenantScopedIdentifier("boundary-a", "synthetic-account-0001");
    const a2 = await tenantScopedIdentifier("boundary-a", "synthetic-account-0001");
    const b1 = await tenantScopedIdentifier("boundary-b", "synthetic-account-0001");
    expect(a1).toBe(a2); // deterministic within a tenant
    expect(a1).not.toBe(b1); // the boundary is inside the hash
    expect(a1).toMatch(/^pid_[0-9a-f]{32}$/);
    expect(a1).not.toContain("synthetic-account-0001"); // the raw identifier does not survive
  });
});

describe("duplicates and idempotency", () => {
  it("9 · identical rows are both excluded from accepted cycles", async () => {
    const row = syntheticPilotRows(1)[0]!;
    const report = await validatePilotDataset(submission(toCsv([row, row])));
    const dup = report.rowFindings.filter((f) => f.code === "NH-DC-4001");
    expect(dup).toHaveLength(1);
    expect(dup[0]!.rowNumber).toBe(2);
    expect(dup[0]!.detail).toContain("data row 1");
    expect(report.rowFindings.filter((f) => f.code === "NH-DC-2016")).toHaveLength(2);
    expect(report.acceptedCycles).toHaveLength(0);
  });

  it("9 · two rows claiming the same cycle identity are rejected", async () => {
    const [first, second] = [syntheticPilotRows(2)[0]!, syntheticPilotRows(2)[1]!];
    const collided = { ...second, subscription_id: first.subscription_id };
    const report = await validatePilotDataset(submission(toCsv([first, collided])));
    expect(report.rowFindings.filter((f) => f.code === "NH-DC-2016")).toHaveLength(2);
    expect(report.acceptedCycles).toHaveLength(0);
  });

  it("9 · corrupting a rival row cannot select a surviving cycle", async () => {
    // THE SECOND LEVER. Rejecting every colliding row removes file ORDER as a way to choose which row
    // counts. It does not, on its own, remove the ability to choose by making the unwanted row invalid
    // — unless a defective row still participates in the collision it caused. It does.
    //
    // `cycleId` comes from `subscription_id` when one is present (saasActivation.ts), so corrupting
    // `entity_id` leaves the cycle identity untouched: the collision is real and both rows go.
    const first = syntheticPilotRows(1)[0]!;
    const corrupted = { ...first, entity_id: "person@example.com" };
    for (const rows of [[first, corrupted], [corrupted, first]]) {
      const report = await validatePilotDataset(submission(toCsv(rows)));
      expect(report.rowFindings.map(f => f.code)).toContain("NH-DC-3002");
      expect(report.rowFindings.filter(f => f.code === "NH-DC-2016")).toHaveLength(2);
      expect(report.acceptedCycles).toHaveLength(0);
      expect(report.counts.rejectedRows).toBe(2);
    }
  });

  it("9 · the idempotency key is stable for identical bytes and tenant-scoped", async () => {
    const csv = syntheticPilotCsv(3);
    const a = await validatePilotDataset(submission(csv));
    const b = await validatePilotDataset(submission(csv));
    expect(a.idempotencyKey).toBe(b.idempotencyKey);

    const otherTenant = await deriveIdempotencyKey(
      { boundaryId: "synthetic-boundary-9999", datasetId: SYNTHETIC_BOUNDARY.datasetId },
      a.datasetFingerprint,
    );
    expect(otherTenant).not.toBe(a.idempotencyKey); // byte-identical files never collide across tenants

    const changed = await validatePilotDataset(submission(syntheticPilotCsv(4)));
    expect(changed.idempotencyKey).not.toBe(a.idempotencyKey); // a different file is a new decision

    expect(isDuplicateSubmission(a.idempotencyKey, new Set([b.idempotencyKey]))).toBe(true);
    expect(isDuplicateSubmission(changed.idempotencyKey, new Set([a.idempotencyKey]))).toBe(false);
  });
});

describe("acceptance semantics", () => {
  it("a structurally valid file whose every row was rejected is NOT usable", async () => {
    // The trap this closes: `accepted` describes the FILE, not the data in it. A caller that branched
    // on `accepted` alone would proceed into a pilot with zero rows.
    const report = await validatePilotDataset(submission(syntheticViolationCsv()));
    expect(report.accepted).toBe(true); // the file parsed and its structure is legal …
    expect(report.counts.acceptedRows).toBe(0);
    expect(report.usableForAssessment).toBe(false); // … but there is nothing to assess
  });

  it("a warning never fails a dataset, and an ordinary unpaid row is not warned about", async () => {
    // Every 5th synthetic cycle is stalled and unpaid: empty activation/paid columns are the
    // OBSERVATION, not a gap. Warning per row would bury the real signals.
    const report = await validatePilotDataset(submission(syntheticPilotCsv(10)));
    expect(report.accepted).toBe(true);
    expect(report.usableForAssessment).toBe(true);
    expect(report.rowFindings.filter((f) => f.severity === "row_warning")).toEqual([]);
    expect(report.counts.warnedRows).toBe(0);
  });

  it("a missing recommended COLUMN is reported once for the dataset, not once per row", async () => {
    const csv =
      "entity_id,signed_at,next_invoice_due_at,next_invoice_amount,currency\n" +
      "synthetic-account-0001,2026-01-05,2026-02-04,1000.00,USD\n" +
      "synthetic-account-0002,2026-01-06,2026-02-05,2000.00,USD\n";
    const report = await validatePilotDataset(
      submission(csv, { provenance: { ...SYNTHETIC_PROVENANCE, coverageStart: "2026-01-01", coverageEnd: "2026-03-31" } }),
    );
    const capability = report.datasetFindings.filter((f) => f.code === "NH-DC-1010");
    expect(capability.length).toBeGreaterThan(0);
    expect(capability.every((f) => f.severity === "dataset_warning")).toBe(true);
    // Warnings do not reject the dataset.
    expect(report.accepted).toBe(true);
    expect(report.usableForAssessment).toBe(true);
    // Without a stable cycle key each row IS individually weaker, and says so exactly once.
    const derived = report.rowFindings.filter((f) => f.code === "NH-DC-2019");
    expect(derived).toHaveLength(2);
  });
});

describe("claim boundary — what a validated dataset may never become", () => {
  it("a report carries no money, no proof and no causal claim", async () => {
    const report = await validatePilotDataset(submission(syntheticPilotCsv(5)));
    expect(report.claimBoundary).toEqual({
      observedInputOnly: true,
      provenanceIsCustomerAsserted: true,
      constitutesProof: false,
      constitutesRevenue: false,
    });
    const keys = Object.keys(report);
    for (const forbidden of ["revenueReturned", "auditableRevenue", "proof", "collected", "recovered", "fee"]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("customer-asserted independence is recorded as an assertion, never as verification", async () => {
    const report = await validatePilotDataset(
      submission(syntheticPilotCsv(2), {
        provenance: { ...SYNTHETIC_PROVENANCE, assertedIndependentOfBeneficiary: true },
      }),
    );
    // The assertion is preserved verbatim for the audit trail …
    expect(report.provenance.assertedIndependentOfBeneficiary).toBe(true);
    // … and the report still says provenance is customer-asserted. A claim never upgrades itself.
    expect(report.claimBoundary.provenanceIsCustomerAsserted).toBe(true);
    expect(report.claimBoundary.constitutesProof).toBe(false);
  });
});

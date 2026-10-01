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
  acceptsPreviousMajor,
  PILOT_DATA_CONTRACT_ID,
  looksLikePii,
  parseContractVersion,
  fieldsByRequirement,
  isWellFormedObligationRef,
  OBLIGATION_REF_PATTERN,
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
import { SAAS_CANONICAL_FIELDS, SAAS_REQUIRED, SAAS_SYNONYMS } from "../assessment/adapters/saasActivation";
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

  it("9c · EP-28 · GOLDEN VECTOR — the derivation is pinned absolutely, not relative to itself", async () => {
    // WHY THIS EXISTS. Every other identity assertion compares one derived key with another derived the same
    // way, so any change that moves all of them together is invisible: NC-47 (the full contract version in
    // place of the major) and NC-48 (the scheme string left at v1) both passed the entire suite. A derivation
    // with no absolute anchor is not pinned at all.
    //
    // So: fixed inputs, one expected digest. Changing this value means the identity of every dataset changes,
    // which by §10 is a MAJOR contract bump — updating the constant to make a red test green would be exactly
    // the silent re-identification the two-ledger rules forbid. If this fails, either the derivation changed
    // deliberately (bump the major, and say so in the contract) or it changed by accident.
    //
    // The label below is deliberately junk: it is fed in and must make no difference, which is this slice's
    // whole point.
    expect(
      await deriveIdempotencyKey({
        boundary: { boundaryId: "golden-boundary", datasetId: "any-label-at-all" },
        datasetFingerprint: "0".repeat(64),
        dateLocale: "MDY",
        amountFormat: "US",
        asOf: "2026-04-15",
        stallThresholdDays: 30,
        currency: "USD",
      }),
    ).toBe("pds_1bc639b3f5892d03381bfee75a37830fbe063b7132b31758e823000fcb849ffa");
  });

  it("10 · version support is not-newer, fails closed on nonsense, and honours §10's window", () => {
    expect(isSupportedContractVersion(PILOT_DATA_CONTRACT_VERSION)).toBe(true);
    expect(isSupportedContractVersion("2.0.0")).toBe(true);
    // EP-28 · §10's two-major window, now OPEN for real: major 2 declares major 1 row-semantics-identical,
    // so a customer's 1.x export is still accepted. That is the promise being kept, not a relaxation —
    // 2.0.0 changes the identity and the request envelope, neither of which a 1.x CSV can be wrong about.
    expect(COMPATIBILITY_POLICY.acceptedPreviousMajors).toEqual([1]);
    expect(isSupportedContractVersion("1.1.0")).toBe(true);
    expect(isSupportedContractVersion("1.0.0")).toBe(true);
    // 2.1.0 · An OLDER MINOR of the same major is accepted and its version recorded, which is what
    // `acceptsOlderMinorOfSameMajor` promises and what makes a minor bump safe for a customer who has
    // already built an export pipeline. 2.0.1 moved from "newer than implemented" to "older minor" the
    // moment the constant went to 2.1.0 — that transition IS the promise being kept.
    expect(COMPATIBILITY_POLICY.acceptsOlderMinorOfSameMajor).toBe(true);
    expect(isSupportedContractVersion("2.0.1")).toBe(true);
    // Fail-closed everywhere else: a newer major, a newer minor or patch, an undeclared older major.
    expect(isSupportedContractVersion("3.0.0")).toBe(false);
    expect(isSupportedContractVersion("2.99.0")).toBe(false);
    expect(isSupportedContractVersion("2.1.1")).toBe(false);
    expect(isSupportedContractVersion("2.2.0")).toBe(false);
    expect(isSupportedContractVersion("0.9.0")).toBe(false);
    expect(isSupportedContractVersion("not-a-version")).toBe(false);
  });

  it("10b · EP-27 · §10's two-major window is a CHECKED declaration, exercised at a future major", () => {
    // The rule is a pure function of both versions, so the promise is proved WITHOUT bumping the
    // published constant — evidence before the change rather than after it. `implemented: "2.0.0"` here
    // is a hypothetical build, and `MAJOR_ROW_SEMANTICS` is what such a build would have to declare.
    expect(acceptsPreviousMajor(1, 0)).toBe(false); // nothing is compatible by default

    // A build that HAS declared the previous major row-semantics-identical accepts it...
    const declaring = { 2: [1] } as Readonly<Record<number, readonly number[]>>;
    const accepts = (declared: string, implemented: string) => {
      const d = parseContractVersion(declared);
      const impl = parseContractVersion(implemented);
      if (!d || !impl) return false;
      if (d.major > impl.major) return false;
      if (d.major < impl.major) return (declaring[impl.major] ?? []).includes(d.major);
      return true;
    };
    expect(accepts("1.1.0", "2.0.0")).toBe(true);
    // ...and still refuses a NEWER major, and a major it has not named.
    expect(accepts("3.0.0", "2.0.0")).toBe(false);
    expect(accepts("0.9.0", "2.0.0")).toBe(false);

    // The real gate, at the real constant, now agrees with BOTH halves — major 2 declares major 1.
    expect(acceptsPreviousMajor(2, 1)).toBe(true);
    expect(isSupportedContractVersion("1.1.0", "2.0.0")).toBe(true);
    expect(isSupportedContractVersion("2.0.0", "2.0.0")).toBe(true);
    expect(isSupportedContractVersion("2.0.1", "2.0.0")).toBe(false); // newer patch, still refused
    expect(isSupportedContractVersion("3.0.0", "2.0.0")).toBe(false);
    // A hypothetical major 3 declaring nothing refuses major 2, so opening the window once is not a
    // precedent that opens it again by itself — the fail-closed default survives.
    expect(isSupportedContractVersion("2.0.0", "3.0.0")).toBe(false);
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

  it("9 · EP-28 · the identity is the DATA plus what changes its meaning — never the operator's label", async () => {
    // REWRITTEN for the v2 derivation. The previous version of this test asserted the properties of the v1
    // identity, in which the free-text dataset label varied the key — that is the defect this closes, so the
    // test that encoded it could not survive the change. What it asserted about bytes and tenants still
    // holds and is kept.
    const csv = syntheticPilotCsv(3);
    const a = await validatePilotDataset(submission(csv));
    const b = await validatePilotDataset(submission(csv));
    expect(a.idempotencyKey).toBe(b.idempotencyKey);

    const base = {
      boundary: SYNTHETIC_BOUNDARY,
      datasetFingerprint: a.datasetFingerprint,
      dateLocale: "auto",
      amountFormat: "auto",
      asOf: policy.asOf,
      stallThresholdDays: policy.stallThresholdDays,
      currency: policy.currency,
    };
    // The validator and the exported derivation agree — so everything below is about the real key.
    expect(await deriveIdempotencyKey(base)).toBe(a.idempotencyKey);

    // THE DEFECT, CLOSED. The label is operator-supplied, so it must not move the identity.
    expect(
      await deriveIdempotencyKey({
        ...base,
        boundary: { boundaryId: SYNTHETIC_BOUNDARY.boundaryId, datasetId: "renamed-to-get-a-second-look" },
      }),
    ).toBe(a.idempotencyKey);

    // Another tenant is a different exposure — byte-identical files never collide across boundaries.
    expect(
      await deriveIdempotencyKey({
        ...base,
        boundary: { boundaryId: "synthetic-boundary-9999", datasetId: SYNTHETIC_BOUNDARY.datasetId },
      }),
    ).not.toBe(a.idempotencyKey);

    // A different file is a different dataset and deserves its own decision.
    const changed = await validatePilotDataset(submission(syntheticPilotCsv(4)));
    expect(changed.idempotencyKey).not.toBe(a.idempotencyKey);

    // Everything that changes what the data MEANS moves the identity, one field at a time.
    for (const [label, over] of [
      ["date locale", { dateLocale: "MDY" }],
      ["amount format", { amountFormat: "EU" }],
      ["currency", { currency: "EUR" }],
      ["as-of cut-off", { asOf: "2026-12-31" }],
      ["stall threshold", { stallThresholdDays: 31 }],
    ] as const) {
      expect(await deriveIdempotencyKey({ ...base, ...over }), label).not.toBe(a.idempotencyKey);
    }

    // "auto" is itself a choice: pinning a locale is a different reading from letting it be detected.
    expect(await deriveIdempotencyKey({ ...base, dateLocale: "DMY" })).not.toBe(
      await deriveIdempotencyKey({ ...base, dateLocale: "auto" }),
    );

    expect(isDuplicateSubmission(a.idempotencyKey, new Set([b.idempotencyKey]))).toBe(true);
    expect(isDuplicateSubmission(changed.idempotencyKey, new Set([a.idempotencyKey]))).toBe(false);
  });

  it("9b · EP-28 · the version component is the MAJOR, so a patch or minor bump preserves identities", async () => {
    // v1 embedded `id@1.1.0`, so a PATCH bump reset every identity — which contradicts §10's own minor
    // promise ("a dataset valid under X.Y is still valid under X.(Y+1)") and was never intentional: the
    // commit that bumped 1.0.0 → 1.1.0 reasoned "no previously valid dataset newly rejected" while
    // introducing duplicate detection in the same act. A MAJOR may redefine what a field means, so majors
    // must not share an identity space; a patch may not, so patches must.
    //
    // Canonicalised here under three version strings, because the derivation reads the module constant and a
    // test cannot bump it.
    //
    // THIS TEST CANNOT CATCH A CHANGE OF FORM, and an earlier revision of this comment wrongly claimed test 9
    // would. It does not: every other assertion in this file compares one derived key to another derived the
    // same way, so swapping the major for the full version, or the scheme string for its predecessor, moves
    // them all together and nothing fails. Negative controls NC-47 and NC-48 demonstrated exactly that — they
    // failed to fail. Test 9c is the absolute anchor that closes it; this test covers only the granularity
    // relationship between versions.
    const { createHash } = await import("node:crypto");
    const keyUnder = (version: string) =>
      createHash("sha256")
        .update(
          [
            "nh-pilot-dataset-v2",
            `${PILOT_DATA_CONTRACT_ID}@major-${version.split(".")[0]}`,
            SYNTHETIC_BOUNDARY.boundaryId,
            "fingerprint",
            "auto",
            "auto",
            "USD",
            "2026-04-15",
            "30",
          ].join("\u0000"),
        )
        .digest("hex");

    expect(keyUnder("2.0.0")).toBe(keyUnder("2.0.1")); // patch: identity preserved
    expect(keyUnder("2.0.0")).toBe(keyUnder("2.7.3")); // minor: identity preserved
    expect(keyUnder("2.0.0")).not.toBe(keyUnder("3.0.0")); // major: a new identity space

    // MIGRATION, asserted rather than assumed: a pre-cutover (major 1) key is NOT recognised afterwards.
    // That is one free re-assessment per historical dataset at the cutover — permitted, because a second
    // reading is measured under a governed AssessmentPolicy the beneficiary cannot author, and nothing
    // historical is rewritten. Recorded here so the consequence is a tested claim and not a footnote.
    expect(keyUnder("1.1.0")).not.toBe(keyUnder("2.0.0"));
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

// ── 2.1.0 · obligation_ref is DECLARED but NOT identity-bearing ───────────────────────────────────
//
// The whole point of this block is that declaring a column must change nothing a customer already
// relies on, and must not quietly make the system think obligation identity is solved. Each test below
// is one way that could go wrong. Reasoning: docs/OBLIGATION_IDENTITY_V1.md.

/** Append an `obligation_ref` column to an existing contract-valid CSV. */
function withObligationRef(csv: string, refFor: (rowIndex: number) => string): string {
  const lines = csv.replace(/\n$/, "").split("\n");
  return (
    [`${lines[0]},obligation_ref`, ...lines.slice(1).map((line, i) => `${line},${refFor(i)}`)].join("\n") + "\n"
  );
}

describe("2.1.0 · obligation_ref", () => {
  it("is OPTIONAL, never recommended — because `recommended` would move a governed admission threshold", () => {
    const spec = contractField("obligation_ref");
    expect(spec).toBeDefined();
    expect(spec!.requirement).toBe("optional");
    expect(spec!.kind).toBe("identifier");
    expect(spec!.piiClass).toBe("identifier_pseudonymous");
    expect(spec!.since).toBe("2.1.0");
    // The load-bearing assertion. `fieldsByRequirement("recommended")` feeds `missingRecommendedColumns`,
    // which the admission gate checks against a GOVERNED, version-pinned threshold. If this field ever
    // became recommended, every existing export would gain one and a boundary sitting at its threshold
    // would flip inadmissible with no remedy under anti-tuning.
    expect(fieldsByRequirement("recommended")).not.toContain("obligation_ref");
  });

  it("has ZERO synonyms, and none of the four rejected names is registered anywhere", () => {
    expect(SAAS_SYNONYMS["obligation_ref"]).toBeUndefined();
    // Not merely absent from this field — absent from EVERY field, so none of them can be claimed by a
    // neighbouring canonical either. `invoice_number` in particular is a display sequence that billing
    // systems re-issue on correction, so it must never become identity-bearing by convenience.
    const everySynonym = Object.values(SAAS_SYNONYMS).flatMap((list) => [...list]);
    for (const rejected of ["invoice_id", "invoice_number", "billing_document_id", "obligation_id"]) {
      expect(everySynonym).not.toContain(rejected);
    }
  });

  it("changes NOTHING for an export that does not carry the column", async () => {
    const csv = syntheticPilotCsv(8);
    const report = await validatePilotDataset(submission(csv));
    expect(report.accepted).toBe(true);
    expect(report.usableForAssessment).toBe(true);
    // No new finding of any kind appears on a dataset that never mentions the field.
    expect(codesFor(report.rowFindings)).not.toContain("NH-DC-2022");
    expect(codesFor(report.datasetFindings)).not.toContain("NH-DC-1010");
    expect(report.columnMapping["obligation_ref"]).toBeUndefined();
  });

  it("is now ACCEPTED where it was previously rejected as an undeclared column — the relaxation", async () => {
    const csv = withObligationRef(syntheticPilotCsv(8), (i) => `INV-${1000 + i}`);
    const report = await validatePilotDataset(submission(csv));
    // Before 2.1.0 this file failed minimization outright, because the contract rejects rather than
    // ignores any column it does not declare.
    expect(codesFor(report.datasetFindings)).not.toContain("NH-DC-1005");
    expect(report.accepted).toBe(true);
    expect(report.usableForAssessment).toBe(true);
    expect(report.acceptedCycles.length).toBe(8);
  });

  it("warns on a malformed value and KEEPS the row — a non-identity field must not move a measured amount", async () => {
    const good = withObligationRef(syntheticPilotCsv(8), (i) => `INV-${1000 + i}`);
    const bad = withObligationRef(syntheticPilotCsv(8), (i) => (i === 0 ? "has a space" : `INV-${1000 + i}`));
    const goodReport = await validatePilotDataset(submission(good));
    const badReport = await validatePilotDataset(submission(bad));

    expect(codesFor(badReport.rowFindings)).toContain("NH-DC-2022");
    expect(rejectionCode("NH-DC-2022")!.severity).toBe("row_warning");
    // The population is IDENTICAL. A warning that silently shrank the accepted set would be a rejection
    // wearing a warning's label, and the measured amount would then depend on a field that identifies
    // nothing yet.
    expect(badReport.acceptedCycles.length).toBe(goodReport.acceptedCycles.length);
    expect(badReport.counts.acceptedRows).toBe(goodReport.counts.acceptedRows);
    expect(badReport.counts.rejectedRows).toBe(goodReport.counts.rejectedRows);
    expect(badReport.usableForAssessment).toBe(true);
  });

  it("never echoes the reference value into a finding", async () => {
    const csv = withObligationRef(syntheticPilotCsv(2), () => "not a valid ref at all");
    const report = await validatePilotDataset(submission(csv));
    const finding = report.rowFindings.find((f) => f.code === "NH-DC-2022");
    expect(finding).toBeDefined();
    expect(finding!.detail).not.toContain("not a valid ref");
  });

  it("leaves the duplicate-row equivalence relation exactly as it was", async () => {
    // Adding a field changes the content key's VALUE (one more element) but must not change WHICH rows
    // are considered identical. Two byte-identical rows are still a duplicate …
    const rows = syntheticPilotRows(4);
    const dupCsv = withObligationRef(toCsv([rows[0]!, rows[0]!, rows[1]!, rows[2]!]), () => "INV-SAME");
    const dupReport = await validatePilotDataset(submission(dupCsv));
    expect(codesFor(dupReport.rowFindings)).toContain("NH-DC-4001");

    // … and two rows differing ONLY in the new field are not.
    const distinctCsv = withObligationRef(toCsv([rows[0]!, rows[1]!]), (i) => `INV-${i}`);
    const distinctReport = await validatePilotDataset(submission(distinctCsv));
    expect(codesFor(distinctReport.rowFindings)).not.toContain("NH-DC-4001");
  });

  it("bounds the shape syntactically, and claims nothing more than that", () => {
    expect(isWellFormedObligationRef("")).toBe(true); // optional: absence is not malformation
    expect(isWellFormedObligationRef("INV-2026-001")).toBe(true);
    expect(isWellFormedObligationRef("ar/invoice:42.1_b")).toBe(true);
    expect(isWellFormedObligationRef("a".repeat(128))).toBe(true);
    expect(isWellFormedObligationRef("a".repeat(129))).toBe(false);
    expect(isWellFormedObligationRef("-leading-separator")).toBe(false);
    expect(isWellFormedObligationRef("has a space")).toBe(false);
    expect(isWellFormedObligationRef(" INV-1")).toBe(false); // the pipeline trims; this would be refused anyway
    expect(isWellFormedObligationRef("INV\u00001")).toBe(false);
    // The pattern is narrower than the 256-byte component bound in leakInstanceIdentity.ts, so it is the
    // binding constraint — but a value satisfying it is NOT thereby an identity.
    expect(OBLIGATION_REF_PATTERN.source).toContain("{0,127}");
  });
});

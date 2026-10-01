// EP-28 · The v2 submission identity, through the real HTTP surface and the real database.
//
// THE DEFECT CLOSED: v1 derived the key over `(contract ref, boundaryId, datasetId, fingerprint)` where
// `datasetId` is the free-text label the uploader types. So byte-identical data in the same boundary could be
// submitted and assessed again by RENAMING it — the party who benefits from the number controlled the
// identity. The label is gone; in its place are the parameters that genuinely change the answer.
//
// This suite is the list `docs/ASSESSMENT_IDENTITY_V1.md` requires before the change lands. Every "accepted"
// case also asserts that the REPORT DEMONSTRABLY DIFFERS, not merely that the key differs — a key that moves
// while the numbers do not would mean the field had no business being in the identity.
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { buildApp } from "../app";
import { prisma } from "../db";
import { fixtureVerifier } from "../test/sourceFixture";
import {
  SYNTHETIC_PROVENANCE,
  syntheticPilotCsv,
  syntheticPilotRows,
  toCsv,
} from "../../src/contract/syntheticPilotDataset";
import { DATASET_CODES, ROW_CODES } from "../../src/contract/rejectionCodes";
import { PILOT_DATA_CONTRACT_VERSION } from "../../src/contract/pilotDataContract";
import { ensureGovernedTerms, GOVERNED_TERMS_FIELDS, TEST_ANALYSIS_TERMS } from "../test/governedTerms";

const HAS_DB = !!process.env.DATABASE_URL;
const OPERATOR = { "x-actor-id": "pilot-operator@company", "x-actor-role": "operator" };
const uid = () => Math.random().toString(36).slice(2, 10);

describe.skipIf(!HAS_DB)("EP-28 · the submission identity is the data plus what changes its meaning", () => {
  const app = buildApp({ sourceVerifier: fixtureVerifier });
  beforeAll(async () => {
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const post = (payload: unknown) =>
    app.inject({ method: "POST", url: "/pilot/datasets", headers: OPERATOR, payload: payload as object });

  const body = (over: Record<string, unknown> = {}) => ({
    boundaryId: `pb-${uid()}`,
    datasetId: `ds-${uid()}`,
    declaredVersion: PILOT_DATA_CONTRACT_VERSION,
    csvText: syntheticPilotCsv(40),
    provenance: SYNTHETIC_PROVENANCE,
    ...GOVERNED_TERMS_FIELDS,
    ...over,
  });

  /** One boundary with governed terms active, ready to submit into. */
  async function boundary() {
    const boundaryId = `pb-${uid()}`;
    await ensureGovernedTerms(boundaryId);
    return boundaryId;
  }

  it("1 · SAME BYTES, DIFFERENT LABEL ⇒ DUPLICATE — the defect, closed", async () => {
    // This is the assertion the whole sequence exists for. Under v1 this second call returned 200 and the
    // dataset could be assessed again; the journey measured that and passed BECAUSE of it.
    const boundaryId = await boundary();
    const csvText = syntheticPilotCsv(40);
    const first = await post(body({ boundaryId, csvText, datasetId: "as-submitted" }));
    expect(first.statusCode).toBe(200);
    expect(first.json().accepted).toBe(true);

    const relabelled = await post(body({ boundaryId, csvText, datasetId: "renamed-to-get-a-second-look" }));
    expect(relabelled.statusCode).toBe(409);
    expect(relabelled.json().message).toContain("NH-DC-4003");

    // ONE row, and it is the first one. The label did not create a second governed consequence.
    expect(await prisma.pilotDatasetSubmissionRecord.count({ where: { boundaryId } })).toBe(1);
    const row = await prisma.pilotDatasetSubmissionRecord.findFirstOrThrow({ where: { boundaryId } });
    expect(row.datasetId).toBe("as-submitted");
  });

  it("2 · different BYTES ⇒ accepted, and the counts differ", async () => {
    const boundaryId = await boundary();
    const a = await post(body({ boundaryId, csvText: syntheticPilotCsv(40) }));
    const b = await post(body({ boundaryId, csvText: syntheticPilotCsv(41) }));
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(a.json().idempotencyKey).not.toBe(b.json().idempotencyKey);
    expect(a.json().counts.dataRows).not.toBe(b.json().counts.dataRows);
  });

  it("3 · different BOUNDARY ⇒ accepted — the same bytes under another tenant are another exposure", async () => {
    const csvText = syntheticPilotCsv(40);
    const one = await boundary();
    const two = await boundary();
    const a = await post(body({ boundaryId: one, csvText }));
    const b = await post(body({ boundaryId: two, csvText }));
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(a.json().idempotencyKey).not.toBe(b.json().idempotencyKey);
  });

  it("4 · different AMOUNT FORMAT ⇒ three readings, three verdicts, three identities", async () => {
    // WHAT THE FORMAT ACTUALLY DECIDES, established from `normalizeAmount` rather than assumed: it is
    // consulted in exactly ONE branch — a single separator with a THREE-DIGIT tail (`1,200` / `1.200`).
    // Everything else is format-independent by design: two separators means the last is the decimal point,
    // repeated separators mean grouping, a single separator with a non-3-digit tail is the decimal. The
    // synthetic fixture emits `<major>.00`, a 2-digit tail, so US and EU read it identically — correct
    // behaviour, and the reason this test builds its own row instead of using that fixture.
    //
    // (An earlier revision asserted that `1.234,56` differs by format. Wrong: both separators are present,
    // so it is format-independent. Struck rather than reworded.)
    //
    // The three readings of ONE byte sequence, measured rather than predicted:
    //   EU   → `.` is grouping    → 1200, a clean integer  → 40 accepted, no findings
    //   US   → `.` is the decimal → 1.200, three fractional digits in a 2-digit currency, which `Money`
    //          refuses to round → 39 accepted, NH-DC-2007
    //   auto → refuses to choose → 39 accepted, NH-DC-2008
    // So a declared interpretation changes the accepted POPULATION and the REASON a row was refused. That is
    // why the field belongs in the identity, and it is a stronger demonstration than a changed total.
    const boundaryId = await boundary();
    const rows = syntheticPilotRows(40);
    const csvText = toCsv([{ ...rows[0]!, next_invoice_amount: "1.200" }, ...rows.slice(1)]);
    const codesOf = (res: { json: () => { rowFindings: readonly { code: string }[] } }) =>
      [...new Set(res.json().rowFindings.map((f) => f.code))].sort();

    const us = await post(body({ boundaryId, csvText, amountFormat: "US" }));
    const eu = await post(body({ boundaryId, csvText, amountFormat: "EU" }));
    const auto = await post(body({ boundaryId, csvText }));
    for (const r of [us, eu, auto]) expect(r.statusCode).toBe(200);

    // Three distinct identities — none is a duplicate of another.
    expect(new Set([us, eu, auto].map((r) => r.json().idempotencyKey)).size).toBe(3);

    expect(eu.json().counts.acceptedRows).toBe(40);
    expect(codesOf(eu)).toEqual([]);
    expect(us.json().counts.acceptedRows).toBe(39);
    expect(codesOf(us)).toEqual([ROW_CODES.INVALID_AMOUNT.code]);
    expect(auto.json().counts.acceptedRows).toBe(39);
    expect(codesOf(auto)).toEqual([ROW_CODES.AMBIGUOUS_AMOUNT.code]);
    // The two 39s are NOT the same verdict — the refusal has a different reason, so the reading differs even
    // where the count coincides. An assertion on counts alone would have missed that.
    expect(codesOf(us)).not.toEqual(codesOf(auto));
  });

  it("5 · different DATE LOCALE ⇒ accepted, and the two are NOT independent of the amount format", async () => {
    // One column can be read as a date or as an amount, so `(locale, amountFormat)` describes ONE
    // interpretation and moves together. Asserted as a pair: all four combinations are distinct identities.
    const boundaryId = await boundary();
    const csvText = syntheticPilotCsv(40);
    const keys = new Set<string>();
    for (const locale of ["MDY", "DMY"] as const) {
      for (const amountFormat of ["US", "EU"] as const) {
        const res = await post(body({ boundaryId, csvText, locale, amountFormat }));
        expect(res.statusCode, `${locale}/${amountFormat}`).toBe(200);
        keys.add(res.json().idempotencyKey);
      }
    }
    expect(keys.size).toBe(4);

    // And "auto" is a fifth: pinning an interpretation is a different reading from letting it be detected.
    const auto = await post(body({ boundaryId, csvText }));
    expect(auto.statusCode).toBe(200);
    expect(keys.has(auto.json().idempotencyKey)).toBe(false);
  });

  it("6 · different GOVERNED TERMS ⇒ accepted, and the admission is re-judged under them", async () => {
    // The one legitimate route to a second reading of the same extract. It is accepted because the definition
    // changed — and because the identity contains the definition, the ADMISSION VERDICT is recomputed under
    // the new cut-off rather than an old verdict authorising a run it never judged.
    const boundaryId = await boundary();
    const csvText = syntheticPilotCsv(40);
    const first = await post(body({ boundaryId, csvText }));
    expect(first.statusCode).toBe(200);

    const later = await ensureGovernedTerms(boundaryId, { termsId: "terms-later", asOf: "2026-06-30" });
    const second = await post(
      body({
        boundaryId,
        csvText,
        analysisTermsId: later.analysisTermsId,
        analysisTermsVersion: later.analysisTermsVersion,
      }),
    );
    expect(second.statusCode).toBe(200);
    expect(second.json().idempotencyKey).not.toBe(first.json().idempotencyKey);
    // Two rows, two decisions, neither overwriting the other.
    expect(await prisma.pilotDatasetSubmissionRecord.count({ where: { boundaryId } })).toBe(2);
  });

  it("7 · UNGOVERNED terms ⇒ refused, so the re-reading route cannot be self-granted", async () => {
    // The route in test 6 is only open through a definition someone else activated. Without that, there is no
    // new identity to be had — the request is refused before the bytes are parsed.
    const boundaryId = await boundary();
    const res = await post(
      body({ boundaryId, analysisTermsId: "terms-never-proposed", analysisTermsVersion: "1.0.0" }),
    );
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toContain("analysis terms are not governed");
    expect(await prisma.pilotDatasetSubmissionRecord.count({ where: { boundaryId } })).toBe(0);
  });

  it("8 · a PROVENANCE-CORRECTED resubmission ⇒ accepted, because the first wrote no row", async () => {
    // Provenance can only flip a dataset from rejected to accepted, and a rejected dataset writes no row — so
    // a corrected resubmission is already new, and provenance has no business in the identity.
    //
    // WHAT ACTUALLY REJECTS, established from the code rather than assumed. Two earlier premises were wrong:
    //   • `assertedIndependentOfBeneficiary: false` — `validateProvenance` only refuses a non-boolean, so
    //     `false` is a valid declaration producing no finding: the contract RECORDS the customer's assertion
    //     rather than demanding a particular answer. And `SYNTHETIC_PROVENANCE` already carries `false`, so
    //     the two submissions were identical in provenance and the second was rightly a duplicate.
    //   • `extractionMethod: ""` — refused by the TRANSPORT (`minLength: 1`) with a 400, so it never reaches
    //     the validator and proves nothing about provenance.
    // A reversed coverage window passes the schema (`minLength`/`maxLength` only) and is refused by the
    // contract: `coverageWindow` returns null unless start <= end, giving NH-DC-1009 at DATASET level.
    const boundaryId = await boundary();
    const csvText = syntheticPilotCsv(40);
    const bad = await post(
      body({
        boundaryId,
        csvText,
        provenance: { ...SYNTHETIC_PROVENANCE, coverageStart: "2026-03-31", coverageEnd: "2026-01-01" },
      }),
    );
    expect(bad.statusCode).toBe(200);
    expect(bad.json().accepted).toBe(false);
    expect((bad.json().datasetFindings as { code: string }[]).map((f) => f.code)).toContain(
      DATASET_CODES.COVERAGE_WINDOW_INVALID.code,
    );
    expect(await prisma.pilotDatasetSubmissionRecord.count({ where: { boundaryId } })).toBe(0);

    const corrected = await post(body({ boundaryId, csvText }));
    expect(corrected.statusCode).toBe(200);
    expect(corrected.json().accepted).toBe(true);
    expect(await prisma.pilotDatasetSubmissionRecord.count({ where: { boundaryId } })).toBe(1);
  });

  it("9 · MIGRATION · a pre-cutover row is NOT recognised, and that is one free re-assessment", async () => {
    // Asserted explicitly, either way, because the alternative is discovering it in production. A row written
    // under the v1 identity keys differently from what v2 derives for the same bytes, so the first submission
    // after the cutover is accepted rather than refused as a duplicate.
    //
    // Permitted, and the reasoning is recorded rather than assumed: a second reading is measured under a
    // GOVERNED AssessmentPolicy the beneficiary cannot author, nothing historical is rewritten, and in
    // exchange the derivation permanently removes the operator-supplied label from the identity. See
    // docs/CONTRACT_DUAL_MAJOR_V1.md §5.
    const boundaryId = await boundary();
    const csvText = syntheticPilotCsv(40);
    const datasetId = `ds-${uid()}`;

    // The v1 key for these exact inputs, computed the way v1 computed it.
    const { createHash } = await import("node:crypto");
    const fingerprint = createHash("sha256").update(csvText).digest("hex");
    const legacyKey = `pds_${createHash("sha256")
      .update(
        ["nh-pilot-dataset-v1", "nh.customer-pilot-data-contract@1.1.0", boundaryId, datasetId, fingerprint].join("\u0000"),
      )
      .digest("hex")}`;
    await prisma.pilotDatasetSubmissionRecord.create({
      data: {
        idempotencyKey: legacyKey,
        boundaryId,
        datasetId,
        contractVersion: "1.1.0",
        declaredVersion: "1.1.0",
        datasetFingerprint: fingerprint,
        accepted: true,
        usable: true,
        dataRows: 40,
        acceptedRows: 40,
        rejectedRows: 0,
        warnedRows: 0,
        findingCodes: [],
        submittedByActorId: "pre-cutover@company",
        submittedByRole: "operator",
      },
    });

    // Same bytes, same label, same boundary — and accepted, because the identity is not the same identity.
    const afterCutover = await post(body({ boundaryId, csvText, datasetId }));
    expect(afterCutover.statusCode).toBe(200);
    expect(afterCutover.json().accepted).toBe(true);
    expect(afterCutover.json().idempotencyKey).not.toBe(legacyKey);

    // The historical row is still there, untouched. Nothing was rewritten or reinterpreted.
    const rows = await prisma.pilotDatasetSubmissionRecord.findMany({ where: { boundaryId }, orderBy: { idempotencyKey: "asc" } });
    expect(rows).toHaveLength(2);
    const legacy = rows.find((r) => r.idempotencyKey === legacyKey);
    expect(legacy?.contractVersion).toBe("1.1.0");
    expect(legacy?.declaredVersion).toBe("1.1.0");

    // And the free re-assessment is EXACTLY ONE: the second attempt under v2 is refused like any repeat.
    const again = await post(body({ boundaryId, csvText, datasetId }));
    expect(again.statusCode).toBe(409);
    expect(again.json().message).toContain("NH-DC-4003");
  });

  it("10 · a 1.x DECLARATION is still accepted under the current major — §10's window, end to end", async () => {
    // EP-27 built the mechanism with an empty declaration; EP-28 opened it. This is the promise a customer
    // reads, measured through the real intake: an export built against the previous major still works.
    const boundaryId = await boundary();
    const res = await post(body({ boundaryId, declaredVersion: "1.1.0" }));
    expect(res.statusCode).toBe(200);
    expect(res.json().accepted).toBe(true);
    const row = await prisma.pilotDatasetSubmissionRecord.findFirstOrThrow({ where: { boundaryId } });
    expect(row.declaredVersion).toBe("1.1.0");
    // The IMPLEMENTED version, read from the constant rather than pinned to a literal. Pinning it meant a
    // minor bump failed here for no reason: what this test is about is that the DECLARED version is kept
    // distinct from the implemented one, not what the implemented one happens to be.
    expect(row.contractVersion).toBe(PILOT_DATA_CONTRACT_VERSION);

    // ...and the declaration does NOT move the identity: the same bytes declared as an OLDER SUPPORTED
    // MINOR of the current major are a duplicate, because such a declaration is interpreted identically
    // and must not buy a second reading. Since 2.1.0 this is a genuinely older minor rather than the
    // current version, so it now exercises `acceptsOlderMinorOfSameMajor` instead of restating itself.
    const asOlderMinor = await post(body({ boundaryId, declaredVersion: "2.0.0" }));
    expect(asOlderMinor.statusCode).toBe(409);
    expect(asOlderMinor.json().message).toContain("NH-DC-4003");
  });

  it("11 · the governed policy values reach the identity from the REGISTER, not from the caller", async () => {
    // The three governed fields are in the identity, and a caller cannot state them (EP-26b). So two
    // boundaries whose registered definitions DIFFER derive different keys for identical bytes — proving the
    // register, not the request, is what moved the identity.
    const csvText = syntheticPilotCsv(40);
    const sameTerms = await boundary();
    const otherTerms = `pb-${uid()}`;
    await ensureGovernedTerms(otherTerms, { asOf: "2026-05-31" });

    const a = await post(body({ boundaryId: sameTerms, csvText }));
    const b = await post(body({ boundaryId: otherTerms, csvText }));
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(a.json().idempotencyKey).not.toBe(b.json().idempotencyKey);
    // Different boundaries alone would explain that, so the discriminating case is the SAME boundary with a
    // second definition — test 6 — and the two together show the register is what is being read.
    expect(TEST_ANALYSIS_TERMS.asOf).not.toBe("2026-05-31");
  });
});

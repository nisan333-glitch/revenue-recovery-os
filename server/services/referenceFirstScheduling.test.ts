// S4 · Reference-first scheduling: the facts the scheduler refuses to take from the requester.
//
// WHAT WAS WRONG. Scheduling used to begin by VALIDATING the re-supplied bytes under whatever the
// request claimed — the declared contract version, the date locale, the amount format and the analysis
// terms — and the key that fell out of that validation was how the admission decision was found. Every
// authoritative input therefore arrived from the party that benefits from the number, and the closing
// "check" compared a hash of those inputs against a record selected BY that same hash, which can only
// ever agree. Worse, `declaredVersion` was not even inert: a malformed or unsupported value raised a
// dataset-level rejection, which empties `acceptedCycles`, which refused a properly admitted dataset
// with NH-AX-1009 — "no accepted cycle survived projection" — as though its data were at fault.
//
// WHAT IS TRUE NOW. The request may CITE the admission decision. From that reference the scheduler reads
// the admitted declaration, the date locale, the amount format, the governed analysis-terms address and
// the contract major, re-derives the submission key from exactly those facts, and compares it to the key
// the record is stored under. Because the record was NOT selected by that key, the comparison can fail —
// which is what makes it evidence rather than a restatement.
//
// WHAT THIS SUITE MEASURES, not asserts:
//   A · the reference is the anchor, and `declaredVersion` is observably inert;
//   B · the record answers and the request may not override it;
//   C · a stored identity that does not reproduce from the record's own facts is refused;
//   D · the snapshot gate — what happens to admissions recorded before it existed.
//
// Every negative here has a positive control beside it, built the same way with one field different, so
// a refusal is attributable to that field and to nothing else.
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { buildApp } from "../app";
import { prisma } from "../db";
import { fixtureVerifier } from "../test/sourceFixture";
import { SYNTHETIC_PROVENANCE, syntheticPilotCsv, SCENARIO_POLICY } from "../../src/contract/syntheticPilotDataset";
import { PILOT_DATA_CONTRACT_VERSION, parseContractVersion } from "../../src/contract/pilotDataContract";
import { ADMISSION_CALC_VERSION } from "../../src/contract/pilotAdmissionPolicy";
import { deriveIdempotencyKey, validatePilotDataset } from "../../src/contract/validateDataset";
import { deriveAdmissionDecisionId } from "../../src/contract/assessmentExecution";
import { hashAdmissionPolicy } from "../../src/contract/policyHash";
import { findAdmissionPolicy } from "../persistence/pilotAdmissionPolicyStore";
import { makePolicy } from "../../src/assessment/policy";
import { appendAnalysisTermsEvent } from "../persistence/pilotAnalysisTermsStore";
import { ensureGovernedTerms, GOVERNED_TERMS_FIELDS, TEST_ANALYSIS_TERMS } from "../test/governedTerms";

const HAS_DB = !!process.env.DATABASE_URL;
const OPERATOR = { "x-actor-id": "pilot-operator@company", "x-actor-role": "operator" };
const STEWARD = { "x-actor-id": "gov@company", "x-actor-role": "steward" };
const uid = () => Math.random().toString(36).slice(2, 10);
/**
 * A fresh 64-hex digest shape. `idempotency_key` is the submission table's PRIMARY KEY — globally, not
 * per boundary — so a substituted key has to be unique per run or the second run of this suite collides
 * on the insert instead of exercising the check. The value only has to be wrong, not constant.
 */
const hex64 = () => Array.from({ length: 64 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");

describe.skipIf(!HAS_DB)("S4 · reference-first scheduling", () => {
  const app = buildApp({ sourceVerifier: fixtureVerifier });
  beforeAll(async () => {
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function activeBar(boundaryId: string) {
    const policyId = `pol-${uid()}`;
    expect(
      (await app.inject({
        method: "POST",
        url: "/pilot/admission-policies",
        headers: OPERATOR,
        payload: {
          boundaryId,
          policy: {
            policyId,
            policyVersion: "1.0.0",
            calculationMethodVersion: ADMISSION_CALC_VERSION,
            ...SCENARIO_POLICY,
            requiredLifecycleStates: [...SCENARIO_POLICY.requiredLifecycleStates],
          },
          rationale: "fixture",
        },
      })).statusCode,
    ).toBe(201);
    expect(
      (await app.inject({
        method: "POST",
        url: "/pilot/admission-policies/activate",
        headers: STEWARD,
        payload: { boundaryId, policyId, policyVersion: "1.0.0", rationale: "reviewed" },
      })).statusCode,
    ).toBe(200);
    return policyId;
  }

  /** Submit through the REAL intake, so the snapshot is the one production writes. */
  async function admitted(over: Record<string, unknown> = {}) {
    const boundaryId = `pb-${uid()}`;
    const datasetId = `ds-${uid()}`;
    const csvText = syntheticPilotCsv(40);
    await ensureGovernedTerms(boundaryId);
    const policyId = await activeBar(boundaryId);
    const submitted = await app.inject({
      method: "POST",
      url: "/pilot/datasets",
      headers: OPERATOR,
      payload: {
        boundaryId,
        datasetId,
        declaredVersion: PILOT_DATA_CONTRACT_VERSION,
        csvText,
        provenance: SYNTHETIC_PROVENANCE,
        ...GOVERNED_TERMS_FIELDS,
        admissionPolicyId: policyId,
        admissionPolicyVersion: "1.0.0",
        ...over,
      },
    });
    expect(submitted.statusCode, submitted.body).toBe(200);
    const body = submitted.json();
    expect(body.usableForAssessment).toBe(true);
    return { boundaryId, datasetId, csvText, body, decisionId: body.admissionDecisionId as string };
  }

  const schedule = (payload: Record<string, unknown>) =>
    app.inject({
      method: "POST",
      url: "/pilot/assessments",
      headers: OPERATOR,
      payload: {
        // S5 · no `declaredVersion`. The body has no such field and an injected one is a 400, which
        // tests A2 and A2b pin deliberately.
        provenance: SYNTHETIC_PROVENANCE,
        ...GOVERNED_TERMS_FIELDS,
        ...payload,
      },
    });

  /**
   * Write a decision row directly, with precise control over its stored identity and its snapshot.
   *
   * NOT an UPDATE: `pilot_dataset_submissions` carries an append-only trigger, so a written decision
   * cannot be edited — which is the guarantee. A tampered record is therefore MODELLED by inserting the
   * row the tamper would have produced. `undefined` means "what a real intake would have written", so
   * every override is visible in the call.
   */
  async function builtRow(
    over: {
      readonly idempotencyKey?: string;
      readonly admissionDecisionId?: string;
      readonly contractVersion?: string;
      readonly declaredVersion?: string | null;
      readonly snapshotDateLocale?: string | null;
      readonly snapshotAmountFormat?: string | null;
      readonly snapshotTermsId?: string | null;
      readonly snapshotTermsVersion?: string | null;
    } = {},
  ) {
    const boundaryId = `pb-${uid()}`;
    const datasetId = `ds-${uid()}`;
    const csvText = syntheticPilotCsv(40);
    await ensureGovernedTerms(boundaryId);
    const policyId = await activeBar(boundaryId);
    const report = await validatePilotDataset({
      boundary: { boundaryId, datasetId },
      declaredVersion: PILOT_DATA_CONTRACT_VERSION,
      csvText,
      provenance: SYNTHETIC_PROVENANCE,
      policy: makePolicy({
        policyId: TEST_ANALYSIS_TERMS.termsId,
        policyVersion: TEST_ANALYSIS_TERMS.termsVersion,
        stallThresholdDays: TEST_ANALYSIS_TERMS.stallThresholdDays,
        asOf: TEST_ANALYSIS_TERMS.asOf,
        currency: TEST_ANALYSIS_TERMS.currency,
      }),
    });
    const stored = await findAdmissionPolicy(boundaryId, policyId, "1.0.0");
    const policyHash = await hashAdmissionPolicy(stored!.policy);
    const contractVersion = over.contractVersion ?? PILOT_DATA_CONTRACT_VERSION;
    // The key is minted under THIS ROW'S own major, because that is what the build it stands in for
    // would have done. Anything else makes the row internally inconsistent and the refusal lands on
    // NH-AX-1012 rather than on the question under test.
    const honestKey = await deriveIdempotencyKey({
      boundary: { boundaryId, datasetId },
      datasetFingerprint: report.datasetFingerprint,
      dateLocale: "auto",
      amountFormat: "auto",
      asOf: TEST_ANALYSIS_TERMS.asOf,
      stallThresholdDays: TEST_ANALYSIS_TERMS.stallThresholdDays,
      currency: TEST_ANALYSIS_TERMS.currency,
      contractMajor: parseContractVersion(contractVersion)!.major,
    });
    const idempotencyKey = over.idempotencyKey ?? honestKey;
    const admissionDecisionId =
      over.admissionDecisionId ??
      (await deriveAdmissionDecisionId({
        boundaryId,
        idempotencyKey,
        datasetFingerprint: report.datasetFingerprint,
        contractVersion,
        outcome: "ADMISSIBLE",
        admissionPolicyId: policyId,
        admissionPolicyVersion: "1.0.0",
        admissionPolicyHash: policyHash,
      }));
    const pick = <T>(value: T | undefined, fallback: T): T => (value === undefined ? fallback : value);
    const pickV = pick;
    await prisma.pilotDatasetSubmissionRecord.create({
      data: {
        idempotencyKey,
        boundaryId,
        datasetId,
        contractVersion,
        declaredVersion: pickV(over.declaredVersion, PILOT_DATA_CONTRACT_VERSION),
        snapshotDateLocale: pick(over.snapshotDateLocale, "auto"),
        snapshotAmountFormat: pick(over.snapshotAmountFormat, "auto"),
        snapshotTermsId: pick(over.snapshotTermsId, TEST_ANALYSIS_TERMS.termsId),
        snapshotTermsVersion: pick(over.snapshotTermsVersion, TEST_ANALYSIS_TERMS.termsVersion),
        datasetFingerprint: report.datasetFingerprint,
        accepted: true,
        usable: true,
        dataRows: 40,
        acceptedRows: 40,
        rejectedRows: 0,
        warnedRows: 0,
        findingCodes: [],
        admissionOutcome: "ADMISSIBLE",
        admissionPolicyId: policyId,
        admissionPolicyVersion: "1.0.0",
        admissionPolicyHash: policyHash,
        admissionDecisionId,
        submittedByActorId: "constructed@company",
        submittedByRole: "operator",
      },
    });
    return { boundaryId, datasetId, csvText, admissionDecisionId, idempotencyKey, honestKey };
  }

  // ── A · the reference is the anchor ──────────────────────────────────────────────────────────────

  it("A1 · POSITIVE CONTROL · the same admission schedules by reference and by discovery, identically", async () => {
    // Both paths must reach the same execution. If citing the reference produced a DIFFERENT binding,
    // the two paths would be two products and the migration would be a silent re-identification.
    const a = await admitted();
    expect(a.decisionId).toMatch(/^PAD-[0-9a-f]{32}$/);

    const byReference = (
      await schedule({ boundaryId: a.boundaryId, datasetId: a.datasetId, csvText: a.csvText, admissionDecisionId: a.decisionId })
    ).json();
    expect(byReference.refusal, JSON.stringify(byReference.refusalDetail)).toBeNull();
    expect(byReference.scheduled).toBe(true);

    const byDiscovery = (
      await schedule({ boundaryId: a.boundaryId, datasetId: a.datasetId, csvText: a.csvText })
    ).json();
    expect(byDiscovery.refusal, JSON.stringify(byDiscovery.refusalDetail)).toBeNull();
    expect(byDiscovery.executionId).toBe(byReference.executionId);
    // Idempotent, not a second run: the identical binding reuses the row rather than scheduling twice.
    expect(byDiscovery.created).toBe(false);
  });

  it("A2 · a snapshot-bearing admission: an injected `declaredVersion` is REJECTED, and changes nothing", async () => {
    // S4 made this field inert. S5 removed it, so the proof changes character: the question is no longer
    // "does varying it change the outcome" but "can it be stated at all". It cannot — and the existing
    // schema policy decides what happens to someone who tries. `additionalProperties: false` under
    // `removeAdditional: false` (app.ts: "REJECTS (400) an injected field ... instead of silently
    // stripping it") means a 400. That policy is PINNED here, not invented: silent stripping would also
    // be safe for the result, but it would tell a caller their field was accepted.
    const a = await admitted();

    // The same request WITHOUT it schedules. This is the control: the 400s below are attributable to the
    // injected field and to nothing else about the request.
    const ok = (
      await schedule({ boundaryId: a.boundaryId, datasetId: a.datasetId, csvText: a.csvText, admissionDecisionId: a.decisionId })
    ).json();
    expect(ok.refusal, JSON.stringify(ok.refusalDetail)).toBeNull();
    expect(ok.scheduled).toBe(true);

    const before = (await app.inject({ method: "GET", url: `/pilot/assessments?boundaryId=${a.boundaryId}`, headers: OPERATOR })).json();

    // Four values, including the two that USED to refuse a properly admitted dataset with NH-AX-1009.
    // All four are now refused by the transport, identically, before any scheduling logic is reached.
    for (const declaredVersion of [PILOT_DATA_CONTRACT_VERSION, "1.0.0", "9.9.9", "not-a-version"]) {
      const res = await schedule({
        boundaryId: a.boundaryId,
        datasetId: a.datasetId,
        csvText: a.csvText,
        admissionDecisionId: a.decisionId,
        declaredVersion,
      });
      expect(res.statusCode, declaredVersion).toBe(400);
      // NOT an NH-AX refusal: a malformed request is not a governed scheduling decision, and dressing it
      // as one would put a transport error into the execution vocabulary.
      expect(res.json().refusal, declaredVersion).toBeUndefined();
    }

    // REJECTED, not stripped-and-run: no execution appeared behind any of those four.
    const after = (await app.inject({ method: "GET", url: `/pilot/assessments?boundaryId=${a.boundaryId}`, headers: OPERATOR })).json();
    expect(after.length).toBe(before.length);
    expect(after.map((e: { executionId: string }) => e.executionId)).toEqual([ok.executionId]);
  });

  it("A2b · a HISTORICAL NULL-SNAPSHOT admission: same treatment, reported separately", async () => {
    // THE SECOND POPULATION, run and reported on its own. The one that cannot be re-derived at all must
    // get exactly the same answer about caller-stated versions as the one that can — otherwise the field
    // would still be a probe into which population a dataset belongs to.
    const legacy = await builtRow({
      snapshotDateLocale: null,
      snapshotAmountFormat: null,
      snapshotTermsId: null,
      snapshotTermsVersion: null,
    });

    // 1 · the LEGACY DISCOVERY path, the only one this row can be scheduled on, still schedules it.
    const ok = (
      await schedule({ boundaryId: legacy.boundaryId, datasetId: legacy.datasetId, csvText: legacy.csvText })
    ).json();
    expect(ok.refusal, JSON.stringify(ok.refusalDetail)).toBeNull();
    expect(ok.scheduled).toBe(true);

    // 2 · the cited path still refuses it as legacy, with the snapshot gate's own code.
    const cited = (
      await schedule({
        boundaryId: legacy.boundaryId,
        datasetId: legacy.datasetId,
        csvText: legacy.csvText,
        admissionDecisionId: legacy.admissionDecisionId,
      })
    ).json();
    expect(cited.scheduled).toBe(false);
    expect(cited.refusal.code).toBe("NH-AX-1011");

    // 3 · and an injected `declaredVersion` is rejected on BOTH, identically, leaving nothing behind.
    const before = (await app.inject({ method: "GET", url: `/pilot/assessments?boundaryId=${legacy.boundaryId}`, headers: OPERATOR })).json();
    for (const declaredVersion of [PILOT_DATA_CONTRACT_VERSION, "1.0.0", "9.9.9", "not-a-version"]) {
      for (const cite of [false, true]) {
        const res = await schedule({
          boundaryId: legacy.boundaryId,
          datasetId: legacy.datasetId,
          csvText: legacy.csvText,
          ...(cite ? { admissionDecisionId: legacy.admissionDecisionId } : {}),
          declaredVersion,
        });
        expect(res.statusCode, `${declaredVersion}/${cite}`).toBe(400);
      }
    }
    const after = (await app.inject({ method: "GET", url: `/pilot/assessments?boundaryId=${legacy.boundaryId}`, headers: OPERATOR })).json();
    expect(after.length).toBe(before.length);
  });

  it("A5 · a PREVIOUS-MAJOR admission is reachable BY REFERENCE and unreachable by discovery", async () => {
    // §10's two-major promise, finally operable at schedule time. The discovery key embeds THIS build's
    // major, so a major-1 admission could never be found however generous the support declarations were —
    // S3's ceiling registry was guarding a door nobody could reach. Citing the decision reaches it, and
    // the re-derivation then has to use the admitted major or it would refuse valid, unchanged data.
    const previous = await builtRow({ contractVersion: "1.1.0", declaredVersion: "1.1.0" });

    const cited = (
      await schedule({
        boundaryId: previous.boundaryId,
        datasetId: previous.datasetId,
        csvText: previous.csvText,
        admissionDecisionId: previous.admissionDecisionId,
      })
    ).json();
    expect(cited.refusal, JSON.stringify(cited.refusalDetail)).toBeNull();
    expect(cited.scheduled).toBe(true);

    const discovered = (
      await schedule({ boundaryId: previous.boundaryId, datasetId: previous.datasetId, csvText: previous.csvText })
    ).json();
    expect(discovered.scheduled).toBe(false);
    expect(discovered.refusal.code).toBe("NH-AX-1001");

    // ...and the CEILING still binds, through the new path, without touching the registry: 1.2.0 is above
    // the declared `maxSupportedVersion` of 1.1.0, so support refuses it where identity did not.
    const aboveCeiling = await builtRow({ contractVersion: "1.2.0", declaredVersion: "1.2.0" });
    const refused = (
      await schedule({
        boundaryId: aboveCeiling.boundaryId,
        datasetId: aboveCeiling.datasetId,
        csvText: aboveCeiling.csvText,
        admissionDecisionId: aboveCeiling.admissionDecisionId,
      })
    ).json();
    expect(refused.scheduled).toBe(false);
    expect(refused.refusal.code).toBe("NH-AX-1006");
  });

  it("A3 · a decision identifier from ANOTHER boundary reads as absent, never as someone else's record", async () => {
    const mine = await admitted();
    const theirs = await admitted();
    const out = (
      await schedule({
        boundaryId: mine.boundaryId,
        datasetId: mine.datasetId,
        csvText: mine.csvText,
        admissionDecisionId: theirs.decisionId,
      })
    ).json();
    expect(out.scheduled).toBe(false);
    expect(out.refusal.code).toBe("NH-AX-1001");
    // The refusal must not disclose that the identifier exists elsewhere.
    expect(out.refusalDetail).not.toContain(theirs.boundaryId);
  });

  it("A4 · a correct reference with the WRONG BYTES is refused on the bytes, not on the reference", async () => {
    const a = await admitted();
    const out = (
      await schedule({
        boundaryId: a.boundaryId,
        datasetId: a.datasetId,
        csvText: syntheticPilotCsv(41),
        admissionDecisionId: a.decisionId,
      })
    ).json();
    expect(out.scheduled).toBe(false);
    expect(out.refusal.code).toBe("NH-AX-1004");
  });

  // ── B · the record answers; the request may not override it ──────────────────────────────────────

  it("B1 · saying nothing is allowed and the record supplies it — including a locale discovery cannot reach", async () => {
    // Admitted with the date locale PINNED. On the discovery path the key is derived over the request's
    // locale, so a schedule that omits it derives "auto", finds nothing, and is refused NH-AX-1001.
    // Citing the reference reads "MDY" from the record and executes under it. This is what reference-first
    // BUYS, stated as a difference in outcome rather than as an intention.
    const a = await admitted({ locale: "MDY" });
    const row = await prisma.pilotDatasetSubmissionRecord.findFirstOrThrow({ where: { boundaryId: a.boundaryId } });
    expect(row.snapshotDateLocale).toBe("MDY");

    const silent = (
      await schedule({ boundaryId: a.boundaryId, datasetId: a.datasetId, csvText: a.csvText, admissionDecisionId: a.decisionId })
    ).json();
    expect(silent.refusal, JSON.stringify(silent.refusalDetail)).toBeNull();
    expect(silent.binding.interpretation.dateLocale).toBe("MDY");

    const citingTheSame = (
      await schedule({
        boundaryId: a.boundaryId,
        datasetId: a.datasetId,
        csvText: a.csvText,
        admissionDecisionId: a.decisionId,
        locale: "MDY",
      })
    ).json();
    expect(citingTheSame.refusal, JSON.stringify(citingTheSame.refusalDetail)).toBeNull();
    expect(citingTheSame.executionId).toBe(silent.executionId);

    const discoveredWithoutIt = (
      await schedule({ boundaryId: a.boundaryId, datasetId: a.datasetId, csvText: a.csvText })
    ).json();
    expect(discoveredWithoutIt.scheduled).toBe(false);
    expect(discoveredWithoutIt.refusal.code).toBe("NH-AX-1001");
  });

  it("B2 · a request naming a DIFFERENT date locale or amount format is refused, not quietly overridden", async () => {
    // Running under the admitted locale and reporting success would hand back a result nobody asked for.
    const a = await admitted();
    for (const [field, value] of [["locale", "MDY"], ["amountFormat", "EU"]] as const) {
      const out = (
        await schedule({
          boundaryId: a.boundaryId,
          datasetId: a.datasetId,
          csvText: a.csvText,
          admissionDecisionId: a.decisionId,
          [field]: value,
        })
      ).json();
      expect(out.scheduled, field).toBe(false);
      expect(out.refusal.code, field).toBe("NH-AX-1013");
      // The detail names the ADMITTED value only. A refusal must not reflect the request's own strings.
      expect(out.refusalDetail).toContain("auto");
      expect(out.refusalDetail).not.toContain(value);
    }
  });

  it("B3 · a request naming a different ANALYSIS-TERMS version is refused even when that version is ACTIVE", async () => {
    // The constitution's own consequence, made operative: "an extract re-read under new governed terms
    // must be re-submitted, because the admission decision is looked up by the same identity". A second
    // legitimately governed definition is not a licence to re-read an old verdict under it.
    const a = await admitted();
    await ensureGovernedTerms(a.boundaryId, { termsVersion: "2.0.0", asOf: "2026-05-15" });
    const out = (
      await schedule({
        boundaryId: a.boundaryId,
        datasetId: a.datasetId,
        csvText: a.csvText,
        admissionDecisionId: a.decisionId,
        analysisTermsVersion: "2.0.0",
      })
    ).json();
    expect(out.scheduled).toBe(false);
    expect(out.refusal.code).toBe("NH-AX-1013");
    expect(out.refusalDetail).toContain(TEST_ANALYSIS_TERMS.termsVersion);

    // POSITIVE CONTROL: the same request citing the ADMITTED version schedules.
    const ok = (
      await schedule({
        boundaryId: a.boundaryId,
        datasetId: a.datasetId,
        csvText: a.csvText,
        admissionDecisionId: a.decisionId,
        analysisTermsVersion: TEST_ANALYSIS_TERMS.termsVersion,
      })
    ).json();
    expect(ok.refusal, JSON.stringify(ok.refusalDetail)).toBeNull();
  });

  it("B4 · the ADMITTED terms are re-checked for governance NOW, on the authoritative path too", async () => {
    // A frozen definition is a deliberate pause. Reading it from the record must not become a way past
    // it: the register is consulted for GOVERNANCE, not merely for values.
    const a = await admitted();
    await appendAnalysisTermsEvent({
      boundaryId: a.boundaryId,
      termsId: TEST_ANALYSIS_TERMS.termsId,
      termsVersion: TEST_ANALYSIS_TERMS.termsVersion,
      transition: "FROZEN",
      actorId: STEWARD["x-actor-id"],
      actorRole: "steward",
      rationale: "paused for review",
    });
    const out = (
      await schedule({ boundaryId: a.boundaryId, datasetId: a.datasetId, csvText: a.csvText, admissionDecisionId: a.decisionId })
    ).json();
    expect(out.scheduled).toBe(false);
    expect(out.refusal.code).toBe("NH-AX-1010");
  });

  // ── C · the stored identity must reproduce from the record's own facts ───────────────────────────

  it("C1 · POSITIVE CONTROL · a constructed row built honestly schedules by reference", async () => {
    // Without this, every C-case would prove only that a hand-built row cannot be scheduled.
    const built = await builtRow();
    const out = (
      await schedule({
        boundaryId: built.boundaryId,
        datasetId: built.datasetId,
        csvText: built.csvText,
        admissionDecisionId: built.admissionDecisionId,
      })
    ).json();
    expect(out.refusal, JSON.stringify(out.refusalDetail)).toBeNull();
    expect(out.scheduled).toBe(true);
  });

  it("C2 · a stored submission key that does not re-derive from the record is refused NH-AX-1012", async () => {
    // Modelled by insertion because the table forbids UPDATE. The decision id is derived over the
    // SUBSTITUTED key, so the record still hashes to its own identifier — NH-AX-1005 does not fire, and
    // this is the gap NH-AX-1012 exists to close.
    const built = await builtRow({ idempotencyKey: `pds_${hex64()}` });
    expect(built.idempotencyKey).not.toBe(built.honestKey);
    const out = (
      await schedule({
        boundaryId: built.boundaryId,
        datasetId: built.datasetId,
        csvText: built.csvText,
        admissionDecisionId: built.admissionDecisionId,
      })
    ).json();
    expect(out.scheduled).toBe(false);
    expect(out.refusal.code).toBe("NH-AX-1012");
    // NOT reported as the record having changed — that is a different, stronger accusation.
    expect(out.refusal.code).not.toBe("NH-AX-1005");
  });

  it("C3 · a snapshot that is PRESENT but not what the key was derived under is refused NH-AX-1012", async () => {
    // S4a's falsifier, now enforced at the point of use: the columns must be FAITHFUL, not merely
    // populated. A snapshot anybody could write would make the whole re-derivation ceremonial.
    const built = await builtRow({ snapshotDateLocale: "DMY" });
    const out = (
      await schedule({
        boundaryId: built.boundaryId,
        datasetId: built.datasetId,
        csvText: built.csvText,
        admissionDecisionId: built.admissionDecisionId,
        locale: "DMY",
      })
    ).json();
    expect(out.scheduled).toBe(false);
    expect(out.refusal.code).toBe("NH-AX-1012");
  });

  it("C4 · a record that does not hash to its own identifier still fails NH-AX-1005, first", async () => {
    const built = await builtRow({ admissionDecisionId: `PAD-${hex64().slice(0, 32)}` });
    const out = (
      await schedule({
        boundaryId: built.boundaryId,
        datasetId: built.datasetId,
        csvText: built.csvText,
        admissionDecisionId: built.admissionDecisionId,
      })
    ).json();
    expect(out.scheduled).toBe(false);
    expect(out.refusal.code).toBe("NH-AX-1005");
  });

  it("C5 · the re-derivation reads STORED facts only — a governed register value cannot be swapped for it", async () => {
    // Independent arithmetic rather than another round trip: the honest key must be reproducible from
    // the row's own four snapshot columns plus the register, and must NOT be reproducible from any other
    // governed definition's values. If it were, "re-derived from admitted facts" would not pin anything.
    const built = await builtRow();
    const row = await prisma.pilotDatasetSubmissionRecord.findFirstOrThrow({
      where: { boundaryId: built.boundaryId },
    });
    const fromRecord = await deriveIdempotencyKey({
      boundary: { boundaryId: row.boundaryId, datasetId: row.datasetId },
      datasetFingerprint: row.datasetFingerprint,
      dateLocale: row.snapshotDateLocale!,
      amountFormat: row.snapshotAmountFormat!,
      asOf: TEST_ANALYSIS_TERMS.asOf,
      stallThresholdDays: TEST_ANALYSIS_TERMS.stallThresholdDays,
      currency: TEST_ANALYSIS_TERMS.currency,
    });
    expect(fromRecord).toBe(row.idempotencyKey);
    const underOtherTerms = await deriveIdempotencyKey({
      boundary: { boundaryId: row.boundaryId, datasetId: row.datasetId },
      datasetFingerprint: row.datasetFingerprint,
      dateLocale: row.snapshotDateLocale!,
      amountFormat: row.snapshotAmountFormat!,
      asOf: "2026-05-15",
      stallThresholdDays: TEST_ANALYSIS_TERMS.stallThresholdDays,
      currency: TEST_ANALYSIS_TERMS.currency,
    });
    expect(underOtherTerms).not.toBe(row.idempotencyKey);
  });

  // ── D · the snapshot gate ────────────────────────────────────────────────────────────────────────

  it("D1 · a PRE-SNAPSHOT admission still schedules by discovery, and is REFUSED by reference", async () => {
    // The honest asymmetry. Failing these closed on both paths would have broken scheduling for every
    // dataset already admitted — a destructive change, not a tightening. But a cited reference asks for
    // the authoritative path explicitly, and that promise cannot be kept for a row with nothing recorded:
    // approximating a snapshot from today's request would assert that today's claims are what the verdict
    // was reached under, which is the one thing it cannot evidence.
    const built = await builtRow({
      snapshotDateLocale: null,
      snapshotAmountFormat: null,
      snapshotTermsId: null,
      snapshotTermsVersion: null,
    });
    const legacy = (
      await schedule({ boundaryId: built.boundaryId, datasetId: built.datasetId, csvText: built.csvText })
    ).json();
    expect(legacy.refusal, JSON.stringify(legacy.refusalDetail)).toBeNull();
    expect(legacy.scheduled).toBe(true);

    const cited = (
      await schedule({
        boundaryId: built.boundaryId,
        datasetId: built.datasetId,
        csvText: built.csvText,
        admissionDecisionId: built.admissionDecisionId,
      })
    ).json();
    expect(cited.scheduled).toBe(false);
    expect(cited.refusal.code).toBe("NH-AX-1011");
    expect(cited.refusalDetail).toContain("predates");
  });

  it("D2 · a PARTLY recorded snapshot fails closed on BOTH paths — a defect is not a schema epoch", async () => {
    const built = await builtRow({ snapshotTermsVersion: null });
    for (const cite of [false, true]) {
      const out = (
        await schedule({
          boundaryId: built.boundaryId,
          datasetId: built.datasetId,
          csvText: built.csvText,
          ...(cite ? { admissionDecisionId: built.admissionDecisionId } : {}),
        })
      ).json();
      expect(out.scheduled, String(cite)).toBe(false);
      expect(out.refusal.code, String(cite)).toBe("NH-AX-1011");
      expect(out.refusalDetail).toContain("partly recorded");
    }
  });

  it("D3 · a snapshot naming an option this build cannot interpret fails closed on both paths", async () => {
    // The digest would still be reproducible from the stored string, but the file could not actually be
    // READ that way — and claiming to have executed under an interpretation the build cannot perform is
    // worse than refusing.
    const built = await builtRow({ snapshotAmountFormat: "GB" });
    for (const cite of [false, true]) {
      const out = (
        await schedule({
          boundaryId: built.boundaryId,
          datasetId: built.datasetId,
          csvText: built.csvText,
          ...(cite ? { admissionDecisionId: built.admissionDecisionId } : {}),
        })
      ).json();
      expect(out.scheduled, String(cite)).toBe(false);
      expect(out.refusal.code, String(cite)).toBe("NH-AX-1011");
      expect(out.refusalDetail).toContain("cannot interpret");
    }
  });

  it("D5 · the LEGACY path makes no claim of pds re-derivation, and the difference is observable", async () => {
    // THE HONEST LIMIT, as evidence rather than as prose. A substituted stored key is DETECTED on a
    // snapshot-bearing row (C2 · NH-AX-1012) and is UNDETECTABLE on a NULL-snapshot row — because there
    // the key IS the address, so a wrong key is simply an address nothing lives at. The refusal is
    // therefore NH-AX-1001 "no admission decision exists for these bytes", never NH-AX-1012, and the
    // system does not pretend to have checked something it could not check.
    const legacy = await builtRow({
      idempotencyKey: `pds_${hex64()}`,
      snapshotDateLocale: null,
      snapshotAmountFormat: null,
      snapshotTermsId: null,
      snapshotTermsVersion: null,
    });
    const discovered = (
      await schedule({ boundaryId: legacy.boundaryId, datasetId: legacy.datasetId, csvText: legacy.csvText })
    ).json();
    expect(discovered.scheduled).toBe(false);
    expect(discovered.refusal.code).toBe("NH-AX-1001");
    expect(discovered.refusal.code).not.toBe("NH-AX-1012");

    // Citing it does not launder the gap either: the snapshot gate fires first and says exactly why.
    const cited = (
      await schedule({
        boundaryId: legacy.boundaryId,
        datasetId: legacy.datasetId,
        csvText: legacy.csvText,
        admissionDecisionId: legacy.admissionDecisionId,
      })
    ).json();
    expect(cited.scheduled).toBe(false);
    expect(cited.refusal.code).toBe("NH-AX-1011");
  });

  it("D4 · the intake returns the decision identifier, and only for a dataset it actually recorded", async () => {
    // Reference-first is unreachable if the reference is not handed back. And it must be null, never a
    // placeholder, when nothing was written: a schedule citing an invented identifier would be refused
    // for the wrong reason and send someone looking for a record that never existed.
    const a = await admitted();
    expect(a.body.admissionDecisionId).toMatch(/^PAD-[0-9a-f]{32}$/);
    expect(a.body.recordedAt).not.toBeNull();

    const boundaryId = `pb-${uid()}`;
    await ensureGovernedTerms(boundaryId);
    const refused = await app.inject({
      method: "POST",
      url: "/pilot/datasets",
      headers: OPERATOR,
      payload: {
        boundaryId,
        datasetId: `ds-${uid()}`,
        declaredVersion: PILOT_DATA_CONTRACT_VERSION,
        csvText: "entity_id,signed_at\n",
        provenance: SYNTHETIC_PROVENANCE,
        ...GOVERNED_TERMS_FIELDS,
      },
    });
    expect(refused.statusCode).toBe(200);
    expect(refused.json().usableForAssessment).toBe(false);
    expect(refused.json().admissionDecisionId).toBeNull();
    expect(refused.json().recordedAt).toBeNull();
  });
});

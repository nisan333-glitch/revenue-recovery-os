// The analysis-terms register, brought to the same audit visibility as the admission register.
//
// WHAT IT ALREADY HAD. `resolveGovernedAnalysisTerms` verified the terms hash on every resolve and
// refused rather than recomputing — the pattern the admission-policy work was modelled on. That covers
// USE, which is the most important case and the one that was already right.
//
// WHAT IT DID NOT HAVE, and now does:
//   • AUDIT VISIBILITY. The governance read returned a `termsHash` and a lifecycle without saying
//     whether the row still hashes to its own values. A suspect definition read as sound.
//   • A REFUSAL ON PUTTING ONE IN FORCE. A row that fails its own witness could still be ACTIVATED.
//
// WHAT WAS DELIBERATELY NOT ADDED. No blanket refusals for symmetry. The list surface is unchanged, and
// FREEZE and RETIRE remain available on a suspect row — refusing those would leave governance unable to
// stop the thing it had just found, which is the opposite of the point.
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { buildApp } from "../app";
import { prisma } from "../db";
import { fixtureVerifier } from "../test/sourceFixture";
import { makeAnalysisTerms, hashAnalysisTerms } from "../../src/contract/analysisTerms";
import { TEST_ANALYSIS_TERMS } from "../test/governedTerms";

const HAS_DB = !!process.env.DATABASE_URL;
const STEWARD = { "x-actor-id": "gov@company", "x-actor-role": "steward" };
const uid = () => Math.random().toString(36).slice(2, 10);

describe.skipIf(!HAS_DB)("the analysis-terms register states its own integrity", () => {
  const app = buildApp({ sourceVerifier: fixtureVerifier });
  beforeAll(async () => {
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  /**
   * Write a terms row directly, with a witness that may or may not match its values.
   *
   * The table is append-only, so a tampered row is MODELLED by insertion — the shape a migration that
   * edited the row would leave behind: values that moved, a witness that did not.
   */
  async function termsRow(opts: {
    readonly boundaryId: string;
    readonly witnessOf?: Record<string, unknown>;
    readonly activate?: boolean;
  }) {
    const termsId = `terms-${uid()}`;
    const actual = makeAnalysisTerms({ ...TEST_ANALYSIS_TERMS, termsId });
    const witnessed = makeAnalysisTerms({ ...TEST_ANALYSIS_TERMS, termsId, ...(opts.witnessOf ?? {}) } as never);
    await prisma.pilotAnalysisTermsRecord.create({
      data: {
        boundaryId: opts.boundaryId,
        termsId,
        termsVersion: actual.termsVersion,
        asOf: actual.asOf,
        stallThresholdDays: actual.stallThresholdDays,
        currency: actual.currency,
        calculationMethodVersion: actual.calculationMethodVersion,
        termsHash: await hashAnalysisTerms(witnessed),
        registeredByActorId: "constructed@company",
        registeredByRole: "operator",
      },
    });
    // PROPOSED always, so the row is DRAFT and the lifecycle permits activation — without it a 409
    // would be attributable to "cannot move from no state" and would prove nothing about the hash.
    const events: readonly [string, string, string][] = opts.activate
      ? [["PROPOSED", "constructed@company", "operator"], ["ACTIVATED", STEWARD["x-actor-id"], "steward"]]
      : [["PROPOSED", "constructed@company", "operator"]];
    for (const [transition, actorId, actorRole] of events) {
      await prisma.pilotAnalysisTermsEventRecord.create({
        data: {
          id: `PTE-${Date.now()}-${uid()}`,
          boundaryId: opts.boundaryId,
          termsId,
          termsVersion: actual.termsVersion,
          transition,
          actorId,
          actorRole,
          rationale: "constructed fixture",
        },
      });
    }
    return { termsId, storedHash: await hashAnalysisTerms(witnessed) };
  }

  const readGovernance = (boundaryId: string, termsId: string) =>
    app.inject({
      method: "GET",
      url: `/pilot/analysis-terms/governance?boundaryId=${encodeURIComponent(boundaryId)}&termsId=${encodeURIComponent(termsId)}&termsVersion=1.0.0`,
      headers: STEWARD,
    });

  const move = (boundaryId: string, termsId: string, path: string) =>
    app.inject({
      method: "POST",
      url: `/pilot/analysis-terms/${path}`,
      headers: STEWARD,
      payload: { boundaryId, termsId, termsVersion: "1.0.0", rationale: "governance act" },
    });

  it("1 · POSITIVE CONTROL · a sound row reports INTACT and activates", async () => {
    const boundaryId = `pb-${uid()}`;
    const { termsId } = await termsRow({ boundaryId });
    const view = (await readGovernance(boundaryId, termsId)).json();
    expect(view.integrity.status).toBe("INTACT");
    expect(view.integrity.computedHash).toBe(view.integrity.storedHash);
    expect(view.integrity.storedHash).toBe(view.termsHash);
    expect((await move(boundaryId, termsId, "activate")).statusCode).toBe(200);
  });

  it("2 · a tampered row is INSPECTABLE, with its integrity stated and both hashes", async () => {
    const boundaryId = `pb-${uid()}`;
    const { termsId } = await termsRow({ boundaryId, witnessOf: { stallThresholdDays: 999 }, activate: true });
    const res = await readGovernance(boundaryId, termsId);
    expect(res.statusCode).toBe(200);
    const view = res.json();
    expect(view.integrity.status).toBe("MISMATCH");
    expect(view.integrity.computedHash).not.toBe(view.integrity.storedHash);
    expect(view.integrity.detail).toMatch(/changed after it was registered/);
    // The lifecycle is visible: that a tampered definition is ACTIVE is the fact that makes it urgent.
    expect(view.state).toBe("ACTIVE");
  });

  it("3 · a tampered row cannot be PUT IN FORCE", async () => {
    const boundaryId = `pb-${uid()}`;
    const { termsId } = await termsRow({ boundaryId, witnessOf: { asOf: "2026-01-01" } });
    const res = await move(boundaryId, termsId, "activate");
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/no longer hash to the definition/);
    expect(
      await prisma.pilotAnalysisTermsEventRecord.count({ where: { boundaryId, transition: "ACTIVATED" } }),
    ).toBe(0);
  });

  it("4 · but FREEZE and RETIRE still work — stopping it must never be blocked", async () => {
    const boundaryId = `pb-${uid()}`;
    const { termsId } = await termsRow({ boundaryId, witnessOf: { currency: "EUR" }, activate: true });
    expect((await move(boundaryId, termsId, "freeze")).statusCode).toBe(200);
    // UNFREEZE would put it back in force, so it is refused.
    expect((await move(boundaryId, termsId, "unfreeze")).statusCode).toBe(409);
    expect((await move(boundaryId, termsId, "retire")).statusCode).toBe(200);
  });

  it("5 · and it still measures NOTHING — the resolve refusal that already existed is untouched", async () => {
    // The most important property, and the one this register already had. Re-proved here so the new
    // visibility can never be mistaken for having relaxed it.
    const boundaryId = `pb-${uid()}`;
    const { termsId } = await termsRow({ boundaryId, witnessOf: { stallThresholdDays: 77 }, activate: true });
    const res = await app.inject({
      method: "POST",
      url: "/pilot/assessments",
      headers: { "x-actor-id": "pilot-operator@company", "x-actor-role": "operator" },
      payload: {
        boundaryId,
        datasetId: `ds-${uid()}`,
        csvText: "entity_id,signed_at\nE1,2026-01-01\n",
        provenance: {
          sourceSystems: { contract: "c", billing: "b", product: "p" },
          dataOwnerRole: "ops", extractionMethod: "manual", extractedAt: "2026-04-01",
          coverageStart: "2026-01-01", coverageEnd: "2026-03-31",
          assertedIndependentOfBeneficiary: true,
        },
        analysisTermsId: termsId,
        analysisTermsVersion: "1.0.0",
      },
    });
    expect(res.json().refusal.code).toBe("NH-AX-1010");
    expect(res.json().refusalDetail).toMatch(/no longer hash to the definition they were registered with/);
  });
});

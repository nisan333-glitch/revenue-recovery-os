// EP-26 · Analysis-terms governance — the invariant, proved end to end through the real HTTP surface.
//
// THE INVARIANT UNDER TEST, stated once so every assertion below can be read against it:
//
//   An assessment's `asOf` and `stallThresholdDays` are never chosen by the requester. They are read
//   from an ACTIVE registered version whose proposal and activation are two different identities, each
//   recorded append-only with a stated reason. A change to either value is a new version with its own
//   proposal and activation; it yields a NEW execution identity and can never re-grade a finding that
//   already exists. No request may carry either value.
//
// The last sentence is what makes the rest true rather than merely intended, and test 5 is where it is
// measured: the transport itself rejects the two fields, so there is no channel through which a cut-off
// can be chosen — not a guard that could be forgotten at one call site.
//
// Every test drives app.inject → Fastify → schema → service → PostgreSQL. Nothing is stubbed.
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { buildApp } from "../app";
import { prisma } from "../db";
import { fixtureVerifier } from "../test/sourceFixture";
import { SYNTHETIC_PROVENANCE, syntheticPilotCsv } from "../../src/contract/syntheticPilotDataset";
import { PILOT_DATA_CONTRACT_VERSION } from "../../src/contract/pilotDataContract";
import { ADMISSION_CALC_VERSION } from "../../src/contract/pilotAdmissionPolicy";
import { SCENARIO_POLICY } from "../../src/contract/syntheticPilotDataset";
import { hashAnalysisTerms, makeAnalysisTerms } from "../../src/contract/analysisTerms";
import { proposeAnalysisTerms } from "./pilotAnalysisTermsService";

const HAS_DB = !!process.env.DATABASE_URL;

// Two identities and two roles. The separation is enforced on the ACTOR ID, so a test that used one
// id with two roles would prove nothing about who may do what.
const OPERATOR = { "x-actor-id": "pilot-operator@company", "x-actor-role": "operator" };
const OTHER_OPERATOR = { "x-actor-id": "second-operator@company", "x-actor-role": "operator" };
const STEWARD = { "x-actor-id": "gov@company", "x-actor-role": "steward" };
const APPROVER = { "x-actor-id": "cfo@company", "x-actor-role": "approver" };

const uid = () => Math.random().toString(36).slice(2, 10);
const TERMS = { termsId: "terms-q2", termsVersion: "1.0.0", asOf: "2026-04-15", stallThresholdDays: 30 };

describe.skipIf(!HAS_DB)("EP-26 · the cut-off and the stall definition are governed, not chosen", () => {
  const app = buildApp({ sourceVerifier: fixtureVerifier });
  beforeAll(async () => {
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const propose = (boundaryId: string, terms = TERMS, headers = OPERATOR, rationale = "quarter close") =>
    app.inject({
      method: "POST",
      url: "/pilot/analysis-terms",
      headers,
      payload: { boundaryId, terms, rationale },
    });

  const move = (
    path: string,
    boundaryId: string,
    headers = STEWARD,
    terms = TERMS,
    rationale = "reviewed",
  ) =>
    app.inject({
      method: "POST",
      url: `/pilot/analysis-terms/${path}`,
      headers,
      payload: { boundaryId, termsId: terms.termsId, termsVersion: terms.termsVersion, rationale },
    });

  /** Propose as one identity, activate as another. The honest two-step, used as a fixture below. */
  async function governedBoundary(terms = TERMS) {
    const boundaryId = `pb-${uid()}`;
    expect((await propose(boundaryId, terms)).statusCode).toBe(201);
    expect((await move("activate", boundaryId, STEWARD, terms)).statusCode).toBe(200);
    return boundaryId;
  }

  /** An ACTIVE admission bar, so an intake refusal can only be about the analysis terms. */
  async function withAdmissionBar(boundaryId: string) {
    const policyId = `pol-${uid()}`;
    const policy = {
      policyId,
      policyVersion: "1.0.0",
      calculationMethodVersion: ADMISSION_CALC_VERSION,
      ...SCENARIO_POLICY,
      requiredLifecycleStates: [...SCENARIO_POLICY.requiredLifecycleStates],
    };
    expect(
      (await app.inject({
        method: "POST",
        url: "/pilot/admission-policies",
        headers: OPERATOR,
        payload: { boundaryId, policy, rationale: "fixture" },
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

  const datasetBody = (boundaryId: string, over: Record<string, unknown> = {}) => ({
    boundaryId,
    datasetId: `ds-${uid()}`,
    declaredVersion: PILOT_DATA_CONTRACT_VERSION,
    csvText: syntheticPilotCsv(40),
    policy: { currency: "USD" },
    provenance: SYNTHETIC_PROVENANCE,
    ...over,
  });

  const submit = (payload: unknown, headers = OPERATOR) =>
    app.inject({ method: "POST", url: "/pilot/datasets", headers, payload: payload as object });

  const schedule = (payload: unknown, headers = OPERATOR) =>
    app.inject({ method: "POST", url: "/pilot/assessments", headers, payload: payload as object });

  // ── The lifecycle ───────────────────────────────────────────────────────────────────────────────

  it("1 · a proposal is a DRAFT, and a draft measures nothing", async () => {
    const boundaryId = `pb-${uid()}`;
    const proposed = await propose(boundaryId);
    expect(proposed.statusCode).toBe(201);
    expect(proposed.json().state).toBe("DRAFT");
    expect(proposed.json().termsRef).toBe("terms-q2@1.0.0");
    expect(proposed.json().termsHash).toMatch(/^sha256:[0-9a-f]{64}$/);

    await withAdmissionBar(boundaryId);
    const refused = await submit(
      datasetBody(boundaryId, { analysisTermsId: TERMS.termsId, analysisTermsVersion: TERMS.termsVersion }),
    );
    expect(refused.statusCode).toBe(403);
    // Refused for the RIGHT reason, and it names the state — "draft" and "never existed" are different
    // answers and a reader must be able to tell which one they got.
    expect(refused.json().message).toContain("analysis terms are not governed");
    expect(refused.json().message).toMatch(/draft/i);
  });

  it("2 · activation by a DIFFERENT identity puts it in force, and then the dataset is measured", async () => {
    const boundaryId = await governedBoundary();
    await withAdmissionBar(boundaryId);
    const accepted = await submit(
      datasetBody(boundaryId, { analysisTermsId: TERMS.termsId, analysisTermsVersion: TERMS.termsVersion }),
    );
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().accepted).toBe(true);

    // The governed read shows the two halves as two identities. This is the whole point, so it is
    // asserted from the server's own lifecycle log rather than from what the caller sent.
    const governance = await app.inject({
      method: "GET",
      url: `/pilot/analysis-terms/governance?boundaryId=${boundaryId}&termsId=${TERMS.termsId}&termsVersion=1.0.0`,
      headers: STEWARD,
    });
    expect(governance.statusCode).toBe(200);
    const view = governance.json();
    expect(view.state).toBe("ACTIVE");
    expect(view.asOf).toBe("2026-04-15");
    expect(view.stallThresholdDays).toBe(30);
    expect(view.proposedBy).toBe(OPERATOR["x-actor-id"]);
    expect(view.activatedBy).toBe(STEWARD["x-actor-id"]);
    expect(view.proposedBy).not.toBe(view.activatedBy);
    expect(view.events.map((e: { transition: string }) => e.transition)).toEqual(["PROPOSED", "ACTIVATED"]);
    // A governance decision with no stated reason is not one.
    for (const e of view.events) expect(e.rationale.trim().length).toBeGreaterThan(0);
  });

  it("3 · the actor who proposed a definition cannot be the one who puts it in force", async () => {
    const boundaryId = `pb-${uid()}`;
    expect((await propose(boundaryId)).statusCode).toBe(201);
    // Same actor id, wearing the steward role. Role alone is not the guard.
    const selfActivate = await move("activate", boundaryId, {
      "x-actor-id": OPERATOR["x-actor-id"],
      "x-actor-role": "steward",
    });
    expect(selfActivate.statusCode).toBe(403);
    expect(selfActivate.json().message).toMatch(/separation of duties/i);

    // And it is still a draft afterwards — the refusal did not half-apply.
    const stillDraft = await app.inject({
      method: "GET",
      url: `/pilot/analysis-terms/governance?boundaryId=${boundaryId}&termsId=${TERMS.termsId}&termsVersion=1.0.0`,
      headers: STEWARD,
    });
    expect(stillDraft.json().state).toBe("DRAFT");
  });

  it("4 · naming NO definition is refused — there is no default cut-off", async () => {
    const boundaryId = await governedBoundary();
    await withAdmissionBar(boundaryId);

    // The transport permits the fields to be absent; the SERVICE refuses. Two gates, and this is the
    // inner one: absence must not read as "use whatever".
    const intake = await submit(datasetBody(boundaryId));
    expect(intake.statusCode).toBe(403);
    expect(intake.json().message).toContain("analysis terms are not governed");
    expect(intake.json().message).toMatch(/no analysis-terms version was named/);

    const sched = await schedule(datasetBody(boundaryId));
    expect(sched.statusCode).toBe(200); // a refusal is a valid answer on this endpoint
    expect(sched.json().scheduled).toBe(false);
    expect(sched.json().refusal.code).toBe("NH-AX-1010");
  });

  it("5 · THE VALUES CANNOT BE SENT AT ALL — the transport rejects them", async () => {
    // This is the load-bearing test. Everything else guards a path; this proves there is no path.
    // If `additionalProperties: false` were ever relaxed on `policy`, a requester could state the
    // cut-off again and every assertion above would still pass.
    const boundaryId = await governedBoundary();
    for (const smuggled of [
      { stallThresholdDays: 1 },
      { asOf: "2020-01-01" },
      { stallThresholdDays: 0, asOf: "2099-12-31" },
    ]) {
      for (const url of ["/pilot/datasets", "/pilot/assessments"]) {
        const res = await app.inject({
          method: "POST",
          url,
          headers: OPERATOR,
          payload: {
            ...datasetBody(boundaryId, {
              analysisTermsId: TERMS.termsId,
              analysisTermsVersion: TERMS.termsVersion,
            }),
            policy: { currency: "USD", ...smuggled },
          },
        });
        expect(res.statusCode, `${url} ${JSON.stringify(smuggled)}`).toBe(400);
        expect(JSON.stringify(res.json())).toMatch(/additional properties/i);
      }
    }
  });

  it("6 · a FROZEN definition measures nothing, and resuming restores it", async () => {
    const boundaryId = await governedBoundary();
    await withAdmissionBar(boundaryId);
    const cite = { analysisTermsId: TERMS.termsId, analysisTermsVersion: TERMS.termsVersion };

    expect((await move("freeze", boundaryId)).json().state).toBe("FROZEN");
    const frozen = await submit(datasetBody(boundaryId, cite));
    expect(frozen.statusCode).toBe(403);
    expect(frozen.json().message).toMatch(/frozen/i);

    const frozenSchedule = await schedule(datasetBody(boundaryId, cite));
    expect(frozenSchedule.json().refusal.code).toBe("NH-AX-1010");
    expect(frozenSchedule.json().refusalDetail).toMatch(/frozen/i);

    expect((await move("unfreeze", boundaryId)).json().state).toBe("ACTIVE");
    expect((await submit(datasetBody(boundaryId, cite))).statusCode).toBe(200);
  });

  it("7 · a RETIRED definition is over, and cannot be resumed", async () => {
    const boundaryId = await governedBoundary();
    await withAdmissionBar(boundaryId);
    expect((await move("retire", boundaryId)).json().state).toBe("RETIRED");

    const refused = await submit(
      datasetBody(boundaryId, { analysisTermsId: TERMS.termsId, analysisTermsVersion: TERMS.termsVersion }),
    );
    expect(refused.statusCode).toBe(403);
    expect(refused.json().message).toMatch(/retired/i);
    // Retirement is terminal: no transition brings it back.
    expect((await move("activate", boundaryId)).statusCode).toBe(409);
    expect((await move("unfreeze", boundaryId)).statusCode).toBe(409);
  });

  it("8 · another tenant's definition reads as absent, never as theirs to cite or to govern", async () => {
    const owner = await governedBoundary();
    const stranger = `pb-${uid()}`;
    await withAdmissionBar(stranger);

    // Citing the neighbour's id from another boundary: not "forbidden", not "theirs" — simply absent.
    const refused = await submit(
      datasetBody(stranger, { analysisTermsId: TERMS.termsId, analysisTermsVersion: TERMS.termsVersion }),
    );
    expect(refused.statusCode).toBe(403);
    expect(refused.json().message).toMatch(/no analysis-terms version .* exists for this boundary/);

    // And governing it from the wrong boundary is a 404, not a state change on the owner's version.
    expect((await move("freeze", stranger)).statusCode).toBe(404);
    const ownerState = await app.inject({
      method: "GET",
      url: `/pilot/analysis-terms/governance?boundaryId=${owner}&termsId=${TERMS.termsId}&termsVersion=1.0.0`,
      headers: STEWARD,
    });
    expect(ownerState.json().state).toBe("ACTIVE");
  });

  // ── The database's own answers ──────────────────────────────────────────────────────────────────

  it("9 · a re-proposed version is refused by the PRIMARY KEY, and the definition is not overwritten", async () => {
    const boundaryId = await governedBoundary();
    const second = await propose(
      boundaryId,
      { ...TERMS, asOf: "2026-09-30", stallThresholdDays: 90 },
      OTHER_OPERATOR,
      "trying to widen the window under the same version",
    );
    expect(second.statusCode).toBe(409);
    expect(second.json().message).toMatch(/already registered/);

    // The stored definition is untouched. Had the write been an upsert, an ACTIVE version's meaning
    // would have changed under a reference that had already been blessed.
    const row = await prisma.pilotAnalysisTermsRecord.findUniqueOrThrow({
      where: {
        boundaryId_termsId_termsVersion: {
          boundaryId,
          termsId: TERMS.termsId,
          termsVersion: TERMS.termsVersion,
        },
      },
    });
    expect(row.asOf).toBe("2026-04-15");
    expect(row.stallThresholdDays).toBe(30);
  });

  it("10 · the registered definition and its lifecycle log are append-only in the DATABASE", async () => {
    const boundaryId = await governedBoundary();
    // Not "the service does not offer an update" — the database refuses one. A future caller with a
    // Prisma client and good intentions still cannot redefine what a historical finding measured.
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE pilot_analysis_terms SET as_of = '2026-12-31' WHERE boundary_id = $1`,
        boundaryId,
      ),
    ).rejects.toThrow(/append-only/i);
    await expect(
      prisma.$executeRawUnsafe(`DELETE FROM pilot_analysis_terms WHERE boundary_id = $1`, boundaryId),
    ).rejects.toThrow(/append-only/i);
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE pilot_analysis_terms_events SET rationale = 'rewritten' WHERE boundary_id = $1`,
        boundaryId,
      ),
    ).rejects.toThrow(/append-only/i);
    await expect(
      prisma.$executeRawUnsafe(`DELETE FROM pilot_analysis_terms_events WHERE boundary_id = $1`, boundaryId),
    ).rejects.toThrow(/append-only/i);

    const row = await prisma.pilotAnalysisTermsRecord.findUniqueOrThrow({
      where: {
        boundaryId_termsId_termsVersion: {
          boundaryId,
          termsId: TERMS.termsId,
          termsVersion: TERMS.termsVersion,
        },
      },
    });
    expect(row.asOf).toBe("2026-04-15");
    expect(await prisma.pilotAnalysisTermsEventRecord.count({ where: { boundaryId } })).toBe(2);
  });

  it("11 · the DATABASE refuses a definition the domain would refuse", async () => {
    const boundaryId = `pb-${uid()}`;
    // Defence in depth: these never reach the constructor, so the CHECK constraints are what answer.
    for (const [asOf, days] of [
      ["30/06/2026", 30],
      ["2026-06-30", -1],
      ["2026-06-30", 4000],
    ] as const) {
      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO pilot_analysis_terms VALUES ($1,'t','1','${asOf}',${days},'m','sha256:x','a','operator',now())`,
          boundaryId,
        ),
      ).rejects.toThrow();
    }
    expect(await prisma.pilotAnalysisTermsRecord.count({ where: { boundaryId } })).toBe(0);
  });

  it("12 · a stored hash that no longer matches its definition refuses, rather than being recomputed", async () => {
    // The row is append-only, so this is inserted wrong from the start — standing in for a migration
    // or restore that changed a value without recomputing the witness.
    const boundaryId = `pb-${uid()}`;
    await prisma.$executeRawUnsafe(
      `INSERT INTO pilot_analysis_terms VALUES ($1,'terms-tampered','1.0.0','2026-04-15',30,'m','sha256:${"0".repeat(64)}','a','operator',now())`,
      boundaryId,
    );
    await prisma.pilotAnalysisTermsEventRecord.createMany({
      data: [
        { id: `x-${uid()}`, boundaryId, termsId: "terms-tampered", termsVersion: "1.0.0", transition: "PROPOSED", actorId: "a", actorRole: "operator", rationale: "r" },
        { id: `y-${uid()}`, boundaryId, termsId: "terms-tampered", termsVersion: "1.0.0", transition: "ACTIVATED", actorId: "b", actorRole: "steward", rationale: "r" },
      ],
    });
    await withAdmissionBar(boundaryId);

    const refused = await submit(
      datasetBody(boundaryId, { analysisTermsId: "terms-tampered", analysisTermsVersion: "1.0.0" }),
    );
    expect(refused.statusCode).toBe(403);
    expect(refused.json().message).toMatch(/no longer hash to the definition/);
    // ACTIVE and refused: the state is fine, the witness is not, and the witness wins.
    const view = await app.inject({
      method: "GET",
      url: `/pilot/analysis-terms/governance?boundaryId=${boundaryId}&termsId=terms-tampered&termsVersion=1.0.0`,
      headers: STEWARD,
    });
    expect(view.json().state).toBe("ACTIVE");
  });

  // ── What the invariant is actually for ─────────────────────────────────────────────────────────

  it("13 · a NEW definition yields a NEW execution and leaves the first finding exactly as it was", async () => {
    // "Cannot be changed after the outcome is known" does not mean an extract may be read only once.
    // It means a second reading is a second, separately governed, separately identified run — and the
    // first one is still there, still saying what it said.
    const boundaryId = await governedBoundary();
    const policyId = await withAdmissionBar(boundaryId);
    const csvText = syntheticPilotCsv(40);

    // ONE datasetId for both readings. The admission decision is keyed by the submission identity, and
    // a fresh label would derive a different key — so the second schedule would be refused for having
    // no admission decision, and the test would "pass" without ever exercising a second definition.
    const datasetId = `ds-${uid()}`;
    const firstBody = datasetBody(boundaryId, {
      datasetId,
      csvText,
      analysisTermsId: TERMS.termsId,
      analysisTermsVersion: TERMS.termsVersion,
    });
    expect((await submit({ ...firstBody, admissionPolicyId: policyId })).json().admission.outcome).toBe(
      "ADMISSIBLE",
    );
    const firstRun = (await schedule(firstBody)).json();
    expect(firstRun.scheduled).toBe(true);
    const firstId = firstRun.executionId;
    expect(firstRun.binding.assessmentPolicy.asOf).toBe("2026-04-15");
    expect(firstRun.binding.assessmentPolicy.stallThresholdDays).toBe(30);
    // The latent hook is filled: the binding's assessment policy identity IS the governed reference.
    expect(firstRun.binding.assessmentPolicy.policyId).toBe(TERMS.termsId);
    expect(firstRun.binding.assessmentPolicy.policyVersion).toBe(TERMS.termsVersion);

    // Re-scheduling the identical binding is idempotent — the same run, not a second one.
    const repeat = (await schedule(firstBody)).json();
    expect(repeat.executionId).toBe(firstId);
    expect(repeat.created).toBe(false);

    // A later cut-off: proposed and activated by the two identities, exactly as the first was.
    const later = { termsId: "terms-q3", termsVersion: "1.0.0", asOf: "2026-06-30", stallThresholdDays: 45 };
    expect((await propose(boundaryId, later, OPERATOR, "half-year close")).statusCode).toBe(201);
    expect((await move("activate", boundaryId, STEWARD, later)).statusCode).toBe(200);

    const secondRun = (
      await schedule(
        datasetBody(boundaryId, {
          datasetId,
          csvText,
          analysisTermsId: later.termsId,
          analysisTermsVersion: later.termsVersion,
        }),
      )
    ).json();
    expect(secondRun.scheduled).toBe(true);
    expect(secondRun.created).toBe(true);
    // A DIFFERENT execution: the definition is inside the binding, so it cannot re-grade the first.
    expect(secondRun.executionId).not.toBe(firstId);
    expect(secondRun.binding.assessmentPolicy.asOf).toBe("2026-06-30");
    expect(secondRun.binding.assessmentPolicy.stallThresholdDays).toBe(45);

    // And the first execution still says what it said, under the terms it was blessed with.
    const firstStored = await prisma.pilotAssessmentExecutionRecord.findFirstOrThrow({
      where: { executionId: firstId, boundaryId },
    });
    expect(firstStored.asOf).toBe("2026-04-15");
    expect(firstStored.stallThresholdDays).toBe(30);
    expect(firstStored.assessmentPolicyId).toBe(TERMS.termsId);
    expect(await prisma.pilotAssessmentExecutionRecord.count({ where: { boundaryId } })).toBe(2);
  });

  // ── Who may do what ───────────────────────────────────────────────────────────────────────────

  it("14 · proposing is the customer side; activating is governance; neither role holds both", async () => {
    const boundaryId = `pb-${uid()}`;
    // An oversight role may not propose the definition it will later review.
    expect((await propose(boundaryId, TERMS, APPROVER)).statusCode).toBe(403);
    // A steward may not propose either — governance does not author the terms it blesses.
    expect((await propose(boundaryId, TERMS, STEWARD)).statusCode).toBe(403);
    expect((await propose(boundaryId)).statusCode).toBe(201);
    // And the customer side may not activate, whoever they are.
    expect((await move("activate", boundaryId, OTHER_OPERATOR)).statusCode).toBe(403);
    expect((await move("retire", boundaryId, OTHER_OPERATOR)).statusCode).toBe(403);
    expect((await move("activate", boundaryId, STEWARD)).statusCode).toBe(200);
  });

  it("15 · every lifecycle act needs a stated reason, and the transport enforces it", async () => {
    const boundaryId = `pb-${uid()}`;
    for (const rationale of ["", "   ", "\t\n"]) {
      const res = await app.inject({
        method: "POST",
        url: "/pilot/analysis-terms",
        headers: OPERATOR,
        payload: { boundaryId, terms: TERMS, rationale },
      });
      // The transport refuses all three now (`pattern: "\\S"`), so this is a 400 and never a 500.
      expect(res.statusCode, JSON.stringify(rationale)).toBe(400);
    }
    expect(await prisma.pilotAnalysisTermsRecord.count({ where: { boundaryId } })).toBe(0);
  });

  it("16 · the menu of definitions is readable by every role, and reports what may NOT measure", async () => {
    const boundaryId = await governedBoundary();
    const draft = { termsId: "terms-draft", termsVersion: "1.0.0", asOf: "2026-01-31", stallThresholdDays: 7 };
    expect((await propose(boundaryId, draft)).statusCode).toBe(201);

    for (const headers of [OPERATOR, STEWARD, APPROVER]) {
      const list = await app.inject({
        method: "GET",
        url: `/pilot/analysis-terms/list?boundaryId=${boundaryId}`,
        headers,
      });
      expect(list.statusCode, headers["x-actor-role"]).toBe(200);
      const rows = list.json().terms as readonly { termsRef: string; mayMeasure: boolean; state: string }[];
      const active = rows.find((r) => r.termsRef === "terms-q2@1.0.0");
      const pending = rows.find((r) => r.termsRef === "terms-draft@1.0.0");
      expect(active?.mayMeasure).toBe(true);
      // A draft is LISTED and marked unusable rather than hidden: "not approved yet" and "does not
      // exist" are different answers, and the screen must be able to say which.
      expect(pending?.state).toBe("DRAFT");
      expect(pending?.mayMeasure).toBe(false);
    }
  });

  it("18 · a proposal that cannot be recorded in full records NOTHING", async () => {
    // Called through the SERVICE, not the route, on purpose. The transport now refuses a blank reason
    // (`pattern: "\\S"`), so this path is unreachable over HTTP — and the service is a public entry point
    // in its own right: the rehearsal agent calls it, and a CLI could. Without the transaction the
    // definition row is written and only the lifecycle log fails, leaving a version that occupies its
    // own (boundary, id, version) forever, derives no state, and blocks the real proposal of that
    // version while measuring nothing. NC-34 removes the transaction and this is the test that catches it.
    const boundaryId = `pb-${uid()}`;
    await expect(
      proposeAnalysisTerms(
        { actorId: OPERATOR["x-actor-id"], role: "operator", boundaryIds: Object.freeze(["*"]) },
        { boundaryId, terms: TERMS, rationale: "   " },
      ),
    ).rejects.toThrow();

    expect(await prisma.pilotAnalysisTermsRecord.count({ where: { boundaryId } })).toBe(0);
    expect(await prisma.pilotAnalysisTermsEventRecord.count({ where: { boundaryId } })).toBe(0);
    // And the version is still free to be proposed properly afterwards — the point of rolling back.
    expect((await propose(boundaryId)).statusCode).toBe(201);
  });

  it("17 · the hash is a witness of the definition, recomputable from the read", async () => {
    const boundaryId = await governedBoundary();
    const view = (
      await app.inject({
        method: "GET",
        url: `/pilot/analysis-terms/governance?boundaryId=${boundaryId}&termsId=${TERMS.termsId}&termsVersion=1.0.0`,
        headers: STEWARD,
      })
    ).json();
    const recomputed = await hashAnalysisTerms(
      makeAnalysisTerms({
        termsId: TERMS.termsId,
        termsVersion: TERMS.termsVersion,
        asOf: view.asOf,
        stallThresholdDays: view.stallThresholdDays,
        calculationMethodVersion: view.calculationMethodVersion,
      }),
    );
    expect(view.termsHash).toBe(recomputed);
  });
});

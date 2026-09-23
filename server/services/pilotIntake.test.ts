// EP-13 · Customer Pilot Intake — server-authoritative integration suite.
//
// Every test here goes through the REAL HTTP surface (app.inject → Fastify → schema → service →
// PostgreSQL). Nothing is stubbed: if a rule only holds because a unit test called a function
// directly, it does not hold for a customer.
//
// The adversarial cases are the point of the file: cross-tenant access, payload-supplied tenancy,
// oversized input, and error text that must never echo customer data.
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { buildApp } from "../app";
import { prisma } from "../db";
import { fixtureVerifier } from "../test/sourceFixture";
import {
  SYNTHETIC_PROVENANCE,
  syntheticPilotCsv,
  syntheticPilotRows,
  syntheticViolationCsv,
  toCsv,
} from "../../src/contract/syntheticPilotDataset";
import { PILOT_DATA_CONTRACT_VERSION, INTAKE_LIMITS } from "../../src/contract/pilotDataContract";

const HAS_DB = !!process.env.DATABASE_URL;

const OPERATOR = { "x-actor-id": "pilot-operator@company", "x-actor-role": "operator" };
const APPROVER = { "x-actor-id": "cfo@company", "x-actor-role": "approver" };
const uid = () => Math.random().toString(36).slice(2, 10);

const POLICY = { stallThresholdDays: 30, asOf: "2026-04-15", currency: "USD" };

function body(over: Record<string, unknown> = {}) {
  return {
    boundaryId: `pilot-boundary-${uid()}`,
    datasetId: `dataset-${uid()}`,
    declaredVersion: PILOT_DATA_CONTRACT_VERSION,
    csvText: syntheticPilotCsv(12),
    policy: POLICY,
    provenance: SYNTHETIC_PROVENANCE,
    ...over,
  };
}

describe.skipIf(!HAS_DB)("EP-13 · customer pilot intake (server-authoritative)", () => {
  const app = buildApp({ sourceVerifier: fixtureVerifier });
  beforeAll(async () => {
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const post = (payload: unknown, headers: Record<string, string> = OPERATOR) =>
    app.inject({ method: "POST", url: "/pilot/datasets", headers, payload: payload as object });

  it("1 · a valid synthetic upload is accepted, usable, and recorded once", async () => {
    const payload = body();
    const res = await post(payload);
    expect(res.statusCode).toBe(200);
    const out = res.json();

    expect(out.contractVersion).toBe(PILOT_DATA_CONTRACT_VERSION);
    expect(out.accepted).toBe(true);
    expect(out.usableForAssessment).toBe(true);
    expect(out.counts.dataRows).toBe(12);
    expect(out.counts.acceptedRows).toBe(12);
    expect(out.counts.rejectedRows).toBe(0);
    expect(out.datasetFindings).toEqual([]);
    expect(out.recordedAt).not.toBeNull();

    const stored = await prisma.pilotDatasetSubmissionRecord.findUniqueOrThrow({
      where: { idempotencyKey: out.idempotencyKey },
    });
    expect(stored.boundaryId).toBe(payload.boundaryId);
    expect(stored.usable).toBe(true);
    expect(stored.acceptedRows).toBe(12);
  });

  it("2 · an invalid schema (missing required column) is rejected before any persistence", async () => {
    const csv = "entity_id,signed_at,next_invoice_due_at\nsynthetic-account-0001,2026-01-05,2026-02-04\n";
    const before = await prisma.pilotDatasetSubmissionRecord.count();
    const res = await post(body({ csvText: csv }));

    expect(res.statusCode).toBe(200);
    const out = res.json();
    expect(out.accepted).toBe(false);
    expect(out.usableForAssessment).toBe(false);
    expect(out.datasetFindings.map((f: { code: string }) => f.code)).toContain("NH-DC-1002");
    expect(out.recordedAt).toBeNull();
    // Nothing reached the database — rejection happens before persistence, not after.
    expect(await prisma.pilotDatasetSubmissionRecord.count()).toBe(before);
  });

  it("3 · an undeclared column rejects the dataset and persists nothing", async () => {
    const csv =
      "entity_id,signed_at,next_invoice_due_at,next_invoice_amount,currency,internal_notes\n" +
      "synthetic-account-0001,2026-01-05,2026-02-04,1000.00,USD,free text\n";
    const before = await prisma.pilotDatasetSubmissionRecord.count();
    const res = await post(body({ csvText: csv }));

    const out = res.json();
    expect(out.datasetFindings.map((f: { code: string }) => f.code)).toContain("NH-DC-1005");
    expect(out.usableForAssessment).toBe(false);
    expect(await prisma.pilotDatasetSubmissionRecord.count()).toBe(before);
  });

  it("4 · a timestamp with no UTC offset is rejected on its row, never assumed", async () => {
    const rows = syntheticPilotRows(3).map((r, i) => (i === 1 ? { ...r, signed_at: "2026-01-06 09:30:00" } : r));
    const res = await post(body({ csvText: toCsv(rows) }));
    const out = res.json();

    const offending = out.rowFindings.filter((f: { code: string }) => f.code === "NH-DC-2005");
    expect(offending).toHaveLength(1);
    expect(offending[0].rowNumber).toBe(2);
    expect(offending[0].field).toBe("signed_at");
    // Partial acceptance: the other two rows still stand. This is the contract's existing policy,
    // not a new one — only `dataset_rejected` findings fail a dataset.
    expect(out.accepted).toBe(true);
    expect(out.usableForAssessment).toBe(true);
    expect(out.counts.acceptedRows).toBe(2);
    expect(out.counts.rejectedRows).toBe(1);
  });

  it("5 · a byte-identical duplicate upload is refused for the same tenant", async () => {
    const payload = body();
    expect((await post(payload)).statusCode).toBe(200);

    const repeat = await post(payload);
    expect(repeat.statusCode).toBe(409);
    expect(repeat.json().message).toContain("NH-DC-4003");
    // Exactly one record — the repeat did not create a second.
    const rows = await prisma.pilotDatasetSubmissionRecord.findMany({ where: { boundaryId: payload.boundaryId } });
    expect(rows).toHaveLength(1);
  });

  it("5b · the same bytes under a DIFFERENT tenant are not a duplicate", async () => {
    const csvText = syntheticPilotCsv(6);
    const datasetId = `shared-${uid()}`;
    const a = await post(body({ csvText, datasetId, boundaryId: `pilot-boundary-${uid()}` }));
    const b = await post(body({ csvText, datasetId, boundaryId: `pilot-boundary-${uid()}` }));
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200); // different tenants never collide
    expect(a.json().idempotencyKey).not.toBe(b.json().idempotencyKey);
  });

  it("6 · zero usable rows is reported, not persisted, and never marked usable", async () => {
    const before = await prisma.pilotDatasetSubmissionRecord.count();
    const res = await post(body({ csvText: syntheticViolationCsv() }));
    const out = res.json();

    expect(out.accepted).toBe(true); // the FILE is structurally legal …
    expect(out.counts.acceptedRows).toBe(0);
    expect(out.usableForAssessment).toBe(false); // … but there is nothing to assess
    expect(out.recordedAt).toBeNull();
    expect(await prisma.pilotDatasetSubmissionRecord.count()).toBe(before);
  });

  it("7 · a cross-tenant read attempt cannot see another tenant's submission", async () => {
    const victim = body({ boundaryId: `pilot-boundary-victim-${uid()}` });
    const accepted = await post(victim);
    expect(accepted.statusCode).toBe(200);
    const stolenKey = accepted.json().idempotencyKey;

    // The attacker submits the SAME bytes while naming their own boundary. If duplicate detection
    // were keyed on the file alone, the victim's record would leak as a 409 "already submitted".
    const attacker = await post({ ...victim, boundaryId: `pilot-boundary-attacker-${uid()}` });
    expect(attacker.statusCode).toBe(200);
    expect(attacker.json().idempotencyKey).not.toBe(stolenKey);

    const victimRows = await prisma.pilotDatasetSubmissionRecord.findMany({
      where: { boundaryId: victim.boundaryId },
    });
    expect(victimRows).toHaveLength(1); // untouched by the attacker's submission
  });

  it("7b · a SCOPED identity cannot reach a boundary it does not hold", async () => {
    // The tests above run under dev headers, which carry the internal "*" wildcard — so they prove
    // key isolation but never exercise denial. Production identities are scoped (an OIDC token's
    // boundary claim rejects "*" outright), so this mounts an app with a scoped resolver and checks
    // the refusal that actually protects a customer.
    const scoped = buildApp({
      sourceVerifier: fixtureVerifier,
      identityResolver: async () =>
        Object.freeze({ actorId: "scoped@company", role: "operator" as const, boundaryIds: Object.freeze(["tenant-a"]) }),
    });
    await scoped.ready();
    try {
      const own = await scoped.inject({
        method: "POST", url: "/pilot/datasets", headers: OPERATOR,
        payload: body({ boundaryId: "tenant-a" }) as object,
      });
      expect(own.statusCode).toBe(200); // its own boundary is fine

      const other = await scoped.inject({
        method: "POST", url: "/pilot/datasets", headers: OPERATOR,
        payload: body({ boundaryId: "tenant-b" }) as object,
      });
      expect(other.statusCode).toBe(403);
      expect(other.json().message).toMatch(/not authorized for this boundary/i);
      // Refused before anything was validated or written.
      expect(await prisma.pilotDatasetSubmissionRecord.count({ where: { boundaryId: "tenant-b" } })).toBe(0);
    } finally {
      await scoped.close();
    }
  });

  it("8 · a payload-supplied tenant field is rejected by the schema, never honoured", async () => {
    for (const injected of ["tenantId", "boundary", "actorId", "boundaryIds", "usableForAssessment"]) {
      const res = await post({ ...body(), [injected]: "attacker-tenant" });
      expect(res.statusCode, `field '${injected}' must be rejected`).toBe(400);
    }
    // And a CSV column claiming tenancy is rejected as undeclared, not read.
    const csv =
      "entity_id,signed_at,next_invoice_due_at,next_invoice_amount,currency,tenant_id\n" +
      "synthetic-account-0001,2026-01-05,2026-02-04,1000.00,USD,other-tenant\n";
    const out = (await post(body({ csvText: csv }))).json();
    expect(out.datasetFindings.map((f: { code: string }) => f.code)).toContain("NH-DC-1005");
    expect(out.usableForAssessment).toBe(false);
  });

  it("9 · an oversized file is refused whole with a deterministic code, never truncated", async () => {
    const header = "entity_id,signed_at,next_invoice_due_at,next_invoice_amount,currency\n";
    const row = "synthetic-account-0001,2026-01-05,2026-02-04,1000.00,USD\n";
    const csv = header + row.repeat(Math.ceil((INTAKE_LIMITS.maxBytes + 1024) / row.length));
    expect(csv.length).toBeGreaterThan(INTAKE_LIMITS.maxBytes);

    const before = await prisma.pilotDatasetSubmissionRecord.count();
    const out = (await post(body({ csvText: csv }))).json();

    expect(out.datasetFindings.map((f: { code: string }) => f.code)).toContain("NH-DC-1011");
    expect(out.usableForAssessment).toBe(false);
    // Refused whole: no partial row count is reported and nothing is stored.
    expect(out.counts.acceptedRows).toBe(0);
    expect(await prisma.pilotDatasetSubmissionRecord.count()).toBe(before);
  });

  it("9b · a body beyond the TRANSPORT limit fails deterministically, not as a generic 500", async () => {
    // Two distinct guards, both refusing whole: the contract's size rule (9, above) and Fastify's
    // per-route body limit here. Before this was mapped, an oversized upload surfaced as
    // "An internal error occurred." — true, useless, and indistinguishable from a real fault.
    const header = "entity_id,signed_at,next_invoice_due_at,next_invoice_amount,currency\n";
    const row = "synthetic-account-0001,2026-01-05,2026-02-04,1000.00,USD\n";
    const csv = header + row.repeat(Math.ceil((INTAKE_LIMITS.maxBytes + 3 * 1024 * 1024) / row.length));
    const res = await post(body({ csvText: csv }));
    expect(res.statusCode).toBe(413);
    expect(res.json().error).toBe("payload_too_large");
    expect(res.json().message).toContain("NH-DC-1011");
    expect(res.json().message).not.toMatch(/internal error/i);
  });

  it("10 · an unauthorized role and an unauthenticated caller are both refused", async () => {
    // An approver may never submit customer data for assessment (least privilege, unchanged).
    expect((await post(body(), APPROVER)).statusCode).toBe(403);
    expect(
      (await app.inject({ method: "POST", url: "/pilot/datasets", payload: body() as object })).statusCode,
    ).toBe(401);
  });

  it("11 · neither the response nor the stored record leaks raw PII or row content", async () => {
    const secret = "very.secret.person@customer.example";
    const rows = syntheticPilotRows(3).map((r, i) => (i === 0 ? { ...r, entity_id: secret } : r));
    const payload = body({ csvText: toCsv(rows) });
    const res = await post(payload);
    const raw = res.body;

    // The PII finding names the FIELD and the SHAPE — never the value itself.
    const pii = res.json().rowFindings.find((f: { code: string }) => f.code === "NH-DC-3002");
    expect(pii).toBeDefined();
    expect(pii.field).toBe("entity_id");
    expect(JSON.stringify(pii)).not.toContain(secret);
    expect(raw).not.toContain(secret);
    // No accepted-cycle payload crosses the wire at all: identifiers and money stay server-side.
    expect(res.json().acceptedCycles).toBeUndefined();
    expect(raw).not.toContain("synthetic-account-0002");

    // Whatever else happened, nothing containing the secret was written.
    const stored = await prisma.pilotDatasetSubmissionRecord.findMany({ where: { boundaryId: payload.boundaryId } });
    expect(JSON.stringify(stored)).not.toContain(secret);
    // Stored findings are CODES only — never the detail text that can echo a customer value.
    for (const record of stored) {
      for (const code of record.findingCodes) expect(code).toMatch(/^NH-DC-\d{4}$/);
    }
  });

  it("12 · this slice creates no Case, Proof, evidence or authority record", async () => {
    // Scoped to THIS submission's own identifiers rather than global table counts: the suites run
    // in parallel against one database, so a global before/after count measures other tests' writes
    // and fails for reasons that have nothing to do with this endpoint.
    const payload = body();
    const res = await post(payload);
    expect(res.statusCode).toBe(200);
    const { idempotencyKey } = res.json();

    // A leak would have to name one of these; none of them may exist.
    const ids = [payload.boundaryId, payload.datasetId, idempotencyKey];
    expect(await prisma.recoveryCaseRecord.count({ where: { boundaryId: payload.boundaryId } })).toBe(0);
    expect(await prisma.proof.count({ where: { recoveryCaseId: { in: ids } } })).toBe(0);
    expect(await prisma.authorityEvent.count({ where: { recoveryCaseId: { in: ids } } })).toBe(0);
    expect(await prisma.evidenceRecord.count({ where: { recoveryCaseId: { in: ids } } })).toBe(0);
    expect(await prisma.baselineSnapshot.count({ where: { recoveryCaseId: { in: ids } } })).toBe(0);
    expect(await prisma.agentCaseCandidateRecord.count({ where: { boundaryId: payload.boundaryId } })).toBe(0);

    // The ONLY row this endpoint may create is the submission record itself.
    expect(await prisma.pilotDatasetSubmissionRecord.count({ where: { boundaryId: payload.boundaryId } })).toBe(1);
  });

  it("13 · a submission record is append-only at the database level", async () => {
    const payload = body();
    const out = (await post(payload)).json();
    await expect(
      prisma.pilotDatasetSubmissionRecord.update({
        where: { idempotencyKey: out.idempotencyKey },
        data: { acceptedRows: 99_999 },
      }),
    ).rejects.toThrow(/append-only/i);
    await expect(
      prisma.pilotDatasetSubmissionRecord.delete({ where: { idempotencyKey: out.idempotencyKey } }),
    ).rejects.toThrow(/append-only/i);
  });
});

// G9 · THE LIVE APPROVAL ROUTE, WIRED TO THE SETTLEMENT LEDGER.
//
// WHAT THIS FILE CARRIES. The stage-8 importer guard used to assert that `proofService` reached no
// settlement module, and that assertion WAS the statement that the PROVEN gate could not be fed by an
// unwired mechanism. The route is wired now, so the structural proxy is spent and the two properties it
// stood for have to be shown behaviourally:
//
//   1. OMITTING `citedSettlements` LEAVES THE APPROVAL EXACTLY AS IT WAS. Full backward compatibility
//      is not a claim in a commit message; it is a 201 with no consumption row.
//   2. SUPPLYING IT CAN ONLY EVER REFUSE. Every failure mode — flag off, no payer recorded, forged
//      signature, unregistered key, wrong tenant, arrival already counted — ends with NO proof and NO
//      consumption. Nothing in this path can make a proof easier to obtain.
//
// AND THE ONE THING THE PRODUCTION ROUTE CANNOT DO TODAY, asserted rather than described: it refuses
// with `SETTLEMENT_CASE_PAYER_NOT_RECORDED`, because `prisma/schema.prisma` holds no external payer
// reference on any model — dependency 1 from stage 8's own header. The success path below supplies that
// fact through the `payerSource` seam, and the HTTP test proves the real route does not.
import { createHmac, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../db";
import { approve, type ApproveProofRequest } from "./proofService";
import type { CasePayerReferenceSource } from "./caseSettlementContext";
import { settlementSigningPayload } from "./settlementVerification";
import { attestedPayerReference } from "./caseSettlementContext";
import { attestFixture } from "../test/sourceFixture";
import { settlementDigest } from "../persistence/settlementLedgerStore";
import {
  activateSettlementKey, proposeSettlementKey, revokeSettlementKeyAsCompromised,
} from "./settlementKeyGovernance";
import { postgresSettlementKeyRegister } from "../persistence/settlementKeyStore";
import { splitSqlStatements } from "../persistence/obligationAttributionMigration.postgres.test";
import {
  APPROVER, AUTHOR, approveBody, seedBaseline, seedEvidence, seedGovernedRoot, seedIntervention, uid,
} from "../test/fixtures";
import { buildApp } from "../app";
import { fixtureVerifier } from "../test/sourceFixture";
import type { ExternalSettlementFact } from "../../src/domain/externalSettlement";
import type { ActorContext } from "../auth/identity";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const KEYS_UP = readFileSync(resolve(REPO, "scripts/migration-design/settlement-key-register-up.sql"), "utf8");
const LEDGER_UP = readFileSync(resolve(REPO, "scripts/migration-design/settlement-ledger-up.sql"), "utf8");

const HAS_DB = (process.env.DATABASE_URL ?? "").length > 0;
const DIGEST_KEY = "nh-test-settlement-digest-key-0123456789abcdef";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;

const BANK = (() => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { pem: publicKey.export({ type: "spki", format: "pem" }).toString(), privateKey };
})();
const IMPOSTOR = generateKeyPairSync("ed25519").privateKey;

const OPERATOR: ActorContext = { actorId: "op@company", role: "operator", boundaryIds: ["*"] };
const STEWARD_CTX: ActorContext = { actorId: "gov@company", role: "steward", boundaryIds: ["*"] };
const APPROVER_CTX: ActorContext = { actorId: "cfo@company", role: "approver", boundaryIds: ["*"] };
const CEREMONY = {
  channelIndependentlyVerified: true, institutionIdentityVerified: true,
  keyControlDemonstrated: true, ceremonyRecorded: true,
};

const PAYER = "PAYER-EXT-7781";
/** A source that DOES hold the fact. Only a test may supply one; production returns `null`. */
const recordedPayer: CasePayerReferenceSource = { payerExternalRefFor: async () => PAYER };

const env = (over: Record<string, string | undefined> = {}) => ({
  NH_EXTERNAL_SETTLEMENT_ENABLED: "true",
  NH_SETTLEMENT_SOURCE_KEYS: "[]",
  ...over,
});

const plus = (iso: string, ms: number): string => new Date(Date.parse(iso) + ms).toISOString();
const DAY = 24 * 60 * 60_000;

/**
 * A provable BillingCorrection case with a KNOWN corrective invoice reference.
 *
 * `attestPayer` seeds the correction evidence through the REAL route with a SOURCE-SIGNED
 * `payerExternalRef`, which is how a case comes to hold an attested payer in production. The fixture
 * signs as the billing system because that is who signs in production; it cannot shortcut the
 * signature, because an unsigned or mis-signed claim is refused at ingestion.
 */
async function provableCase(
  opts: { boundaryId?: string; invoiceRef?: string; attestPayer?: string } = {},
): Promise<{
  caseId: string; baselineId: string; evidenceId: string; boundaryId: string; invoiceRef: string;
}> {
  const caseId = `RC-${uid()}`;
  const boundaryId = opts.boundaryId ?? `SYNTHETIC-g9-${uid()}`;
  const invoiceRef = opts.invoiceRef ?? `CN-${uid()}`;
  await seedGovernedRoot(caseId, { boundaryId });
  await app.inject({ method: "POST", url: `/cases/${caseId}/author`, headers: AUTHOR });
  const baselineId = await seedBaseline(app, caseId, { calculatedMinor: 260_000 });
  // The correction is seeded with a KNOWN `sourceRecordId`, because that is what stage 8 compares the
  // attestation's `correctiveInvoiceRef` against — and the default fixture picks a random one.
  await seedIntervention(app, caseId, { noCorrectionRecord: true });

  const correctionClaim = {
    evidenceId: `EV-CORR-${uid()}`,
    sourceSystem: "billing",
    sourceRecordId: invoiceRef,
    evidenceType: "corrective_invoice_issued",
    observedAt: "2026-07-25T00:00:00.000Z",
    ...(opts.attestPayer === undefined ? {} : { payerExternalRef: opts.attestPayer }),
  };
  const corr = await app.inject({
    method: "POST", url: `/cases/${caseId}/evidence`, headers: AUTHOR,
    payload: attestFixture(caseId, correctionClaim),
  });
  if (corr.statusCode !== 201) throw new Error(`correction seed failed: ${corr.body}`);

  const out = await seedEvidence(app, caseId, { amountMinor: 1_320_000, currency: "USD" });
  if (out.res.statusCode !== 201) throw new Error(`outcome seed failed: ${out.res.body}`);
  return { caseId, baselineId, evidenceId: out.evidenceId, boundaryId, invoiceRef };
}

async function activeKeyFor(boundaryId: string): Promise<{ keyId: string; signedAt: string; now: string }> {
  const register = postgresSettlementKeyRegister();
  const keyId = `k-g9-${randomUUID().slice(0, 8)}`;
  await proposeSettlementKey(register, OPERATOR, {
    facts: {
      keyId, boundaryId, sourceSystem: "acme-bank", sourceKind: "bank", publicKey: BANK.pem,
      validFrom: plus(new Date().toISOString(), -30 * DAY),
      validUntil: plus(new Date().toISOString(), 365 * DAY),
    },
    evidence: CEREMONY,
    rationale: "g9 synthetic ceremony",
  });
  await activateSettlementKey(register, STEWARD_CTX, { keyId, rationale: "reviewed" });
  const row = await register.read(keyId);
  const activatedAt = row!.events.find((e) => e.transition === "ACTIVATED")!.at;
  // SIGNED EXACTLY AT ACTIVATION, and both halves of that matter.
  //
  // `validAt` asks for the key's state AS OF the signing instant and `at <= target` makes the key ACTIVE
  // at exactly `activatedAt`, so this is the earliest instant that verifies. One minute later — my first
  // attempt — is in the FUTURE relative to the real clock the verifier uses, because activation was
  // stamped by the database a few milliseconds ago, and the skew guard refused it. Unlike the isolated
  // suites, this path runs against the live `approve()`, which pins `now` to the real clock rather than
  // taking one from a fixture, so the window is genuinely narrow and the fixture must respect it.
  return { keyId, signedAt: activatedAt, now: activatedAt };
}

const factFor = (boundaryId: string, invoiceRef: string, over: Partial<ExternalSettlementFact> = {}):
ExternalSettlementFact => ({
  boundaryId, sourceSystem: "acme-bank", sourceKind: "bank",
  externalSettlementRef: `CR-G9-${uid()}`, finality: "BANK_CREDITED",
  amountMinor: 1_320_000, currency: "USD", valueDate: new Date().toISOString(),
  correctiveInvoiceRef: invoiceRef, payerExternalRef: PAYER,
  ...over,
});

const attest = (
  fact: ExternalSettlementFact, keyId: string, signedAt: string,
  key = BANK.privateKey, fixedNonce?: string,
) => {
  const nonce = fixedNonce ?? `nonce-${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  return {
    keyId, issuedAt: signedAt, nonce,
    signature: sign(null, settlementSigningPayload(fact, nonce, signedAt), key).toString("base64"),
  };
};

const trustKeysEnv = (keyId: string, boundaryId: string) => env({
  NH_SETTLEMENT_SOURCE_KEYS: JSON.stringify([
    { keyId, boundaryId, sourceSystem: "acme-bank", sourceKind: "bank", publicKey: BANK.pem },
  ]),
});

const body = (o: { proofId: string; caseId: string; baselineId: string; evidenceIds: string[] }):
ApproveProofRequest => approveBody(o) as ApproveProofRequest;

const proofCount = (caseId: string) => prisma.proof.count({ where: { recoveryCaseId: caseId } });
const consumptions = async (digest: string): Promise<{ claim_ref: string }[]> =>
  prisma.$queryRawUnsafe(
    `SELECT "claim_ref" FROM "settlement_consumptions" WHERE "settlement_digest" = $1`, digest,
  );

beforeAll(async () => {
  if (!HAS_DB) return;
  for (const sql of [KEYS_UP, LEDGER_UP]) {
    for (const statement of splitSqlStatements(sql)) {
      try { await prisma.$executeRawUnsafe(statement); } catch { /* already present */ }
    }
  }
  app = buildApp({ sourceVerifier: fixtureVerifier });
}, 180_000);

afterAll(async () => { if (HAS_DB) await app?.close(); }, 60_000);

describe.skipIf(!HAS_DB)("G9 · backward compatibility — the field is optional and its absence changes nothing", () => {
  it("THE POSITIVE CONTROL: omitting citedSettlements still mints a proof, and consumes nothing", async () => {
    const c = await provableCase();
    const proofId = `PF-${uid()}`;
    const proof = await approve(APPROVER_CTX, body({ ...c, proofId, evidenceIds: [c.evidenceId] }));
    expect(proof.proofId).toBe(proofId);
    expect(await proofCount(c.caseId)).toBe(1);
    // Not one row in the ledger. A wired gate that consumed something on an approval that cited nothing
    // would be a behaviour change dressed as a feature.
    const [{ n }] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n FROM "settlement_consumptions" WHERE "claim_ref" = $1`, proofId,
    );
    expect(Number(n)).toBe(0);
  }, 60_000);

  it("an EMPTY array is treated as nothing cited, not as a citation that failed", async () => {
    const c = await provableCase();
    const proofId = `PF-${uid()}`;
    const req = { ...body({ ...c, proofId, evidenceIds: [c.evidenceId] }), citedSettlements: [] as const };
    await expect(approve(APPROVER_CTX, req)).resolves.toMatchObject({ proofId });
  }, 60_000);
});

describe.skipIf(!HAS_DB)("G9 · supplying the field can only REFUSE", () => {
  it("the FLAG OFF refuses a citation rather than silently dropping it", async () => {
    // A dropped citation would leave a proof counting money nothing verified. Refusing is the treatment
    // EP-26b gave `policy` and reference-first scheduling gave `declaredVersion`.
    const c = await provableCase();
    const { keyId, signedAt } = await activeKeyFor(c.boundaryId);
    const fact = factFor(c.boundaryId, c.invoiceRef);
    const proofId = `PF-${uid()}`;
    await expect(approve(
      APPROVER_CTX,
      { ...body({ ...c, proofId, evidenceIds: [c.evidenceId] }),
        citedSettlements: [{ fact, attestation: attest(fact, keyId, signedAt) }] },
      { env: env({ NH_EXTERNAL_SETTLEMENT_ENABLED: "false" }), payerSource: recordedPayer, digestKey: DIGEST_KEY },
    )).rejects.toThrow(/EXTERNAL_SETTLEMENT_NOT_ENABLED/);
    expect(await proofCount(c.caseId)).toBe(0);
  }, 60_000);

  it("the production route refuses a case whose evidence carries NO source-attested payer", async () => {
    // THE REAL BEHAVIOUR OF THE SHIPPED PATH, through HTTP, with no seam substituted. This case's
    // evidence was ingested without a signed `payerExternalRef`, so the production resolver finds
    // nothing and the approval is refused. Absence is the safe state by construction: NH will neither
    // invent the pseudonym-to-payer mapping nor accept one from the request.
    const c = await provableCase();
    const { keyId, signedAt } = await activeKeyFor(c.boundaryId);
    const fact = factFor(c.boundaryId, c.invoiceRef);
    const previous = process.env.NH_EXTERNAL_SETTLEMENT_ENABLED;
    process.env.NH_EXTERNAL_SETTLEMENT_ENABLED = "true";
    try {
      const res = await app.inject({
        method: "POST", url: "/proofs", headers: APPROVER,
        payload: {
          ...body({ ...c, proofId: `PF-${uid()}`, evidenceIds: [c.evidenceId] }),
          citedSettlements: [{ fact, attestation: attest(fact, keyId, signedAt) }],
        },
      });
      expect(res.statusCode, res.body.slice(0, 400)).toBe(403);
      expect(res.body).toContain("SETTLEMENT_CASE_PAYER_NOT_RECORDED");
      expect(await proofCount(c.caseId)).toBe(0);
    } finally {
      if (previous === undefined) delete process.env.NH_EXTERNAL_SETTLEMENT_ENABLED;
      else process.env.NH_EXTERNAL_SETTLEMENT_ENABLED = previous;
    }
  }, 60_000);

  it("A FORGED SIGNATURE CANNOT BECOME PROVEN, and consumes nothing", async () => {
    const c = await provableCase();
    const { keyId, signedAt } = await activeKeyFor(c.boundaryId);
    const fact = factFor(c.boundaryId, c.invoiceRef);
    const proofId = `PF-${uid()}`;
    await expect(approve(
      APPROVER_CTX,
      { ...body({ ...c, proofId, evidenceIds: [c.evidenceId] }),
        citedSettlements: [{ fact, attestation: attest(fact, keyId, signedAt, IMPOSTOR) }] },
      { env: trustKeysEnv(keyId, c.boundaryId), payerSource: recordedPayer, digestKey: DIGEST_KEY },
    )).rejects.toThrow(/does not verify/);
    expect(await proofCount(c.caseId)).toBe(0);
    expect(await consumptions(settlementDigest(fact, DIGEST_KEY))).toEqual([]);
  }, 60_000);

  it("AN UNREGISTERED KEY is refused — a 404 from the register, not a silent pass", async () => {
    const c = await provableCase();
    const fact = factFor(c.boundaryId, c.invoiceRef);
    const now = new Date().toISOString();
    await expect(approve(
      APPROVER_CTX,
      { ...body({ ...c, proofId: `PF-${uid()}`, evidenceIds: [c.evidenceId] }),
        citedSettlements: [{ fact, attestation: attest(fact, "k-never-registered", now) }] },
      { env: env(), payerSource: recordedPayer, digestKey: DIGEST_KEY },
    )).rejects.toThrow(/is not registered/);
    expect(await proofCount(c.caseId)).toBe(0);
  }, 60_000);

  it("A REVOKED KEY IS REFUSED even while the environment still lists it as trusted", async () => {
    // FOUND BY A SURVIVING MUTATION, and it is the gap that mutation exposed rather than the one it
    // described. Swallowing the register-backed verification left every signature check intact, because
    // the gate re-verifies under its own env-configured trust keys — so a forged attestation was still
    // refused and the mutation looked harmless. What the register-backed step ALONE contributes is
    // GOVERNANCE: was the key in force when it signed, and is it still permitted to support a proof.
    // A revoked key whose public half is still in NH_SETTLEMENT_SOURCE_KEYS verifies cryptographically
    // and must be refused anyway. Nothing asserted that until now.
    const c = await provableCase();
    const { keyId, signedAt } = await activeKeyFor(c.boundaryId);
    const fact = factFor(c.boundaryId, c.invoiceRef);
    const attestation = attest(fact, keyId, signedAt);

    await revokeSettlementKeyAsCompromised(postgresSettlementKeyRegister(), STEWARD_CTX, {
      keyId, rationale: "forensics", exposureFrom: null,
    });

    await expect(approve(
      APPROVER_CTX,
      { ...body({ ...c, proofId: `PF-${uid()}`, evidenceIds: [c.evidenceId] }),
        citedSettlements: [{ fact, attestation }] },
      { env: trustKeysEnv(keyId, c.boundaryId), payerSource: recordedPayer, digestKey: DIGEST_KEY },
    )).rejects.toThrow();
    expect(await proofCount(c.caseId)).toBe(0);
    expect(await consumptions(settlementDigest(fact, DIGEST_KEY))).toEqual([]);
  }, 60_000);

  it("TENANT SEPARATION · an attestation for ANOTHER boundary cannot support this case", async () => {
    // The boundary is inside the signed payload AND the key is registered per boundary, so a signature
    // cannot be moved between tenants. Asserted through the live route rather than trusted.
    const mine = await provableCase();
    const theirs = await provableCase();
    const { keyId, signedAt } = await activeKeyFor(theirs.boundaryId);
    const foreign = factFor(theirs.boundaryId, mine.invoiceRef);
    await expect(approve(
      APPROVER_CTX,
      { ...body({ ...mine, proofId: `PF-${uid()}`, evidenceIds: [mine.evidenceId] }),
        citedSettlements: [{ fact: foreign, attestation: attest(foreign, keyId, signedAt) }] },
      { env: trustKeysEnv(keyId, theirs.boundaryId), payerSource: recordedPayer, digestKey: DIGEST_KEY },
    )).rejects.toThrow();
    expect(await proofCount(mine.caseId)).toBe(0);
  }, 60_000);

  it("PERMISSIONS · a role that may not approve never reaches the settlement path at all", async () => {
    const c = await provableCase();
    const { keyId, signedAt } = await activeKeyFor(c.boundaryId);
    const fact = factFor(c.boundaryId, c.invoiceRef);
    for (const role of ["author", "operator"] as const) {
      await expect(approve(
        { actorId: "x@company", role, boundaryIds: ["*"] },
        { ...body({ ...c, proofId: `PF-${uid()}`, evidenceIds: [c.evidenceId] }),
          citedSettlements: [{ fact, attestation: attest(fact, keyId, signedAt) }] },
        { env: trustKeysEnv(keyId, c.boundaryId), payerSource: recordedPayer, digestKey: DIGEST_KEY },
      )).rejects.toThrow(/may not perform 'Approve'/);
    }
    expect(await proofCount(c.caseId)).toBe(0);
    expect(await consumptions(settlementDigest(fact, DIGEST_KEY))).toEqual([]);
  }, 60_000);
});

describe.skipIf(!HAS_DB)("G9 · the wired success path, and what it makes impossible", () => {
  it("THE POSITIVE CONTROL: a verified settlement reaches PROVEN and the arrival is claimed by the proof", async () => {
    const c = await provableCase();
    const { keyId, signedAt } = await activeKeyFor(c.boundaryId);
    const fact = factFor(c.boundaryId, c.invoiceRef);
    const proofId = `PF-${uid()}`;
    const proof = await approve(
      APPROVER_CTX,
      { ...body({ ...c, proofId, evidenceIds: [c.evidenceId] }),
        citedSettlements: [{ fact, attestation: attest(fact, keyId, signedAt) }] },
      { env: trustKeysEnv(keyId, c.boundaryId), payerSource: recordedPayer, digestKey: DIGEST_KEY },
    );
    expect(proof.proofId).toBe(proofId);
    expect(await proofCount(c.caseId)).toBe(1);
    // THE CLAIM REFERENCE IS THE PROOF ID, so the ledger records which proof the money substantiates.
    expect((await consumptions(settlementDigest(fact, DIGEST_KEY))).map((r) => r.claim_ref)).toEqual([proofId]);
  }, 60_000);

  it("THE SAME ARRIVAL CANNOT SUBSTANTIATE A SECOND PROOF, and the second case stays unproven", async () => {
    const boundaryId = `SYNTHETIC-g9shared-${uid()}`;
    const first = await provableCase({ boundaryId });
    const second = await provableCase({ boundaryId, invoiceRef: first.invoiceRef });
    const { keyId, signedAt } = await activeKeyFor(boundaryId);
    const fact = factFor(boundaryId, first.invoiceRef);
    const deps = { env: trustKeysEnv(keyId, boundaryId), payerSource: recordedPayer, digestKey: DIGEST_KEY };

    await approve(APPROVER_CTX, {
      ...body({ ...first, proofId: `PF-A-${uid()}`, evidenceIds: [first.evidenceId] }),
      citedSettlements: [{ fact, attestation: attest(fact, keyId, signedAt) }],
    }, deps);

    // A DIFFERENT case, a DIFFERENT proof, a FRESH signature over the same money. The attestation
    // verifies perfectly; it is the ARRIVAL that is already spent.
    await expect(approve(APPROVER_CTX, {
      ...body({ ...second, proofId: `PF-B-${uid()}`, evidenceIds: [second.evidenceId] }),
      citedSettlements: [{ fact, attestation: attest(fact, keyId, signedAt) }],
    }, deps)).rejects.toThrow(/SETTLEMENT_ALREADY_COUNTED_BY_ANOTHER_CLAIM|SETTLEMENT_ALREADY/);

    expect(await proofCount(second.caseId)).toBe(0);
    expect(await consumptions(settlementDigest(fact, DIGEST_KEY))).toHaveLength(1);
  }, 90_000);

  it("THE GATE'S READ refuses an already-counted arrival before any claim is attempted", async () => {
    // Named for what it actually proves. This refusal comes from the DIAGNOSIS — the gate's bounded
    // read of which identities already substantiate another claim — and it fires before the transaction
    // is even opened. It is a good refusal and it says NOTHING about transaction placement; the test
    // below is the one that does.
    const boundaryId = `SYNTHETIC-g9read-${uid()}`;
    const owner = await provableCase({ boundaryId });
    const other = await provableCase({ boundaryId, invoiceRef: owner.invoiceRef });
    const { keyId, signedAt } = await activeKeyFor(boundaryId);
    const deps = { env: trustKeysEnv(keyId, boundaryId), payerSource: recordedPayer, digestKey: DIGEST_KEY };

    const taken = factFor(boundaryId, owner.invoiceRef);
    await approve(APPROVER_CTX, {
      ...body({ ...owner, proofId: `PF-OWN-${uid()}`, evidenceIds: [owner.evidenceId] }),
      citedSettlements: [{ fact: taken, attestation: attest(taken, keyId, signedAt) }],
    }, deps);

    await expect(approve(APPROVER_CTX, {
      ...body({ ...other, proofId: `PF-OTHER-${uid()}`, evidenceIds: [other.evidenceId] }),
      citedSettlements: [{ fact: taken, attestation: attest(taken, keyId, signedAt) }],
    }, deps)).rejects.toThrow();
    expect(await proofCount(other.caseId)).toBe(0);
  }, 90_000);

  it("ROLLBACK · a PARTIAL claim is released, which only holds if it shares the proof's transaction", async () => {
    // THE CONTROL FOR THE TRANSACTION PLACEMENT, and my first attempt at it was not one.
    //
    // That version cited an arrival another proof already held — and the GATE'S READ refused it before
    // any claim ran, so the assertion passed whether the claim was inside the transaction or in front
    // of it. Moving the claim out survived the whole file. A test that passes for a reason other than
    // the one it names cannot detect the removal of the mechanism it claims to prove.
    //
    // What is needed is a failure the gate's read CANNOT see, so the claim genuinely starts and then
    // fails partway. The gate checks `seenNonces` — nonces already PERSISTED — and does not look for
    // duplicates WITHIN one request. So two cited facts carrying the same nonce pass the decision, the
    // first is claimed, and the second collides on the single-use index. If the claim shares the
    // proof's transaction the first is released; if it ran ahead of it, the first is consumed forever
    // by an approval that produced no proof.
    const boundaryId = `SYNTHETIC-g9roll-${uid()}`;
    const c = await provableCase({ boundaryId });
    const { keyId, signedAt } = await activeKeyFor(boundaryId);
    const deps = { env: trustKeysEnv(keyId, boundaryId), payerSource: recordedPayer, digestKey: DIGEST_KEY };

    const first = factFor(boundaryId, c.invoiceRef, { amountMinor: 660_000 });
    const second = factFor(boundaryId, c.invoiceRef, { amountMinor: 660_000 });
    const sharedNonce = `nonce-${randomUUID().replace(/-/g, "").slice(0, 20)}`;

    await expect(approve(APPROVER_CTX, {
      ...body({ ...c, proofId: `PF-PART-${uid()}`, evidenceIds: [c.evidenceId] }),
      citedSettlements: [
        { fact: first, attestation: attest(first, keyId, signedAt, BANK.privateKey, sharedNonce) },
        { fact: second, attestation: attest(second, keyId, signedAt, BANK.privateKey, sharedNonce) },
      ],
    }, deps)).rejects.toThrow(/SETTLEMENT_ATTESTATION_REPLAYED/);

    expect(await proofCount(c.caseId)).toBe(0);
    // THE ASSERTION THAT ONLY THE SHARED TRANSACTION CAN SATISFY.
    expect(await consumptions(settlementDigest(first, DIGEST_KEY))).toEqual([]);
    expect(await consumptions(settlementDigest(second, DIGEST_KEY))).toEqual([]);
  }, 90_000);

  it("CONCURRENCY · two simultaneous approvals on one arrival leave exactly one proof and one row", async () => {
    // THE DEFECT THE TRANSACTION PLACEMENT CLOSES. `withGovernedCaseMutation` locks THE CASE, so these
    // two take DIFFERENT locks and never serialise against each other. Only the unique index decides it.
    const boundaryId = `SYNTHETIC-g9race-${uid()}`;
    const a = await provableCase({ boundaryId });
    const b = await provableCase({ boundaryId, invoiceRef: a.invoiceRef });
    const { keyId, signedAt } = await activeKeyFor(boundaryId);
    const fact = factFor(boundaryId, a.invoiceRef);
    const deps = { env: trustKeysEnv(keyId, boundaryId), payerSource: recordedPayer, digestKey: DIGEST_KEY };

    const results = await Promise.allSettled([
      approve(APPROVER_CTX, {
        ...body({ ...a, proofId: `PF-R1-${uid()}`, evidenceIds: [a.evidenceId] }),
        citedSettlements: [{ fact, attestation: attest(fact, keyId, signedAt) }],
      }, deps),
      approve(APPROVER_CTX, {
        ...body({ ...b, proofId: `PF-R2-${uid()}`, evidenceIds: [b.evidenceId] }),
        citedSettlements: [{ fact, attestation: attest(fact, keyId, signedAt) }],
      }, deps),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(await consumptions(settlementDigest(fact, DIGEST_KEY))).toHaveLength(1);
    expect(await proofCount(a.caseId) + await proofCount(b.caseId)).toBe(1);
  }, 120_000);

  it("G10 · DEPENDENCY 1 CLOSED: a SOURCE-ATTESTED payer carries the live route to PROVEN", async () => {
    // THE WHOLE POINT OF THIS SLICE, through the production resolver with no seam substituted. The
    // payer reference was signed by the billing system at evidence ingestion; `attestedPayerReference`
    // reads it back from the verified record; stage 8 compares it against what the BANK signed. Two
    // independent institutional statements, neither of which NH or the customer's team can author.
    const payer = `PAYER-ATTESTED-${uid()}`;
    const c = await provableCase({ attestPayer: payer });
    const { keyId, signedAt } = await activeKeyFor(c.boundaryId);
    const fact = factFor(c.boundaryId, c.invoiceRef, { payerExternalRef: payer });
    const proofId = `PF-${uid()}`;

    const proof = await approve(
      APPROVER_CTX,
      { ...body({ ...c, proofId, evidenceIds: [c.evidenceId] }),
        citedSettlements: [{ fact, attestation: attest(fact, keyId, signedAt) }] },
      // NO `payerSource` — the production resolver runs.
      { env: trustKeysEnv(keyId, c.boundaryId), digestKey: DIGEST_KEY },
    );
    expect(proof.proofId).toBe(proofId);
    expect((await consumptions(settlementDigest(fact, DIGEST_KEY))).map((r) => r.claim_ref)).toEqual([proofId]);
  }, 60_000);

  it("G10 · a bank naming a DIFFERENT payer is refused, even though both are attested", async () => {
    // The control that makes the comparison worth performing. Both statements are signed; they
    // disagree about who paid, and a settlement from another payer cannot substantiate this case.
    const c = await provableCase({ attestPayer: `PAYER-A-${uid()}` });
    const { keyId, signedAt } = await activeKeyFor(c.boundaryId);
    const fact = factFor(c.boundaryId, c.invoiceRef, { payerExternalRef: `PAYER-B-${uid()}` });
    await expect(approve(
      APPROVER_CTX,
      { ...body({ ...c, proofId: `PF-${uid()}`, evidenceIds: [c.evidenceId] }),
        citedSettlements: [{ fact, attestation: attest(fact, keyId, signedAt) }] },
      { env: trustKeysEnv(keyId, c.boundaryId), digestKey: DIGEST_KEY },
    )).rejects.toThrow(/SETTLEMENT_PAYER_MISMATCH/);
    expect(await proofCount(c.caseId)).toBe(0);
  }, 60_000);

  it("G10 · a case whose evidence carries NO attested payer still refuses — absence is the safe state", async () => {
    const c = await provableCase(); // no attestPayer
    const { keyId, signedAt } = await activeKeyFor(c.boundaryId);
    const fact = factFor(c.boundaryId, c.invoiceRef);
    await expect(approve(
      APPROVER_CTX,
      { ...body({ ...c, proofId: `PF-${uid()}`, evidenceIds: [c.evidenceId] }),
        citedSettlements: [{ fact, attestation: attest(fact, keyId, signedAt) }] },
      { env: trustKeysEnv(keyId, c.boundaryId), digestKey: DIGEST_KEY },
    )).rejects.toThrow(/SETTLEMENT_CASE_PAYER_NOT_RECORDED/);
    expect(await proofCount(c.caseId)).toBe(0);
  }, 60_000);

  it("G10 · TWO ATTESTED PAYERS THAT DISAGREE establish nothing — NH does not pick one", async () => {
    // Which payer a case concerns is an identity question. Choosing the earliest, the latest or the
    // correction's would be NH deciding it on an arbitrary rule, so the resolver returns nothing and
    // the approval refuses for the ordinary reason.
    const c = await provableCase({ attestPayer: `PAYER-ONE-${uid()}` });
    const second = await app.inject({
      method: "POST", url: `/cases/${c.caseId}/evidence`, headers: AUTHOR,
      payload: attestFixture(c.caseId, {
        evidenceId: `EV-SUP-${uid()}`, sourceSystem: "billing", sourceRecordId: `OTHER-${uid()}`,
        evidenceType: "credit_note_issued", observedAt: "2026-07-25T00:00:00.000Z",
        payerExternalRef: `PAYER-TWO-${uid()}`,
      }),
    });
    expect(second.statusCode, second.body.slice(0, 300)).toBe(201);

    const problems: string[] = [];
    const resolved = await attestedPayerReference((code) => problems.push(code))
      .payerExternalRefFor({ recoveryCaseId: c.caseId, boundaryId: c.boundaryId });
    expect(resolved).toBeNull();
    expect(problems).toEqual(["PAYER_REFERENCES_DISAGREE"]);
  }, 60_000);

  it("G10 · a persisted evidence row has NO top-level payer field — the only one is inside the receipt", async () => {
    // THE STRUCTURAL CLAIM, ASSERTED RATHER THAN DESCRIBED. A mutation that made the resolver read a
    // payer from the evidence row itself changed nothing, and that is the property holding rather than
    // a guard missing: there is no such field to read. This fails the day one is added, which is when
    // the "only inside a verified receipt" rule would quietly stop being structural.
    const payer = `PAYER-SHAPE-${uid()}`;
    const c = await provableCase({ attestPayer: payer });
    const [row] = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT * FROM "EvidenceRecord" WHERE "recoveryCaseId" = $1 AND "evidenceType" = $2`,
      c.caseId, "corrective_invoice_issued",
    );
    expect(row).toBeDefined();
    for (const key of Object.keys(row!)) {
      expect(key.toLowerCase(), `a top-level payer column exists: ${key}`).not.toContain("payer");
    }
    // And the value IS there, inside the verification object the signature produced.
    expect((row!.sourceVerification as { attestedPayerExternalRef?: string }).attestedPayerExternalRef)
      .toBe(payer);
  }, 60_000);

  it("G10 · an UNSIGNED claim carrying a payer contributes nothing, so it cannot be a comparison target", async () => {
    // The structural half. `attestedPayerExternalRef` lives inside `sourceVerification`, which exists
    // only after a signature verified — so a caller who posts the field without an attestation creates
    // an evidence record with no verification and no payer at all.
    const c = await provableCase();
    const res = await app.inject({
      method: "POST", url: `/cases/${c.caseId}/evidence`, headers: AUTHOR,
      payload: {
        evidenceId: `EV-UNSIGNED-${uid()}`, sourceSystem: "manual", sourceRecordId: `M-${uid()}`,
        evidenceType: "note", observedAt: "2026-07-25T00:00:00.000Z",
        payerExternalRef: "PAYER-SELF-ASSERTED",
      },
    });
    expect(res.statusCode, res.body.slice(0, 300)).toBe(201);
    expect(await attestedPayerReference()
      .payerExternalRefFor({ recoveryCaseId: c.caseId, boundaryId: c.boundaryId })).toBeNull();
  }, 60_000);

  it("the digest stored is the KEYED pseudonym, so the ledger holds no confirmable payment identifier", async () => {
    const c = await provableCase();
    const { keyId, signedAt } = await activeKeyFor(c.boundaryId);
    const fact = factFor(c.boundaryId, c.invoiceRef);
    const proofId = `PF-${uid()}`;
    await approve(
      APPROVER_CTX,
      { ...body({ ...c, proofId, evidenceIds: [c.evidenceId] }),
        citedSettlements: [{ fact, attestation: attest(fact, keyId, signedAt) }] },
      { env: trustKeysEnv(keyId, c.boundaryId), payerSource: recordedPayer, digestKey: DIGEST_KEY },
    );
    const [row] = await prisma.$queryRawUnsafe<{ settlement_digest: string; digest_key_fingerprint: string }[]>(
      `SELECT "settlement_digest","digest_key_fingerprint" FROM "settlement_consumptions"
         WHERE "claim_ref" = $1`, proofId,
    );
    expect(row!.settlement_digest).toMatch(/^hmac-sha256:[a-f0-9]{64}$/);
    // And emphatically not the reference itself, nor a bare hash of it.
    expect(row!.settlement_digest).not.toContain(fact.externalSettlementRef);
    expect(row!.digest_key_fingerprint).toMatch(/^hmac-sha256:[a-f0-9]{32}$/);
    expect(row!.digest_key_fingerprint).not.toContain(DIGEST_KEY);
    void createHmac; // the keying lives in the store; this asserts its OUTPUT, not its implementation
  }, 60_000);
});

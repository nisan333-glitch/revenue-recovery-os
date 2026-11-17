import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { generateKeyPairSync, sign } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  runExternalSettlementGate,
  settlementRefusal,
  type SettlementLedger,
} from "./externalSettlementGate";
import { SettlementVerifier, settlementSigningPayload, type SettlementTrustKey } from "./settlementVerification";
import { settlementIdentity, type ExternalSettlementFact } from "../../src/domain/externalSettlement";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const PEM = publicKey.export({ type: "spki", format: "pem" }).toString();

const FACT: ExternalSettlementFact = Object.freeze({
  boundaryId: "b-alpha",
  sourceSystem: "acme-bank",
  sourceKind: "bank",
  externalSettlementRef: "CR-99001",
  finality: "BANK_CREDITED",
  amountMinor: 550000,
  currency: "USD",
  valueDate: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  correctiveInvoiceRef: "CN-9120",
  payerExternalRef: "PAYER-7781",
});

const KEYS: SettlementTrustKey[] = [
  { keyId: "k-bank", boundaryId: "b-alpha", sourceSystem: "acme-bank", sourceKind: "bank", publicKey: PEM },
];

const cite = (fact = FACT, nonce = "nonce-aaaaaaaaaaaaaaaa") => {
  const issuedAt = new Date().toISOString();
  return {
    fact,
    attestation: {
      keyId: "k-bank", issuedAt, nonce,
      signature: sign(null, settlementSigningPayload(fact, nonce, issuedAt), privateKey).toString("base64"),
    },
  };
};

// THE FAKE MOVED WITH THE PORT, AND IT IS NOW CLAIM-AWARE AND BOUNDED. G5 reshaped `SettlementLedger`
// because the stage-8 shape had two defects: it had no notion of WHICH claim was asking, so an
// idempotent retry read as a double count, and it returned a whole tenant's history for the caller to
// scan. Both questions are now asked about exactly the values cited in the request.
const ledger = (seen: string[] = [], used: string[] = []) => ({
  nonceAlreadyUsed: vi.fn(async (_b: string, nonces: readonly string[]) =>
    nonces.filter((x) => seen.includes(x))),
  identitiesSubstantiatingOtherClaims: vi.fn(async (
    _b: string, _claimRef: string, identities: readonly string[],
  ) => identities.filter((x) => used.includes(x))),
}) satisfies SettlementLedger & { nonceAlreadyUsed: ReturnType<typeof vi.fn> };

const INPUT = {
  enabled: true,
  boundaryId: "b-alpha",
  claimedCollectedMinor: 550000,
  currency: "USD",
  caseCorrectiveInvoiceRef: "CN-9120",
  casePayerExternalRef: "PAYER-7781",
  correctionRaisedAt: new Date(Date.now() - 10 * 86_400_000).toISOString(),
  // REQUIRED, not optional: without it the ledger cannot tell a retry from a double count, and an
  // optional field would let an existing caller keep the claim-blind behaviour by saying nothing.
  claimRef: "claim-under-test",
  cited: [cite()],
};

describe("stage 8 · the gate end to end on signed synthetic data", () => {
  it("verifies and accepts, returning one receipt per cited settlement", async () => {
    const out = await runExternalSettlementGate(INPUT, new SettlementVerifier(KEYS), ledger());
    expect(out.verdict.sufficient).toBe(true);
    if (!out.verdict.sufficient) throw new Error("unreachable");
    expect(out.verdict.settledMinor).toBe(550000);
    expect(out.verdict.causationEstablished).toBe(false);
    expect(out.receipts).toHaveLength(1);
    expect(out.receipts[0]!.scheme).toBe("nh-settlement-v1");
  });

  // A DISABLED BUILD MUST DO NO WORK AND TOUCH NO STATE — not merely reach the same verdict.
  it("with the flag off, refuses by name and reads NOTHING from the ledger", async () => {
    const l = ledger();
    const out = await runExternalSettlementGate({ ...INPUT, enabled: false }, new SettlementVerifier(KEYS), l);
    expect(out.verdict).toMatchObject({ sufficient: false, code: "EXTERNAL_SETTLEMENT_NOT_ENABLED" });
    expect(out.receipts).toEqual([]);
    expect(l.nonceAlreadyUsed).not.toHaveBeenCalled();
    expect(l.identitiesSubstantiatingOtherClaims).not.toHaveBeenCalled();
  });

  it("throws on a forged attestation BEFORE any arithmetic or ledger read", async () => {
    const other = generateKeyPairSync("ed25519");
    const forged = cite();
    const issuedAt = forged.attestation.issuedAt;
    forged.attestation = {
      ...forged.attestation,
      signature: sign(null, settlementSigningPayload(FACT, "nonce-aaaaaaaaaaaaaaaa", issuedAt),
        other.privateKey).toString("base64"),
    };
    const l = ledger();
    await expect(runExternalSettlementGate({ ...INPUT, cited: [forged] }, new SettlementVerifier(KEYS), l))
      .rejects.toThrow(/does not verify/);
    expect(l.nonceAlreadyUsed).not.toHaveBeenCalled();
  });

  it("refuses a replayed nonce the ledger already holds", async () => {
    const out = await runExternalSettlementGate(
      INPUT, new SettlementVerifier(KEYS), ledger(["nonce-aaaaaaaaaaaaaaaa"]),
    );
    expect(out.verdict).toMatchObject({ sufficient: false, code: "SETTLEMENT_ATTESTATION_REPLAYED" });
  });

  it("refuses a settlement the ledger says already substantiates another claim", async () => {
    const out = await runExternalSettlementGate(
      INPUT, new SettlementVerifier(KEYS), ledger([], [settlementIdentity(FACT)]),
    );
    expect(out.verdict).toMatchObject({ sufficient: false, code: "SETTLEMENT_ALREADY_SUBSTANTIATED" });
  });

  it("re-checks the tenant in the pure core even though the key binding already did", async () => {
    // Both guards must hold independently: a decision that depends on an upstream guard having run is
    // a decision that breaks silently when the call order changes.
    const out = await runExternalSettlementGate(
      { ...INPUT, boundaryId: "b-beta" }, new SettlementVerifier(KEYS), ledger(),
    );
    expect(out.verdict).toMatchObject({ sufficient: false, code: "SETTLEMENT_TENANT_MISMATCH" });
  });

  it("renders a refusal that names its code, and nothing for a sufficient verdict", async () => {
    const bad = await runExternalSettlementGate(
      INPUT, new SettlementVerifier(KEYS), ledger(["nonce-aaaaaaaaaaaaaaaa"]),
    );
    const error = settlementRefusal(bad.verdict);
    expect(error?.message).toContain("SETTLEMENT_ATTESTATION_REPLAYED");
    expect(error?.message).toContain("PROVEN requires externally attested settlement");
    const good = await runExternalSettlementGate(INPUT, new SettlementVerifier(KEYS), ledger());
    expect(settlementRefusal(good.verdict)).toBeNull();
  });

  it("never echoes an external reference or an amount in the refusal message", async () => {
    const bad = await runExternalSettlementGate(
      { ...INPUT, caseCorrectiveInvoiceRef: "CN-OTHER" }, new SettlementVerifier(KEYS), ledger(),
    );
    const message = settlementRefusal(bad.verdict)!.message;
    for (const secret of ["CR-99001", "PAYER-7781", "CN-9120", "550000"]) {
      expect(message).not.toContain(secret);
    }
  });
});

// G4 · THE GUARD MOVED WITH ITS CONSUMER, EXACTLY AS ITS OWN COMMENT INSTRUCTED.
//
// Stage 8 shipped this as "NO production importer", because the mechanism was complete and deliberately
// unwired, and the module said: *it must MOVE WITH ITS CONSUMER when the schema slice lands, never be
// deleted*. G4 is that consumer — `registerBackedSettlementVerification.ts` resolves a key from the
// governed register and verifies against it — so the guard is NARROWED TO THE PROPERTY IT WAS
// PROTECTING rather than dropped. That is the same treatment the expectation-extract importer guard
// got when its own consumer shipped.
//
// AND IT IS NOW STRICTLY STRONGER THAN BEFORE. The permitted set is CLOSED and asserted in both
// directions: exactly these four files may import the settlement modules, and the monetary, proof and
// reconciliation surfaces are named and asserted to reach none of them. "Nobody imports it" was only
// ever a proxy for "the money path does not"; this says the real thing.
describe("stage 8 / G4 · who may import the settlement modules, in both directions", () => {
  const MODULES = ["externalSettlement", "settlementVerification", "externalSettlementGate"];
  const PERMITTED = new Set([
    "server/services/settlementVerification.ts",
    "server/services/externalSettlementGate.ts",
    "server/services/registerBackedSettlementVerification.ts",
    // G5 · the durable ledger. It imports `settlementIdentity` to digest an arrival, and the port's
    // TYPE (a type-only dynamic import) to implement it. Added DELIBERATELY, which is what a closed
    // permitted set is for: the guard refused it first, and that refusal is the mechanism working.
    "server/persistence/settlementLedgerStore.ts",
    // G7 · the atomic claim. It is itself a settlement module — it imports the fact type and the
    // receipt type to pair them — and it is the seam where an arrival is CONSUMED. Added deliberately,
    // for the third time, which is exactly what a closed set is for: the guard refused it first.
    "server/services/settlementClaim.ts",
    // G9 · THE LIVE APPROVAL ROUTE. The guard refused it first and that refusal was the mechanism
    // working — stage 8's own header said this entry "must MOVE WITH ITS CONSUMER when the schema
    // slice lands, never be deleted", and `proofService` is now that consumer: it verifies cited
    // attestations against the governed register, decides sufficiency, and claims the arrivals inside
    // the proof's transaction. Added on the owner's authorisation, not by loosening a failing test.
    "server/services/proofService.ts",
    "src/domain/externalSettlement.ts",
  ]);
  // The surfaces that must NOT reach a settlement module. A proof minted from an unwired mechanism
  // would be a proof resting on a gate nothing enforces.
  //
  // WHAT THIS LIST PROTECTS NOW THAT `proofService` IS WIRED, and it is a STRONGER property than the
  // one it replaced. "Nobody imports it" was a proxy for "the money path does not reach an unwired
  // mechanism"; the mechanism is wired, so the proxy is spent. What must still hold is that THE PURE
  // KERNEL DOES NOT DEPEND ON IT: `invariants`, `approval`, `outcomeEvidence` and `metrics` decide
  // what Revenue Returned IS, and a kernel that reached a settlement module would make the ledger's
  // definition of money conditional on an external attestation mechanism being present. The
  // orchestration may cite a settlement; the arithmetic may not know one exists.
  //
  // `proofService.ts` is deliberately NO LONGER here, and the behavioural half of what it used to
  // guarantee moved to `proofServiceSettlement.postgres.test.ts`: citing a settlement can only ever
  // REFUSE, never relax, and omitting the field leaves the approval byte-for-byte as it was.
  const FORBIDDEN_CONSUMERS = [
    "src/domain/invariants.ts",
    "src/domain/metrics.ts",
    "src/domain/outcomeEvidence.ts",
    "src/domain/approval.ts",
    "src/benchmark/reconciliationCore.ts",
  ];

  const walk = (dir: string, out: string[] = []): string[] => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === "dist" || name === "dist-server" || name.startsWith(".")) continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
    }
    return out;
  };

  // IMPORT SPECIFIERS ONLY. A term is not a claim, a prose mention is not an import, and a string
  // literal is not a dependency — the lesson this repository has recorded eleven times, and the reason
  // this guard does not simply grep for the module names.
  const importers = () => {
    const hits: string[] = [];
    for (const dir of ["src", "server", "scripts", "e2e"]) {
      let files: string[];
      try { files = walk(resolve(REPO, dir)); } catch { continue; }
      for (const file of files) {
        const rel = file.slice(REPO.length + 1);
        if (PERMITTED.has(rel)) continue;
        const source = readFileSync(file, "utf8");
        for (const m of source.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
          const spec = m[1]!;
          if (MODULES.some((mod) => spec === mod || spec.endsWith(`/${mod}`))) hits.push(`${rel} → ${spec}`);
        }
      }
    }
    return hits;
  };

  it("is imported ONLY by the named files, and the set stays closed", () => {
    // Every importer outside the permitted set is reported. The set is closed: a new consumer must be
    // added here deliberately, which is the point — an import that reaches the money path should
    // require someone to write it down.
    expect(importers()).toEqual([]);
  });

  it("is reached by NO monetary, proof or reconciliation surface", () => {
    // THE PROPERTY THE ORIGINAL "nobody imports it" WAS A PROXY FOR. G4 wires verification to the
    // register; it does NOT wire the result into the PROVEN gate, and the two remaining schema
    // dependencies — an external payer reference on the case, and a persisted settlement ledger —
    // still do not exist. A gate that read fabricated inputs would report enforcement that is not
    // happening.
    const offenders: string[] = [];
    for (const rel of FORBIDDEN_CONSUMERS) {
      let source: string;
      try { source = readFileSync(resolve(REPO, rel), "utf8"); } catch { continue; }
      for (const m of source.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
        const spec = m[1]!;
        if (MODULES.some((mod) => spec === mod || spec.endsWith(`/${mod}`))) offenders.push(`${rel} → ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("names every forbidden consumer as a file that actually exists, so the list cannot rot", () => {
    // A guard listing files that are gone checks nothing. Found the hard way elsewhere in this
    // repository: a structural guard must be asserted to have a subject.
    for (const rel of FORBIDDEN_CONSUMERS) {
      expect(existsSync(resolve(REPO, rel)), rel).toBe(true);
    }
  });

  it("fires on a real importer, so the guard is not vacuous", () => {
    // The positive half: prove the matcher recognises the very shape it is meant to forbid.
    const probe = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;
    const sample = 'import { x } from "./externalSettlementGate";';
    const found = [...sample.matchAll(probe)].map((m) => m[1]!);
    expect(found.some((s) => MODULES.some((mod) => s.endsWith(`/${mod}`)))).toBe(true);
  });

  it("does not mistake a prose mention or a string literal for a dependency", () => {
    const probe = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;
    for (const sample of [
      "// see externalSettlementGate for the composition",
      'const path = resolve(HERE, "externalSettlementGate.ts");',
    ]) {
      const found = [...sample.matchAll(probe)].map((m) => m[1]!);
      expect(found.some((s) => MODULES.some((mod) => s.endsWith(`/${mod}`) || s === mod))).toBe(false);
    }
  });

  it("names the two dependencies in the module, so the absence has a stated reason", () => {
    const source = readFileSync(resolve(HERE, "externalSettlementGate.ts"), "utf8");
    expect(source).toContain("AN EXTERNAL PAYER REFERENCE ON THE CASE");
    expect(source).toContain("A SETTLEMENT LEDGER");
    // The guard must MOVE WITH ITS CONSUMER when the schema slice lands, never be deleted.
    expect(source).toContain("MOVE WITH ITS CONSUMER");
  });
});

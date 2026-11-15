import { readFileSync, readdirSync, statSync } from "node:fs";
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

const ledger = (seen: string[] = [], used: string[] = []) => ({
  seenNonces: vi.fn(async () => seen),
  identitiesAlreadySubstantiating: vi.fn(async () => used),
}) satisfies SettlementLedger & { seenNonces: ReturnType<typeof vi.fn> };

const INPUT = {
  enabled: true,
  boundaryId: "b-alpha",
  claimedCollectedMinor: 550000,
  currency: "USD",
  caseCorrectiveInvoiceRef: "CN-9120",
  casePayerExternalRef: "PAYER-7781",
  correctionRaisedAt: new Date(Date.now() - 10 * 86_400_000).toISOString(),
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
    expect(l.seenNonces).not.toHaveBeenCalled();
    expect(l.identitiesAlreadySubstantiating).not.toHaveBeenCalled();
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
    expect(l.seenNonces).not.toHaveBeenCalled();
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

describe("stage 8 · the deliberate absence of a production consumer", () => {
  const MODULES = ["externalSettlement", "settlementVerification", "externalSettlementGate"];
  const PERMITTED = new Set([
    "server/services/settlementVerification.ts",
    "server/services/externalSettlementGate.ts",
    "src/domain/externalSettlement.ts",
  ]);

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

  it("has NO production importer, because the two schema dependencies do not exist yet", () => {
    // Wiring this into the live gate today would mean passing values nothing authoritative supplies —
    // an external payer reference on the case, and a persisted settlement ledger. A gate that reads
    // fabricated inputs reports enforcement that is not happening.
    expect(importers()).toEqual([]);
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

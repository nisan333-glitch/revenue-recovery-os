// THE CONTRACT IS CHECKED AGAINST THE CODE THAT WILL JUDGE THE CUSTOMER'S FILE, NEVER BESIDE IT.
//
// Everything here exists because the repository has already been bitten by the alternative: a
// customer-facing document whose claims were authored next to the code rather than derived from it,
// and which contradicted the validator three sections later. So this suite parses the real payload
// interfaces and the real refusal union out of their own source files. A renamed field, a dropped
// refusal code or a fact asked for that nothing reads all fail here.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  BANK_FIELDS_NOT_REQUESTED,
  PAYER_AGREEMENT_DEPENDENCY,
  PILOT_PAYER_CONTRACT_FIELDS,
  PILOT_PAYER_CONTRACT_VERSION,
  citedRefusalCodes,
  requiredPayloadFields,
  sharedFacts,
  type ContractSide,
} from "./pilotPayerContract";

const read = (p: string) => readFileSync(resolve(__dirname, p), "utf8");

/** Field names declared on an interface, parsed from source rather than hand-listed. */
function interfaceFields(source: string, name: string): readonly string[] {
  const start = source.indexOf(`interface ${name} {`);
  expect(start, `interface ${name} not found`).toBeGreaterThan(-1);
  const open = source.indexOf("{", start);
  let depth = 0;
  let end = -1;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  expect(end, `interface ${name} is unterminated`).toBeGreaterThan(open);
  const body = source
    .slice(open + 1, end)
    // Comments first: a field name inside prose is not a field.
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  const names = [...body.matchAll(/(?:^|;)\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*\??\s*:/gm)].map(
    (m) => m[1]!,
  );
  expect(names.length, `no fields parsed from ${name}`).toBeGreaterThan(0);
  return names;
}

/** Members of a string-literal union type, parsed from source. */
function unionMembers(source: string, name: string): readonly string[] {
  const start = source.indexOf(`export type ${name} =`);
  expect(start, `type ${name} not found`).toBeGreaterThan(-1);
  const end = source.indexOf(";", start);
  const body = source
    .slice(start, end)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  const members = [...body.matchAll(/"([A-Z][A-Z0-9_]*)"/g)].map((m) => m[1]!);
  expect(members.length, `no members parsed from ${name}`).toBeGreaterThan(0);
  return members;
}

const settlementSource = read("../domain/externalSettlement.ts");
const claimSource = read("../../server/services/sourceVerification.ts");

describe("the parsers themselves", () => {
  // A STRUCTURAL GUARD THAT CANNOT FIRE IS NOT A WEAKER GUARD, IT IS NO GUARD. Both helpers are
  // regex over source, so each is exercised on a known answer before anything is believed.
  it("parses fields and ignores names that appear only in comments", () => {
    const fields = interfaceFields(settlementSource, "ExternalSettlementFact");
    expect(fields).toContain("payerExternalRef");
    expect(fields).toContain("valueDate");
    // `ExternalSettlementFact`'s own doc comments mention `payerRef` and `amountMinor` in prose; the
    // first is not a field and must not be parsed as one.
    expect(fields).not.toContain("payerRef");
  });

  it("parses a union and finds a member known to be there", () => {
    expect(unionMembers(settlementSource, "ExternalSettlementRefusal")).toContain(
      "SETTLEMENT_PAYER_MISMATCH",
    );
  });

  it("fails loudly on a name that does not exist, rather than returning nothing", () => {
    expect(() => interfaceFields(settlementSource, "NoSuchInterface")).toThrow();
    expect(() => unionMembers(settlementSource, "NoSuchUnion")).toThrow();
  });
});

describe("every requested field exists in the payload NH verifies", () => {
  it("BANK fields are all fields of ExternalSettlementFact", () => {
    const real = new Set(interfaceFields(settlementSource, "ExternalSettlementFact"));
    for (const f of PILOT_PAYER_CONTRACT_FIELDS.filter((x) => x.side === "BANK")) {
      for (const p of f.payloadFields) {
        expect(real.has(p), `${f.fact}: no such field \`${p}\` on ExternalSettlementFact`).toBe(true);
      }
    }
  });

  it("BILLING fields are all fields of EvidenceClaim", () => {
    const real = new Set(interfaceFields(claimSource, "EvidenceClaim"));
    for (const f of PILOT_PAYER_CONTRACT_FIELDS.filter((x) => x.side === "BILLING")) {
      for (const p of f.payloadFields) {
        expect(real.has(p), `${f.fact}: no such field \`${p}\` on EvidenceClaim`).toBe(true);
      }
    }
  });
});

describe("no field of the signed settlement payload is silently unaccounted for", () => {
  // NOT ASKED FOR BY DECISION and FORGOTTEN are identical to a diff, which is why every field must
  // land in exactly one of the two lists.
  it("every ExternalSettlementFact field is either requested or explicitly not requested", () => {
    const real = interfaceFields(settlementSource, "ExternalSettlementFact");
    const requested = new Set(requiredPayloadFields("BANK"));
    const excused = new Set(Object.keys(BANK_FIELDS_NOT_REQUESTED));
    for (const field of real) {
      const inOne = (requested.has(field) ? 1 : 0) + (excused.has(field) ? 1 : 0);
      expect(
        inOne,
        `\`${field}\` must be requested from the bank or listed in BANK_FIELDS_NOT_REQUESTED with a ` +
          "reason — exactly one of the two",
      ).toBe(1);
    }
  });

  it("nothing is excused that is not actually a field", () => {
    const real = new Set(interfaceFields(settlementSource, "ExternalSettlementFact"));
    for (const field of Object.keys(BANK_FIELDS_NOT_REQUESTED)) {
      expect(real.has(field), `BANK_FIELDS_NOT_REQUESTED names \`${field}\`, which does not exist`).toBe(
        true,
      );
    }
  });

  it("every excusal carries a reason, not a blank", () => {
    for (const [field, why] of Object.entries(BANK_FIELDS_NOT_REQUESTED)) {
      expect(why.trim().length, `${field} is excused with no reason`).toBeGreaterThan(40);
    }
  });
});

describe("every refusal code the contract quotes is one the code can actually answer with", () => {
  it("each cited code exists in a refusal union somewhere in the judging path", () => {
    const known = new Set<string>([
      ...unionMembers(settlementSource, "ExternalSettlementRefusal"),
      ...unionMembers(
        read("../../server/services/caseSettlementContext.ts"),
        "CaseSettlementContextRefusal",
      ),
      ...unionMembers(read("./settlementKeyLifecycle.ts"), "KeyValidityRefusal"),
      ...unionMembers(
        read("../../server/services/registerBackedSettlementVerification.ts"),
        "RegisterVerificationRefusal",
      ),
      // The claim-time refusals live on the store's own result type.
      ...[
        ...read("../../server/services/settlementClaim.ts").matchAll(/"(SETTLEMENT_[A-Z_]+)"/g),
      ].map((m) => m[1]!),
    ]);
    for (const code of citedRefusalCodes()) {
      expect(known.has(code), `the contract cites ${code}, which no judging module declares`).toBe(true);
    }
  });

  it("the payer-mismatch and no-payer refusals the dependency names are both real", () => {
    const known = new Set([
      ...unionMembers(settlementSource, "ExternalSettlementRefusal"),
      ...unionMembers(
        read("../../server/services/caseSettlementContext.ts"),
        "CaseSettlementContextRefusal",
      ),
    ]);
    expect(known.has("SETTLEMENT_PAYER_MISMATCH")).toBe(true);
    expect(known.has("SETTLEMENT_CASE_PAYER_NOT_RECORDED")).toBe(true);
    for (const code of ["SETTLEMENT_PAYER_MISMATCH", "SETTLEMENT_CASE_PAYER_NOT_RECORDED"]) {
      expect(PAYER_AGREEMENT_DEPENDENCY.blocksUntilAgreed).toContain(code);
    }
  });
});

describe("the shared fact is derived, not asserted", () => {
  it("the payer reference is the one fact both sides must supply with the same value", () => {
    expect(sharedFacts()).toEqual(["payer reference"]);
  });

  it("both sides' payer reference occupies the same payload field name", () => {
    const entries = PILOT_PAYER_CONTRACT_FIELDS.filter((f) => f.fact === "payer reference");
    expect(entries).toHaveLength(2);
    for (const e of entries) expect(e.payloadFields).toEqual(["payerExternalRef"]);
  });
});

describe("the contract is well formed and names an owner for everything", () => {
  it("every entry carries a reader, an owner, a refusal and a consequence", () => {
    for (const f of PILOT_PAYER_CONTRACT_FIELDS) {
      expect(f.readBy.length, `${f.side} ${f.fact} is read by nothing`).toBeGreaterThan(0);
      expect(f.ownedBy.trim().length, `${f.side} ${f.fact} has no owner`).toBeGreaterThan(5);
      expect(f.refusals.length, `${f.side} ${f.fact} names no refusal`).toBeGreaterThan(0);
      expect(f.onAbsence.trim().length, `${f.side} ${f.fact} has no stated consequence`).toBeGreaterThan(
        40,
      );
      expect(f.whatItIs.trim().length).toBeGreaterThan(20);
    }
  });

  it("no two entries describe the same fact on the same side", () => {
    const seen = new Set<string>();
    for (const f of PILOT_PAYER_CONTRACT_FIELDS) {
      const key = `${f.side}::${f.fact}`;
      expect(seen.has(key), `duplicate entry ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it("both sides are actually asked for something", () => {
    for (const side of ["BILLING", "BANK"] as ContractSide[]) {
      expect(
        PILOT_PAYER_CONTRACT_FIELDS.some((f) => f.side === side && f.tier === "REQUIRED"),
        `${side} is asked for nothing`,
      ).toBe(true);
    }
  });

  it("the version is pinned, so a change in what a customer must supply cannot pass silently", () => {
    expect(PILOT_PAYER_CONTRACT_VERSION).toBe("payer-contract-2026.1");
  });
});

describe("the contract carries no money and promises no number", () => {
  // A DATA REQUEST CONTAINS NO MONEY. Quoting an uplift from synthetic data would read to a customer
  // as a forecast for their own book — the pilot package's own rule, applied one layer in.
  const text = JSON.stringify({
    fields: PILOT_PAYER_CONTRACT_FIELDS,
    dependency: PAYER_AGREEMENT_DEPENDENCY,
    excused: BANK_FIELDS_NOT_REQUESTED,
  });

  it("states no currency amount", () => {
    expect(text).not.toMatch(/[$€£]\s?\d/);
    expect(text).not.toMatch(/\b\d+[,.]\d{2}\b/);
  });

  it("states no uplift or recovery percentage", () => {
    expect(text).not.toMatch(/\d+(?:\.\d+)?\s?%/);
  });

  it("never claims the payer agreement is in place", () => {
    expect(PAYER_AGREEMENT_DEPENDENCY.neverPresentedAsVerified).toBe(true);
    // The whole point: it is stated as OPEN and owned by the customer, never as satisfied.
    expect(PAYER_AGREEMENT_DEPENDENCY.ownedBy).toMatch(/customer/i);
    expect(text).not.toMatch(/payer (reference|identifier) (is|has been) (verified|agreed|confirmed)/i);
  });
});

describe("a signature is never presented as establishing authority", () => {
  // THE CENTRAL K5 RULE, and the one a customer-facing document is most likely to blur: a bank's
  // signature verifies, so it is tempting to write that the bank is verified.
  it("the attestation entry says in terms that control of a key is not identity", () => {
    const attestation = PILOT_PAYER_CONTRACT_FIELDS.find((f) => f.fact.startsWith("attestation envelope"));
    expect(attestation).toBeDefined();
    expect(attestation!.onAbsence).toMatch(/PROVES CONTROL OF A REGISTERED KEY AND NOTHING ABOUT WHO/);
    expect(attestation!.onAbsence).toMatch(/established separately/);
  });
});

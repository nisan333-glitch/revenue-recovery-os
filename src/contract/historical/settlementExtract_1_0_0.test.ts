// THE SUCCESSION PROOF for nh.settlement-extract@1.0.0 → nh.billing-extract@1.0.0.
//
// The owner approved a RENAME and required that the semantics not move. "The semantics did not move" is
// a claim, and a comment asserting it proves nothing — so this file DERIVES it: it walks both
// declarations and both code catalogues and shows that the whole difference between them is two column
// names and one prefix. If anyone ever changes a tier, a meaning, a capability, an owner or a severity
// while calling it a rename, these tests fail.
//
// It is also the only module in the repository permitted to import the historical declaration. That is
// asserted here in BOTH directions, because a guard that cannot tell *correctly inert* from *not wired
// up* was the exact defect the obligation_ref revert exposed.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  SETTLEMENT_EXTRACT_CLAIM_BOUNDARY, SETTLEMENT_EXTRACT_FIELDS, SETTLEMENT_EXTRACT_REF,
  SETTLEMENT_EXTRACT_SCHEME, SETTLEMENT_EXTRACT_STATUS, SETTLEMENT_EXTRACT_COLUMNS,
  SETTLEMENT_REQUIRED_COLUMNS, SETTLEMENT_STOPPED_FIELDS, SETTLEMENT_EVENT_DEFINITION,
} from "./settlementExtract_1_0_0";
import { ALL_SETTLEMENT_CODES } from "./settlementExtractCodes_1_0_0";
import {
  BILLING_EVENT_DEFINITION, BILLING_EXTRACT_CLAIM_BOUNDARY, BILLING_EXTRACT_COLUMNS,
  BILLING_EXTRACT_FIELDS, BILLING_EXTRACT_REF, BILLING_EXTRACT_SCHEME, BILLING_REQUIRED_COLUMNS,
  BILLING_STOPPED_FIELDS,
} from "../billingExtract";
import { ALL_BILLING_CODES } from "../billingExtractCodes";

const RENAME = SETTLEMENT_EXTRACT_STATUS.renameMap as Readonly<Record<string, string>>;
const rename = (c: string): string => RENAME[c] ?? c;

describe("nh.settlement-extract@1.0.0 · retired, preserved, and inspectable", () => {
  it("declares itself HISTORICAL, with the succession recorded as a link rather than a version number", () => {
    expect(SETTLEMENT_EXTRACT_REF).toBe("nh.settlement-extract@1.0.0");
    expect(SETTLEMENT_EXTRACT_SCHEME).toBe("nh-settlement-extract-v1");
    expect(SETTLEMENT_EXTRACT_STATUS.state).toBe("RETIRED");
    expect(SETTLEMENT_EXTRACT_STATUS.supersededBy).toBe(BILLING_EXTRACT_REF);
    // The successor is 1.0.0 under a NEW id, not 2.0.0 under the old one. Semver is scoped to an id, and
    // a 2.0.0 here would assert a 1.0.0 under `nh.billing-extract` that never existed.
    expect(BILLING_EXTRACT_REF).toBe("nh.billing-extract@1.0.0");
    expect(SETTLEMENT_EXTRACT_STATUS.semanticsChanged).toBe(false);
    expect(SETTLEMENT_EXTRACT_STATUS.reachedACustomer).toBe(false);
    // A change to the extract's SHAPE is a new scheme id, never a silent re-reading of the old one, so
    // the two schemes must differ even though the meaning behind them does not.
    expect(BILLING_EXTRACT_SCHEME).toBe("nh-billing-extract-v1");
    expect(BILLING_EXTRACT_SCHEME).not.toBe(SETTLEMENT_EXTRACT_SCHEME);
  });

  it("still carries the retired names — it is the record of them, so it must not be 'fixed'", () => {
    expect(SETTLEMENT_EXTRACT_COLUMNS).toContain("settled_at");
    expect(SETTLEMENT_EXTRACT_COLUMNS).toContain("settled_amount");
    expect(Object.keys(RENAME).sort()).toEqual(["settled_amount", "settled_at"]);
    expect(Object.values(RENAME).sort()).toEqual(["invoice_line_amount", "invoice_raised_at"]);
  });

  it("the whole difference in the COLUMN SET is the rename map — applied, it reproduces the successor", () => {
    expect(SETTLEMENT_EXTRACT_COLUMNS.map(rename)).toEqual([...BILLING_EXTRACT_COLUMNS]);
    expect(SETTLEMENT_REQUIRED_COLUMNS.map(rename)).toEqual([...BILLING_REQUIRED_COLUMNS]);
    // Order included: a reordered header is a different file to a customer's export pipeline.
    expect(BILLING_EXTRACT_COLUMNS.length).toBe(SETTLEMENT_EXTRACT_COLUMNS.length);
  });

  it("every field keeps its tier, kind, PII class, capability, observability and owner", () => {
    expect(BILLING_EXTRACT_FIELDS).toHaveLength(SETTLEMENT_EXTRACT_FIELDS.length);
    for (const before of SETTLEMENT_EXTRACT_FIELDS) {
      const after = BILLING_EXTRACT_FIELDS.find((f) => f.name === rename(before.name));
      expect(after, `${before.name} has no counterpart`).toBeDefined();
      expect({ ...after!, name: "", neededBy: "", description: "", establishes: "", withoutIt: "", whenAbsent: "" })
        .toEqual({ ...before, name: "", neededBy: "", description: "", establishes: "", withoutIt: "", whenAbsent: "" });
      // `neededBy` is compared through the capability rename, since two capability names moved with the
      // artefact while `EXPECTED_SETTLEMENT_COUNT_AVAILABLE` deliberately did not.
      expect(after!.neededBy).toBe(
        before.neededBy
          .replace("SETTLEMENT_OBLIGATION_LINK_AVAILABLE", "BILLING_OBLIGATION_LINK_AVAILABLE")
          .replace("SETTLEMENT_PERIOD_AVAILABLE", "BILLING_PERIOD_AVAILABLE")
          .replace("every_settlement", "every_billing_line"),
      );
    }
  });

  it("no field was added, removed, promoted or demoted — a rename changes none of that", () => {
    const tiers = (fs: readonly { name: string; tier: string }[]): string[] =>
      fs.map((f) => `${rename(f.name)}:${f.tier}`).sort();
    expect(tiers(BILLING_EXTRACT_FIELDS)).toEqual(tiers(SETTLEMENT_EXTRACT_FIELDS));
  });

  it("NH-BX-#### is NH-SX-#### with the prefix replaced and nothing else", () => {
    expect(ALL_BILLING_CODES).toHaveLength(ALL_SETTLEMENT_CODES.length);
    for (const before of ALL_SETTLEMENT_CODES) {
      const expectedCode = before.code.replace("NH-SX-", "NH-BX-");
      const after = ALL_BILLING_CODES.find((c) => c.code === expectedCode);
      expect(after, `${before.code} has no NH-BX counterpart`).toBeDefined();
      expect(after!.severity).toBe(before.severity);
      expect(after!.ownedBy).toBe(before.ownedBy);
      expect(after!.since).toBe(before.since);
    }
    // The numbers are preserved, so a historical record citing NH-SX-3001 still resolves to the same rule.
    expect(ALL_BILLING_CODES.map((c) => c.code).sort())
      .toEqual(ALL_SETTLEMENT_CODES.map((c) => c.code.replace("NH-SX-", "NH-BX-")).sort());
  });

  it("the recorded EVENT is the same event, word for word", () => {
    expect(BILLING_EVENT_DEFINITION.theEvent).toBe(SETTLEMENT_EVENT_DEFINITION.theEvent);
    expect(BILLING_EVENT_DEFINITION.isNot).toEqual(SETTLEMENT_EVENT_DEFINITION.isNot);
    expect(BILLING_EVENT_DEFINITION.dateMeans).toBe(SETTLEMENT_EVENT_DEFINITION.dateMeans);
    expect(BILLING_EVENT_DEFINITION.amountMeans).toBe(SETTLEMENT_EVENT_DEFINITION.amountMeans);
    // The predecessor's remedy was a caveat telling a reader to discount the names. The successor renamed
    // them, so it carries the history instead of the warning.
    expect(SETTLEMENT_EVENT_DEFINITION).toHaveProperty("nameCaveat");
    expect(BILLING_EVENT_DEFINITION).not.toHaveProperty("nameCaveat");
    expect(BILLING_EVENT_DEFINITION.nameHistory.previousNames).toEqual({
      invoice_raised_at: "settled_at",
      invoice_line_amount: "settled_amount",
    });
    expect(BILLING_EVENT_DEFINITION.nameHistory.semanticsChanged).toBe(false);
  });

  it("the stopped candidates and the claim boundary carry over unchanged", () => {
    expect(BILLING_STOPPED_FIELDS.map((f) => f.candidate)).toEqual(
      SETTLEMENT_STOPPED_FIELDS.map((f) => f.candidate),
    );
    expect(BILLING_EXTRACT_CLAIM_BOUNDARY.observationOnly).toBe(SETTLEMENT_EXTRACT_CLAIM_BOUNDARY.observationOnly);
    expect(BILLING_EXTRACT_CLAIM_BOUNDARY.constitutesProof).toBe(false);
    expect(BILLING_EXTRACT_CLAIM_BOUNDARY.constitutesRevenue).toBe(false);
  });
});

describe("the historical record is inert, and provably so in both directions", () => {
  const importers = (): string[] => {
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!/\.(ts|tsx|mjs|js)$/.test(entry.name)) continue;
        // IMPORT SPECIFIERS ONLY, not occurrences. The first form of this guard stripped comments and
        // then matched the bare filename anywhere, so it flagged `billingExtract.ts` — whose version
        // history NAMES the retired module in a string, which is a citation and not a dependency — and
        // flagged the record itself for importing its own code catalogue. Eighth instance of the same
        // lesson in this repository: a structural guard must read code, and specifically the construct it
        // is actually asking about.
        const code = readFileSync(full, "utf8");
        const specifiers = [...code.matchAll(/(?:from|import|require)\s*\(?\s*["']([^"']+)["']/g)]
          .map((m) => m[1]!);
        const rel = full.replace(/.*\/(src|server|e2e|scripts)\//, "$1/");
        // The record's own two modules reference each other; that is internal, not an importer.
        if (/^src\/contract\/historical\/settlementExtract(Codes)?_1_0_0\.ts$/.test(rel)) continue;
        if (specifiers.some((x) => /settlementExtract(Codes)?_1_0_0$/.test(x))) hits.push(rel);
      }
    };
    for (const r of ["src", "server", "e2e", "scripts"]) walk(resolve(__dirname, "..", "..", "..", r));
    return hits.sort();
  };

  it("is imported by THIS TEST and by nothing else", () => {
    // The positive half matters as much as the negative one. If the list were empty the record would be
    // unreachable and nothing would be checking that the rename preserved anything.
    expect(importers()).toEqual(["src/contract/historical/settlementExtract_1_0_0.test.ts"]);
  });

  it("is machinery-free: no validator, no parser and no acceptance path was preserved with it", () => {
    const files = readdirSync(resolve(__dirname)).sort();
    expect(files).toEqual([
      "settlementExtractCodes_1_0_0.ts",
      "settlementExtract_1_0_0.test.ts",
      "settlementExtract_1_0_0.ts",
    ]);
    for (const f of files.filter((n) => !n.endsWith(".test.ts"))) {
      const code = readFileSync(resolve(__dirname, f), "utf8");
      // A declaration states facts. It must not contain anything that could READ a customer's file.
      expect(code, `${f} must not export a function`).not.toMatch(/export (async )?function/);
      expect(code, `${f} must not validate`).not.toMatch(/validate[A-Z]/);
    }
  });
});

// THE WITNESS'S PROPERTIES, EXERCISED FIELD BY FIELD.
//
// The preimage's whole job is that a changed row is VISIBLE. So every field in it is proved
// load-bearing individually, and the two things deliberately left out are proved to be left out —
// because a witness that moved when governance acted would make a legitimate verification read as
// tampering, which is worse than no witness.
import { describe, expect, it } from "vitest";
import {
  INSTITUTION_HASH_SCHEME,
  INSTITUTION_IDENTITY_VERSION,
  hashInstitution,
  institutionFactsProblems,
  institutionWitnessMatches,
  type InstitutionFacts,
} from "./institutionIdentity";

const FACTS: InstitutionFacts = Object.freeze({
  institutionId: "inst-synthetic",
  boundaryId: "pb-test",
  sourceSystem: "SYNTHETIC-BANK",
  sourceKind: "bank" as const,
  legalEntityName: "Synthetic Test Bank (NOT A REAL INSTITUTION)",
  jurisdiction: "ZZ",
  registryIdentifier: "ZZ-SYNTHETIC-0000",
});

describe("every field in the preimage is load-bearing", () => {
  it("changing any one of them changes the witness", async () => {
    const base = await hashInstitution(FACTS);
    const variants: readonly Partial<InstitutionFacts>[] = [
      { institutionId: "inst-other" },
      { boundaryId: "pb-other" },
      { sourceSystem: "OTHER-BANK" },
      { sourceKind: "psp" },
      { legalEntityName: "Someone Else" },
      { jurisdiction: "YY" },
      { registryIdentifier: "ZZ-SYNTHETIC-0001" },
    ];
    // DERIVED COVERAGE: the count is checked against the fact shape, so a new field added to
    // `InstitutionFacts` and forgotten here fails rather than passing silently.
    expect(variants.length).toBe(Object.keys(FACTS).length);
    for (const patch of variants) {
      const moved = await hashInstitution({ ...FACTS, ...patch });
      expect(moved, `changing ${Object.keys(patch)[0]} left the witness unmoved`).not.toBe(base);
    }
  });

  it("the same facts always hash to the same witness", async () => {
    expect(await hashInstitution(FACTS)).toBe(await hashInstitution({ ...FACTS }));
  });

  it("is `sha256:` plus 64 hex, and the scheme id is inside the preimage", async () => {
    const h = await hashInstitution(FACTS);
    expect(h).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(INSTITUTION_HASH_SCHEME).toBe("nh-institution-v1");
    // The scheme being in the preimage means a future scheme cannot collide with this one over the
    // same values — proved by hashing the same fields under a different leading constant is not
    // possible from outside, so it is asserted structurally on the source instead.
    const src = readSource();
    expect(src).toMatch(/INSTITUTION_HASH_SCHEME,\s*\n\s*facts\.institutionId/);
  });

  it("no field can impersonate the separator", async () => {
    // THE PAIR MUST BE ADJACENT IN THE PREIMAGE, which the first form of this test got wrong: it used
    // `sourceSystem` and `legalEntityName`, with `sourceKind` between them, so removing the separator
    // did not make them collide and the mutation SURVIVED. `legalEntityName` and `jurisdiction` are
    // consecutive, so this pair actually exercises the property.
    const a = await hashInstitution({ ...FACTS, legalEntityName: "AB", jurisdiction: "C" });
    const b = await hashInstitution({ ...FACTS, legalEntityName: "A", jurisdiction: "BC" });
    expect(a).not.toBe(b);
  });

  it("the separator property holds for EVERY adjacent pair, not one chosen pair", async () => {
    // Derived from the preimage's declared order, so a reordering or an inserted field cannot leave a
    // gap between two fields that nothing checks.
    const order: readonly (keyof InstitutionFacts)[] = [
      "institutionId", "boundaryId", "sourceSystem", "sourceKind", "legalEntityName",
      "jurisdiction", "registryIdentifier",
    ];
    for (let i = 0; i + 1 < order.length; i += 1) {
      const left = order[i]!;
      const right = order[i + 1]!;
      // `sourceKind` is a closed enum, so a split across it cannot be expressed — skipped explicitly
      // rather than quietly, since a silently skipped pair is the gap this test exists to close.
      if (left === "sourceKind" || right === "sourceKind") continue;
      const a = await hashInstitution({ ...FACTS, [left]: "AB", [right]: "C" } as InstitutionFacts);
      const b = await hashInstitution({ ...FACTS, [left]: "A", [right]: "BC" } as InstitutionFacts);
      expect(a, `${left}/${right} collide without a separator`).not.toBe(b);
    }
  });
});

describe("what the witness deliberately does NOT cover", () => {
  it("there is no state or event field in the fact shape at all", () => {
    // STRUCTURAL, not a hash comparison: the only way the witness could move when governance acts is
    // if a lifecycle field existed to put in it. None does.
    const keys = Object.keys(FACTS);
    for (const forbidden of ["state", "events", "verification", "evidence", "verifiedAt"]) {
      expect(keys, `InstitutionFacts carries '${forbidden}'`).not.toContain(forbidden);
    }
  });

  it("carries no person — only a role-free legal entity and a registry identifier", () => {
    // PER FIELD, NEVER OVER A JOINED BLOB. The first form joined the key names and banned the token
    // `"name "`, which matched inside `legalEntityName jurisdiction` — a banned term found in a
    // perfectly legitimate field. *A term is not a claim*, for the thirteenth recorded time, and this
    // time in my own privacy guard.
    const keys = Object.keys(FACTS).map((k) => k.toLowerCase());
    const ALLOWED_NAME_FIELD = "legalentityname";
    for (const forbidden of ["signatory", "contact", "person", "email", "phone", "name"]) {
      for (const key of keys) {
        if (key === ALLOWED_NAME_FIELD) continue;
        expect(key.includes(forbidden), `InstitutionFacts carries '${key}'`).toBe(false);
      }
    }
    // `legalEntityName` is a COMPANY, which is the thing being verified; the authorised signatories
    // are a CONDITION established out of band, and their names stay in that record.
    expect(keys).toContain(ALLOWED_NAME_FIELD);
  });
});

describe("the witness check", () => {
  it("accepts the recorded witness and refuses a changed row", async () => {
    const w = await hashInstitution(FACTS);
    expect(await institutionWitnessMatches(FACTS, w)).toBe(true);
    expect(await institutionWitnessMatches({ ...FACTS, sourceSystem: "ATTACKER" }, w)).toBe(false);
  });

  it("refuses a witness in the wrong shape rather than coercing it", async () => {
    expect(await institutionWitnessMatches(FACTS, "")).toBe(false);
    expect(await institutionWitnessMatches(FACTS, "sha256:deadbeef")).toBe(false);
  });
});

describe("the facts validator reports EVERY problem", () => {
  it("accepts well-formed facts", () => {
    expect(institutionFactsProblems(FACTS)).toEqual([]);
  });

  it("names several problems at once, not the first", () => {
    const problems = institutionFactsProblems({
      ...FACTS, institutionId: "", jurisdiction: " ZZ ", registryIdentifier: 7,
    });
    expect(problems.length).toBe(3);
    expect(problems.join(" ")).toMatch(/institutionId/);
    expect(problems.join(" ")).toMatch(/jurisdiction/);
    expect(problems.join(" ")).toMatch(/registryIdentifier/);
  });

  it("refuses a non-object without throwing", () => {
    expect(institutionFactsProblems(null)).toEqual(["facts must be an object"]);
    expect(institutionFactsProblems("nope")).toEqual(["facts must be an object"]);
  });

  it("refuses a control character, which is how a value impersonates a hash separator", () => {
    for (const bad of ["SYNTHETIC\u0000BANK", "SYNTH\u001fBANK", "SYNTH\u007fBANK"]) {
      expect(
        institutionFactsProblems({ ...FACTS, sourceSystem: bad }).join(" "),
        `${JSON.stringify(bad)} was accepted`,
      ).toMatch(/control characters/);
    }
  });

  it("refuses a sourceKind outside the two the settlement path understands", () => {
    expect(institutionFactsProblems({ ...FACTS, sourceKind: "clearing-house" }).join(" ")).toMatch(
      /sourceKind must be 'bank' or 'psp'/,
    );
  });

  it("every text field is individually required", () => {
    for (const field of [
      "institutionId", "boundaryId", "sourceSystem", "legalEntityName", "jurisdiction",
      "registryIdentifier",
    ]) {
      const problems = institutionFactsProblems({ ...FACTS, [field]: "" });
      expect(problems.join(" "), `${field} is not required`).toMatch(new RegExp(field));
    }
  });

  it("the version is pinned", () => {
    expect(INSTITUTION_IDENTITY_VERSION).toBe("instid-2026.1");
  });
});

function readSource(): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const { resolve } = require("node:path") as typeof import("node:path");
  return readFileSync(resolve(__dirname, "institutionIdentity.ts"), "utf8");
}

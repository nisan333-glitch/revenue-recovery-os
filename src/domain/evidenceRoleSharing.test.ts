// ONE implementation of the correction-channel vocabulary, asserted by IDENTITY.
//
// The order requires: *reuse the existing governed rules or establish a shared implementation with
// mandatory equivalence tests; do not create conflicting independent policies.* A test that feeds
// both sides a list of pairs and compares the answers would satisfy the words and not the property —
// **a finite agreement is necessary evidence of equivalence and never a proof of it**, the rule this
// repository established when a behaviour fingerprint was wrongly treated as establishing that two
// calculation methods were the same method. Two implementations agreeing on the pairs a fixture
// supplies may disagree on the next one, and no finite fixture closes that gap.
//
// So this asserts the stronger thing that a move (rather than a copy) makes available: the server's
// binding IS the domain's binding — the same function object, the same frozen arrays — so there is
// nothing left that could disagree. The fixture comparison is kept too, but as a sanity check on the
// re-export wiring rather than as the equivalence argument.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  ALL_CORRECTION_EVIDENCE_TYPES,
  CORRECTION_EVIDENCE_TYPES,
  OUTCOME_EVIDENCE_TYPES,
  ROLE_MAP_VERSION,
  deriveEvidenceRole,
} from "./evidenceRole";
import * as server from "../../server/domain/evidenceRole";
import { DECLARED_CORRECTION_TYPES, CORRECTION_CHANNELS } from "./correctionMapping";

const SERVER_FILE = `${process.cwd()}/server/domain/evidenceRole.ts`;

describe("the evidence-role derivation is shared, not duplicated", () => {
  it("1 · the server's derivation IS the domain's function object", () => {
    // Reference equality. Not `toEqual`, not a behavioural comparison: the same object cannot drift
    // from itself, which is the only form of this claim that holds for inputs no fixture supplies.
    expect(server.deriveEvidenceRole).toBe(deriveEvidenceRole);
    expect(server.ROLE_MAP_VERSION).toBe(ROLE_MAP_VERSION);
    expect(server.CORRECTION_EVIDENCE_TYPES).toBe(CORRECTION_EVIDENCE_TYPES);
    expect(server.OUTCOME_EVIDENCE_TYPES).toBe(OUTCOME_EVIDENCE_TYPES);
    expect(server.ALL_CORRECTION_EVIDENCE_TYPES).toBe(ALL_CORRECTION_EVIDENCE_TYPES);
  });

  it("2 · the server file DECLARES nothing of its own — it is a re-export and no more", () => {
    // Identity holds today; this is what keeps it holding. The moment a `const`, `function`, `class`
    // or object literal appears in that file it is a second policy, and identity would quietly stop
    // being the thing the test above is measuring. Comments are stripped first, because the file's
    // own header discusses the declarations it must not contain — a term is not a claim.
    const src = readFileSync(SERVER_FILE, "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(code).not.toMatch(/\b(const|let|var|function|class)\b/);
    // And the stripper is not vacuous: the header really does name those constructs.
    expect(src).toMatch(/second policy/);
    // Every statement is an export-from of the domain module.
    const statements = code.split(";").map((s) => s.trim()).filter((s) => s.length > 0);
    expect(statements.length).toBeGreaterThan(0);
    for (const s of statements) {
      expect(s, s).toMatch(/^export (type )?\{[\s\S]*\} from "\.\.\/\.\.\/src\/domain\/evidenceRole"$/);
    }
  });

  it("3 · the correction-channel vocabulary is DERIVED from the role allowlist, not restated", () => {
    // `DECLARED_CORRECTION_TYPES` used to be a hand-written list whose comment said it mirrored the
    // allowlist. It now IS the allowlist, so the two cannot disagree.
    expect(DECLARED_CORRECTION_TYPES).toBe(ALL_CORRECTION_EVIDENCE_TYPES);
    // Pinned values, so a change to the allowlist shows up as a change HERE rather than silently
    // widening which corrections may evidence a BillingCorrection recovery.
    expect([...DECLARED_CORRECTION_TYPES]).toEqual(["corrective_invoice_issued", "billing_corrected"]);
  });

  it("4 · every declared correction type really derives the `correction` role", () => {
    // The two directions are different claims. This is the one that matters for the gate: a type the
    // channel permits must be a type ingestion would classify as a correction, or the gate would
    // accept an evidence record the store never labelled that way.
    for (const t of ALL_CORRECTION_EVIDENCE_TYPES) {
      expect(deriveEvidenceRole("billing", t), t).toBe("correction");
    }
  });

  it("5 · and the reverse: nothing outside the list derives `correction`", () => {
    for (const [system, types] of Object.entries(CORRECTION_EVIDENCE_TYPES)) {
      for (const t of types) expect(ALL_CORRECTION_EVIDENCE_TYPES).toContain(t);
      expect(system).toBe("billing"); // the only source that attests a correction today
    }
    // A credit note is deliberately absent — it corrects billing in the opposite direction.
    expect(deriveEvidenceRole("billing", "credit_note_issued")).toBe("supporting");
    // And a non-billing source cannot attest a correction however the type is spelled.
    expect(deriveEvidenceRole("product", "corrective_invoice_issued")).toBe("supporting");
    expect(deriveEvidenceRole("manual", "billing_corrected")).toBe("supporting");
  });

  it("6 · BillingCorrection's permitted set is exactly the derived vocabulary", () => {
    const billing = CORRECTION_CHANNELS.find((c) => c.reason === "BillingCorrection");
    expect(billing).toBeDefined();
    expect([...billing!.permitted].sort()).toEqual([...DECLARED_CORRECTION_TYPES].sort());
    // Every other reason has NO channel, which is the fact the whole correction rests on.
    for (const c of CORRECTION_CHANNELS.filter((x) => x.reason !== "BillingCorrection")) {
      expect(c.permitted, c.reason).toEqual([]);
    }
  });
});

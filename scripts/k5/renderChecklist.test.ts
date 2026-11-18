// The committed checklist IS the rendering. Asserted byte for byte, so editing the document without
// editing the catalogue fails here — which is the only thing that makes "generated" a property rather
// than a label at the top of the file.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderK5Checklist } from "./renderChecklist";
import { K5_EVIDENCE_ITEMS } from "../../src/contract/k5EvidenceCatalogue";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DOC = resolve(REPO, "docs/K5_EVIDENCE_CHECKLIST_V1.md");

describe("K5 checklist · generated, not authored", () => {
  it("the committed document matches the catalogue byte for byte", () => {
    expect(readFileSync(DOC, "utf8")).toBe(renderK5Checklist());
  });

  it("renders EVERY item, with its limitation — a dropped item is a step nobody performs", () => {
    const out = renderK5Checklist();
    for (const item of K5_EVIDENCE_ITEMS) {
      expect(out, `${item.id} missing`).toContain(item.id);
      expect(out).toContain(item.artefact);
      expect(out).toContain(item.doesNotEstablish);
    }
  });

  it("says plainly which conditions NH verifies and that the rest are recorded claims", () => {
    const out = renderK5Checklist();
    expect(out).toContain("**NH VERIFIES THIS**");
    expect(out).toContain("NH RECORDS IT AND ESTABLISHES NOTHING");
    expect(out).toMatch(/their input is a human claim/);
  });

  it("B3 · tells the reader the institution's identity is NOT a tick on this form", () => {
    // THE ONE SENTENCE A PILOT BRIEF WOULD OTHERWISE GET WRONG. The checklist is handed to whoever
    // performs the ceremony, and until B3 it listed the institution's identity beside three
    // operator-declared booleans as if it were one of them.
    const out = renderK5Checklist();
    expect(out).toMatch(/no longer one of those ticks/);
    expect(out).toMatch(/DERIVED at activation/);
    expect(out).toMatch(/C2a/);
    expect(out).toMatch(/second governance identity/);
    // And the retired boolean is not named as something to collect.
    expect(out).not.toMatch(/C2 · the institution is who it says it is/);
  });

  it("names BOTH mechanical conditions and neither of them is an identity", () => {
    const out = renderK5Checklist();
    expect(out).toMatch(/Mechanically verifiable conditions: \*\*keyControlDemonstrated, secondPersonApproval\*\*/);
    const line = out.split("\n").find((l) => l.startsWith("Mechanically verifiable conditions:"))!;
    expect(line).not.toMatch(/legalEntity|regulatoryStanding|authorisedSignatories/);
  });

  it("does not claim AUTHORITY_VERIFIED is reachable, and keeps the unwelcome item", () => {
    const out = renderK5Checklist();
    expect(out).toMatch(/Nothing here reaches `AUTHORITY_VERIFIED`/);
    // K5-d must not be softened: a bank that will not sign yields NO proof, not a weaker one.
    expect(out).toMatch(/no PROVEN claim/);
    expect(out).toMatch(/Claimed revenue is not proven revenue/);
  });

  it("carries no money figure of any kind", () => {
    expect(renderK5Checklist()).not.toMatch(/[$£€]\s?\d/);
  });
});

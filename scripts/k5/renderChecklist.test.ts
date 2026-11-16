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

  it("says plainly that exactly one condition is verified and the rest are recorded claims", () => {
    const out = renderK5Checklist();
    expect(out).toContain("**NH VERIFIES THIS**");
    expect(out).toContain("NH RECORDS IT AND ESTABLISHES NOTHING");
    expect(out).toMatch(/its input is a human claim/);
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

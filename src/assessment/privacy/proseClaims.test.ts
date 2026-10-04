// EP-19 · The documents we read aloud to customers, checked for claims that are no longer true.
//
// WHY THIS IS A TEST AND NOT A REVIEW HABIT. `playbooks/*.md` are scripts: pasted into emails, read
// out in discovery calls, handed to a security reviewer. They promised for months that a customer's
// file "never leaves your machine" — true when written, false from EP-13, and doubly false since
// EP-16/EP-17 retain a pseudonymised projection of the accepted rows server-side. Nothing caught it,
// because prose has no type checker and no reviewer reads a playbook when changing a service.
//
// The rule enforced here is the one the repository already uses for retracted claims: a false claim
// may appear ONLY inside text that retracts it. That keeps the history legible — someone who read the
// old script can find out that it changed and why — without leaving a live sentence that misleads.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Claims that are false about the product as it now works.
 *
 * Regexes, not plain substrings, because a substring cannot tell a promise from an accurate negative.
 * "Never uploaded row content" is a true statement about what the submission record omits; "their file
 * was never uploaded" is the retracted promise. A check that conflated them would have to be loosened
 * until it caught nothing.
 */
const RETRACTED: readonly RegExp[] = [
  /never leaves your machine/i,
  /never leaves your browser/i,
  /entirely in your browser/i,
  /nothing is uploaded/i,
  /never uploaded(?!\s+row content)/i,
  /browser-only tool/i,
];

/** Text that marks a retraction. A retracted claim must sit inside one of these. */
const RETRACTION_MARKERS = [
  "no longer true",
  "was wrong",
  "were wrong",
  "has not been true",
  "must **not** be stated",
  "may **not** be stated",
  "that had to go",
  "Every sentence in this document that promised",
  "previously",
  "once said",
  "The old",
  "old promise",
  "old copy",
  "old note",
];

const CUSTOMER_FACING = [
  "playbooks/DP_EXECUTION_PACKAGE.md",
  "playbooks/DP_VALIDATION_KIT.md",
  "src/assessment/privacy/NETWORK_INSPECTION.md",
  "docs/CUSTOMER_PILOT_DATA_CONTRACT_V1.md",
];

/** Collapse whitespace so a claim split across a wrapped line is still found. */
const normalise = (text: string) => text.replace(/\s+/g, " ");

/** The sentence-ish window a claim sits in, so its surroundings can be judged. */
function contexts(text: string, claim: RegExp): string[] {
  const flat = normalise(text);
  const scan = new RegExp(claim.source, claim.flags.includes("g") ? claim.flags : `${claim.flags}g`);
  const found: string[] = [];
  for (const match of flat.matchAll(scan)) {
    const at = match.index ?? 0;
    found.push(flat.slice(Math.max(0, at - 400), at + match[0].length + 260));
  }
  return found;
}

describe("EP-19 · a retracted data-handling claim survives only inside its retraction", () => {
  it.each(CUSTOMER_FACING)("%s", (file) => {
    const text = readFileSync(file, "utf8");
    for (const claim of RETRACTED) {
      for (const context of contexts(text, claim)) {
        const retracted = RETRACTION_MARKERS.some((m) =>
          context.toLowerCase().includes(m.toLowerCase()),
        );
        expect(
          retracted,
          `${file} states ${claim} outside a retraction:\n…${context}…`,
        ).toBe(true);
      }
    }
  });

  it("says plainly, in each customer-facing document, that the file IS uploaded", () => {
    // The mirror of the rule above. Deleting the false sentence is not enough — a document that
    // simply goes quiet about handling leaves the reader with the impression the old script gave
    // them, and that impression was the problem.
    for (const file of CUSTOMER_FACING) {
      const text = normalise(readFileSync(file, "utf8")).toLowerCase();
      expect(text, `${file} must say the file is uploaded`).toMatch(
        /is uploaded|you upload it|upload one csv|uploading a csv|file is uploaded/,
      );
    }
  });

  it("describes what is retained as pseudonymised, and never as anonymous", () => {
    for (const file of ["src/assessment/privacy/NETWORK_INSPECTION.md", "playbooks/DP_EXECUTION_PACKAGE.md"]) {
      const text = normalise(readFileSync(file, "utf8"));
      expect(text, `${file} must name the retained projection`).toMatch(/pseudonymised/i);
      // "Anonymous" would be a stronger claim than the data supports: first-appearance ordinals
      // preserve equality classes, and exact dates and amounts remain. But the word may legitimately
      // appear in a denial — "pseudonymisation is not anonymisation" is the sentence we WANT — so, as
      // with the retracted claims above, the test asks whether each occurrence is negated.
      for (const match of text.matchAll(/(.{0,90})\b(anonymous|anonymised|anonymized|anonymisation|anonymization)\b/gi)) {
        expect(
          /\b(not|never|no|nor|rather than|instead of)\b/i.test(match[1] ?? ""),
          `${file} claims anonymity: …${match[0]}`,
        ).toBe(true);
      }
    }
  });

  it("quotes no re-identification rate anywhere", () => {
    // A number here would be fabricated: nobody measured it. Stating the exposure is honest;
    // quantifying it would be the same sin the product exists to prevent, in a privacy note.
    for (const file of CUSTOMER_FACING.concat(["src/contract/assessmentExecution.ts"])) {
      const text = normalise(readFileSync(file, "utf8"));
      const near = text.match(/.{0,80}(re-?identif\w*).{0,80}/gi) ?? [];
      for (const window of near) {
        expect(window, `${file} quotes a rate near a re-identification claim`).not.toMatch(
          /\d+(\.\d+)?\s*%|\d+\s*(in|of)\s*\d+/,
        );
      }
    }
  });

  it("states a retention period rather than leaving it open-ended", () => {
    const text = normalise(readFileSync("src/assessment/privacy/NETWORK_INSPECTION.md", "utf8"));
    expect(text).toMatch(/retention period/i);
    // And that rejected rows are not kept — the one genuinely reassuring fact, which the old
    // over-claiming copy buried under a promise it could not keep.
    expect(text.toLowerCase()).toMatch(/rejected rows are never stored|keep no copy of the rows that failed/);
  });
});

// NOT COMPUTED IS RENDERED, AND `$0.00` IS NOT — asserted on the markup, not on intent.
//
// `provenRevenueReturned` returns `number | null`, and the whole value of that signature is lost the
// moment one screen writes `?? 0`. A zero asserts something false and specific: that a proof was
// looked for, found, and summed to nothing. So this file renders the real screens with the real seed
// data and reads what comes out.
//
// IT ALSO SCANS FOR THE COERCION STRUCTURALLY, because the rendering test can only cover the cases the
// seed data happens to produce. A `?? 0` added tomorrow on a path no fixture exercises would pass
// every render assertion here and still be the defect. Comments are stripped before the scan: the
// components discuss `?? 0` in order to forbid it, and a guard matching the prose would fire on the
// explanation rather than on the code — the lesson this repository has had to re-learn in a guard more
// than a dozen times.
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, readdirSync } from "node:fs";
import { RecoveryProvider } from "../state/RecoveryContext";
import { App } from "../App";
import { NOT_COMPUTED, ProofRefusedNotice, ProvenRevenueFigure } from "./ProvenRevenueFigure";
import { seedEvents } from "../data/seed";
import { provenRevenueReturned } from "../domain/invariants";

const ROOT = `${process.cwd()}/src`;
const events = seedEvents();
const refused = events.find((e) => e.eventId === "RE-1014")!;
const proven = events.find((e) => e.eventId === "RE-1015")!;

const render = (module?: "demo" | "cfo") =>
  renderToStaticMarkup(
    createElement(RecoveryProvider, null, createElement(App, { initialModule: module })),
  );

function allTsx(dir = ROOT, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) out.push(...allTsx(`${dir}/${entry.name}`, `${prefix}${entry.name}/`));
    else if (entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx")) out.push(`${prefix}${entry.name}`);
  }
  return out;
}

const stripComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("a refused proof renders NOT COMPUTED, never a zero", () => {
  it("1 · the component says NOT COMPUTED for a refused case", () => {
    const html = renderToStaticMarkup(createElement(ProvenRevenueFigure, { event: refused }));
    expect(html).toContain(NOT_COMPUTED);
    expect(html).not.toContain("$0.00");
    expect(html).not.toContain("$0");
  });

  it("2 · and the real figure for a provable one — so it is not stuck on one answer", () => {
    // A component that always printed NOT COMPUTED would pass test 1 and be useless.
    expect(provenRevenueReturned(proven)).toBe(5_500);
    const html = renderToStaticMarkup(createElement(ProvenRevenueFigure, { event: proven }));
    expect(html).toContain("5,500");
    expect(html).not.toContain(NOT_COMPUTED);
  });

  it("3 · the refusal notice names the mechanism and appears only when there IS a refusal", () => {
    const shown = renderToStaticMarkup(createElement(ProofRefusedNotice, { event: refused }));
    expect(shown).toContain("PROOF REFUSED");
    expect(shown).toContain("UsageActivation");
    expect(shown).toContain(NOT_COMPUTED);
    // Absent for a provable case: a reassuring empty box is its own misstatement.
    expect(renderToStaticMarkup(createElement(ProofRefusedNotice, { event: proven }))).toBe("");
  });

  it("4 · the Guided Demo screen shows the refusal, and $10,600 survives ONLY as a labelled estimate", () => {
    const html = render("demo");
    expect(html).toContain(NOT_COMPUTED);
    expect(html).toContain("PROOF REFUSED");
    // NO RENDERED FIGURE IS $0.00 — asked about the construct, not the token. The first form of this
    // banned the string outright and failed on the screen's own explanatory sentence, which says the
    // figure reads NOT COMPUTED and "never “$0.00”, which would claim a proof was found and summed to
    // nothing". A guard that fires on the prose forbidding a thing rather than on the thing is the
    // mistake this repository has now recorded more than a dozen times, and it caught me here.
    // A rendered value is an element's text content, so that is what the pattern matches.
    expect(html).not.toMatch(/>\s*\+?\$0\.00\s*</);
    expect(html).not.toMatch(/>\s*\+?\$0\s*</);
    // And the pattern is not vacuous: it does match a rendered zero where one exists.
    expect('<span class="x">$0.00</span>').toMatch(/>\s*\+?\$0\.00\s*</);
    // It is labelled as seed data, which it was not before this slice.
    expect(html).toContain("DEMO · SYNTHETIC DATA");
    expect(html).toMatch(/nothing here is proven Revenue\s*Returned/);

    // THE FIRST FORM OF THIS ASSERTION BANNED "10,600" FROM THE WHOLE PAGE, AND IT WAS WRONG.
    // `EventDetail` still shows `+$10,600` as the Case record's Collected − Baseline, under the label
    // "operational estimate — not proven" and a paragraph saying the real figure comes from the
    // governed proof. That figure is honest arithmetic over two recorded numbers and deleting it would
    // hide a fact. The property is not that the number is absent; it is that every occurrence of it is
    // inside a block that denies being a proof.
    const ESTIMATE_LABEL = "operational estimate";
    let from = 0;
    let occurrences = 0;
    for (;;) {
      const at = html.indexOf("10,600", from);
      if (at === -1) break;
      occurrences += 1;
      const window = html.slice(Math.max(0, at - 200), at + 400);
      expect(window, `"10,600" at ${at} is not inside an estimate block`).toContain(ESTIMATE_LABEL);
      from = at + 1;
    }
    // And the scan is not vacuous: the figure really is on the page.
    expect(occurrences).toBeGreaterThan(0);

    // RE-1014's PROVEN figure specifically is the not-computed one.
    expect(html).toContain('data-testid="proven-revenue-not-computed"');
  });

  it("5 · the Guided Demo also shows the case that CAN be proven, with its real figure", () => {
    // Showing only a refusal would misstate the product in the other direction.
    const html = render("demo");
    expect(html).toContain("RE-1015");
    expect(html).toContain("5,500");
    expect(html).toMatch(/accounting identity/i);
  });

  it("6 · the CFO view's proven total is the one proof, and the refused dollars are not in it", () => {
    const html = render("cfo");
    expect(html).toContain("PF-RE-1015");
    // None of the seven refused cases has a proof line.
    for (const id of ["PF-RE-1001", "PF-RE-1002", "PF-RE-1003", "PF-RE-1004", "PF-RE-1005", "PF-RE-1013", "PF-RE-1014"]) {
      expect(html, id).not.toContain(id);
    }
    // And the old headline figures appear nowhere.
    expect(html).not.toContain("83,400");
    expect(html).not.toContain("79,800");
  });
});

describe("the coercion that would undo this cannot be written silently", () => {
  it("7 · no component coerces a null proven figure to zero", () => {
    const offenders: string[] = [];
    for (const file of allTsx()) {
      const code = stripComments(readFileSync(`${ROOT}/${file}`, "utf8"));
      if (/provenRevenueReturned\s*\([^)]*\)\s*\?\?/.test(code)) offenders.push(`${file} (?? on provenRevenueReturned)`);
      if (/provenRevenueReturned\s*\([^)]*\)\s*\|\|/.test(code)) offenders.push(`${file} (|| on provenRevenueReturned)`);
      if (/Number\s*\(\s*provenRevenueReturned/.test(code)) offenders.push(`${file} (Number() on provenRevenueReturned)`);
    }
    expect(offenders).toEqual([]);
  });

  it("8 · the comment stripper is not vacuous — the forbidden idea IS discussed in the prose", () => {
    // Without this, a stripper that silently matched nothing would make test 7 pass forever.
    const raw = readFileSync(`${ROOT}/components/ProvenRevenueFigure.tsx`, "utf8");
    expect(raw).toContain("?? 0");
    expect(stripComments(raw)).not.toContain("?? 0");
  });

  it("9 · no screen FORMATS a proven figure itself — only the shared component does", () => {
    // THE FIRST FORM ASKED "does this file mention both `provenRevenueReturned` and `money`", and it
    // flagged `src/App.tsx` for doing both in unrelated places: it calls `provenRevenueReturned` to
    // choose a sentence and `money()` to print an unrelated baseline. Mentioning two things is not
    // combining them. The property is that nobody passes the proven figure INTO a formatter, so that
    // is what the pattern now asks — the construct, not the vocabulary.
    const offenders = allTsx().filter((f) => {
      if (f === "components/ProvenRevenueFigure.tsx") return false;
      const code = stripComments(readFileSync(`${ROOT}/${f}`, "utf8"));
      return /money\s*\(\s*provenRevenueReturned/.test(code)
        || /formatMoney\s*\(\s*provenRevenueReturned/.test(code);
    });
    expect(offenders).toEqual([]);
    // Positive half: the component really is the one that formats it, so the guard is about something.
    const shared = stripComments(readFileSync(`${ROOT}/components/ProvenRevenueFigure.tsx`, "utf8"));
    expect(shared).toMatch(/money\s*\(\s*proven\s*\)/);
  });
});

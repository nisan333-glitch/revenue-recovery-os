// The one statement that a screen's rows are seed data, rendered in one place.
//
// WHY A COMPONENT AND NOT A SENTENCE PER SCREEN. Ten screens read `useRecovery()` — the seed-backed
// React context in `src/data/seed.ts` — and a copy-pasted banner in ten files is ten things that can
// drift from each other and from the truth. One component is one thing to change, and
// `seedDataLabelling.test.ts` derives the list of screens that must render it FROM THE CODE: any module
// that imports the seed context and does not render this fails the build. That is the mechanism; the
// wording is just what it says.
//
// WHAT IT CLAIMS, PRECISELY. The ROWS are demonstration data. The RULES applied to them are the real
// domain kernel — chain folding, the stamped proof threshold, the auditable gate, the two-ledger
// separation. Saying "this screen is fake" would be as wrong as saying nothing: the arithmetic is the
// product's, and that is exactly why the rows have to be labelled rather than the screen dismissed.
//
// It names where the governed equivalent lives, because a warning with no destination tells a reader
// what not to trust and not what to do instead.
import type { ReactNode } from "react";

export function DemoDataBanner({ children }: { children?: ReactNode }) {
  return (
    <div
      role="note"
      data-testid="demo-data-banner"
      className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-[12px] text-amber-200"
    >
      <strong>DEMO · SYNTHETIC DATA.</strong> The rows on this screen come from the built-in seed set, not
      from the governed record in the database. The rules applied to them are the real ones, but no figure
      here was produced by a detector finding on customer data, and nothing here is proven Revenue
      Returned. For an authoritative case read from the governed record, use{" "}
      <span className="font-medium">Recovery Case</span>.
      {children}
    </div>
  );
}

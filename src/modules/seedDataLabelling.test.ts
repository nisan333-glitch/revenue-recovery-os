// Every screen whose rows come from the seed set says so — derived from the code, not from a list.
//
// THE CONDITION THIS ENFORCES: *clearly label all seed-backed views as DEMO / SYNTHETIC DATA.* A
// hand-kept list of screens would satisfy it on the day it was written and rot the moment someone adds
// an eleventh. So the set of screens that MUST carry the banner is computed here by asking which modules
// import the seed-backed context, and a module that does and does not render `DemoDataBanner` fails.
//
// A STRUCTURAL GUARD MUST READ THE CONSTRUCT IT IS ASKING ABOUT — the lesson this repository has now had
// to re-learn in a guard a dozen times. The question is "does this module DEPEND on the seed context",
// so the scan reads **import specifiers**: a prose mention is not an import and a string literal is not
// a dependency. `RecoveryCaseCenter` is the proof that the distinction matters — its header explains at
// length why it does not use `useRecovery()`, so a token scan would flag the one screen that is right.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

// WIDENED PAST `src/modules/`, WHICH IS THE GAP THIS SLICE FOUND. The scan read that one directory,
// so `src/App.tsx` — the Guided Demo's own front door, which renders `useRecovery()` and stated
// "RE-1014's proven Revenue Returned $10,600" with no banner at all — was outside its reach BY
// CONSTRUCTION. The guard was not weak; it was pointed at the wrong set. `src/components/` is in the
// set for the same reason: `EventDetail.tsx` renders the whole case story from the seed context.
//
// A directory list is itself a thing that rots, so `src/` is walked and every `.tsx` that imports the
// seed context is in scope, whatever folder someone puts it in. The only exemption is a component
// that is ALWAYS embedded inside a screen already carrying the banner, which is declared by name and
// then PROVED by checking every one of its consumers — never taken on trust.
const ROOT = `${process.cwd()}/src`;

/** Every `.tsx` under `src/`, at any depth, as a path relative to `src/`. */
function allScreens(dir = ROOT, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) out.push(...allScreens(`${dir}/${entry.name}`, `${prefix}${entry.name}/`));
    else if (entry.name.endsWith(".tsx")) out.push(`${prefix}${entry.name}`);
  }
  return out;
}

const sourceOf = (file: string): string => readFileSync(`${ROOT}/${file}`, "utf8");

/** Import specifiers only. */
const importsOf = (code: string): string[] =>
  [...code.matchAll(/(?:^|\n)\s*import\s[^;]*?from\s+["']([^"']+)["']/g)].map((m) => m[1]!);

/**
 * Does this file READ the seed-backed context, as opposed to merely supplying it?
 *
 * The question the banner answers is "are the rows on this screen seed data", so the construct to
 * look for is the HOOK. `src/main.tsx` imports `RecoveryProvider` and renders no business figure at
 * all — it mounts the tree — and a banner on the app's outermost element would label everything,
 * including the governed screens that must not carry one. Test 5b proves that distinction rather than
 * leaving it as an assertion.
 */
const readsSeedContext = (code: string): boolean =>
  /(?:^|\n)\s*import\s+\{[^}]*\buseRecovery\b[^}]*\}\s*from\s+["'][^"']*state\/RecoveryContext["']/.test(code);

/**
 * Components that never render on their own — always inside a screen that already banners.
 *
 * Declared here and VERIFIED below against their real consumers, because an exemption list that
 * nobody checks is how `src/App.tsx` stayed unlabelled: a second banner inside an embedded component
 * would show two notices on one page, so the exemption is real, and it is only safe while every
 * consumer carries one.
 */
const EMBEDDED_ONLY = ["components/EventDetail.tsx"];

const screens = allScreens();
const seedBacked = screens
  .filter((f) => readsSeedContext(sourceOf(f)))
  .filter((f) => !EMBEDDED_ONLY.includes(f));

describe("seed-backed screens are labelled DEMO · SYNTHETIC DATA", () => {
  it("1 · the scan finds screens at all, so the guard can fire", () => {
    // A guard that cannot fire is not a weaker guard, it is no guard.
    expect(screens.length).toBeGreaterThan(10);
    expect(seedBacked.length).toBeGreaterThan(5);
  });

  it("1b · the scan reaches OUTSIDE src/modules, which is the gap it was widened to close", () => {
    // Without this the widening could be reverted and every other assertion would still pass against
    // the narrower set. `App.tsx` is the specific file that was missed.
    expect(screens).toContain("App.tsx");
    expect(seedBacked).toContain("App.tsx");
    expect(screens.some((f) => f.startsWith("components/"))).toBe(true);
  });

  it("1c · App.tsx carries the banner and no longer states an unqualified proven figure", () => {
    const app = sourceOf("App.tsx");
    expect(app).toContain("<DemoDataBanner");
    // The figure goes through the component that renders NOT COMPUTED where no proof can exist.
    expect(app).toContain("<ProvenRevenueFigure");
    expect(app).toContain("<ProofRefusedNotice");
    // And the old unqualified sentence is gone: no raw `money(demoEvent.revenueReturned)` anywhere.
    expect(app).not.toMatch(/money\(\s*demoEvent\.revenueReturned\s*\)/);
  });

  it("1d · the embedded-only exemption is PROVED, not asserted", () => {
    // Every file that renders an exempt component must itself carry the banner. If one does not, the
    // exemption is hiding an unlabelled surface and this fails with its name.
    for (const exempt of EMBEDDED_ONLY) {
      const componentName = exempt.split("/").pop()!.replace(".tsx", "");
      const consumers = screens.filter(
        (f) => f !== exempt && importsOf(sourceOf(f)).some((i) => i.endsWith(componentName)),
      );
      expect(consumers.length, `${exempt} has no consumers — the exemption is dead`).toBeGreaterThan(0);
      const unlabelled = consumers.filter((f) => !sourceOf(f).includes("<DemoDataBanner"));
      expect(unlabelled, `${exempt} is rendered by unbannered screens: ${unlabelled.join(", ")}`).toEqual([]);
    }
  });

  it("2 · EVERY screen importing the seed context renders the banner", () => {
    const unlabelled = seedBacked.filter((f) => !sourceOf(f).includes("<DemoDataBanner"));
    expect(unlabelled, `seed-backed screens with no DEMO banner: ${unlabelled.join(", ")}`).toEqual([]);
  });

  it("3 · each of them imports it, so the tag is a component and not a stray string", () => {
    // Matched by SUFFIX, not by an exact specifier: the scan now spans `src/` at any depth, so the
    // relative prefix differs by folder — `src/App.tsx` reaches it as `./components/DemoDataBanner`
    // and a module as `../components/DemoDataBanner`. Pinning one spelling would have failed the file
    // the widening exists to cover, while still proving nothing about the import itself.
    for (const file of seedBacked) {
      const specifiers = importsOf(sourceOf(file));
      expect(
        specifiers.some((i) => i.endsWith("components/DemoDataBanner")),
        `${file} renders <DemoDataBanner but does not import it: ${specifiers.join(", ")}`,
      ).toBe(true);
    }
  });

  it("4 · there is exactly ONE implementation of the banner", () => {
    // A copy-pasted banner in ten files is ten things that can drift from each other and from the truth.
    const defining = screens.filter(
      (f) => f !== "components/DemoDataBanner.tsx" && /function DemoDataBanner/.test(sourceOf(f)),
    );
    expect(defining).toEqual([]);
    expect(readFileSync(`${process.cwd()}/src/components/DemoDataBanner.tsx`, "utf8"))
      .toMatch(/export function DemoDataBanner/);
  });

  it("5b · main.tsx is excluded because it SUPPLIES the context and displays nothing", () => {
    // A real distinction, proved rather than asserted: it imports the provider and not the hook, and
    // it renders no money. Were it in the set, the only way to pass would be to banner the whole app,
    // which would label the governed screens too — the opposite of what the banner is for.
    const main = sourceOf("main.tsx");
    expect(main).toContain("RecoveryProvider");
    expect(readsSeedContext(main)).toBe(false);
    expect(main).not.toMatch(/revenueReturned|auditable|Revenue Returned|\$/);
    expect(seedBacked).not.toContain("main.tsx");
  });

  it("5 · the governed screen is NOT in the set, and that is a real distinction", () => {
    // `RecoveryCaseCenter` names `useRecovery()` in its header comment to explain why it does not use it.
    // A token scan would flag it; an import scan does not. The banner would be a lie on that screen.
    expect(seedBacked).not.toContain("modules/RecoveryCaseCenter.tsx");
    expect(sourceOf("modules/RecoveryCaseCenter.tsx")).toContain("useRecovery");
    expect(sourceOf("modules/RecoveryCaseCenter.tsx")).not.toContain("<DemoDataBanner");
  });

  it("6 · the banner says DEMO and SYNTHETIC, denies proven revenue, and points somewhere", () => {
    const banner = readFileSync(`${process.cwd()}/src/components/DemoDataBanner.tsx`, "utf8");
    expect(banner).toMatch(/DEMO · SYNTHETIC DATA/);
    expect(banner).toMatch(/nothing here is proven Revenue\s*\n?\s*Returned/);
    // A warning with no destination says what not to trust, never what to do instead.
    expect(banner).toMatch(/Recovery Case/);
  });
});

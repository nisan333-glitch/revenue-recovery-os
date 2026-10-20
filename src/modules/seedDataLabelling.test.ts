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

const MODULES = `${process.cwd()}/src/modules`;
const sourceOf = (file: string): string => readFileSync(`${MODULES}/${file}`, "utf8");

/** Import specifiers only. */
const importsOf = (code: string): string[] =>
  [...code.matchAll(/(?:^|\n)\s*import\s[^;]*?from\s+["']([^"']+)["']/g)].map((m) => m[1]!);

const screens = readdirSync(MODULES).filter((f) => f.endsWith(".tsx"));
const seedBacked = screens.filter((f) => importsOf(sourceOf(f)).some((i) => i.includes("state/RecoveryContext")));

describe("seed-backed screens are labelled DEMO · SYNTHETIC DATA", () => {
  it("1 · the scan finds screens at all, so the guard can fire", () => {
    // A guard that cannot fire is not a weaker guard, it is no guard.
    expect(screens.length).toBeGreaterThan(10);
    expect(seedBacked.length).toBeGreaterThan(5);
  });

  it("2 · EVERY screen importing the seed context renders the banner", () => {
    const unlabelled = seedBacked.filter((f) => !sourceOf(f).includes("<DemoDataBanner"));
    expect(unlabelled, `seed-backed screens with no DEMO banner: ${unlabelled.join(", ")}`).toEqual([]);
  });

  it("3 · each of them imports it, so the tag is a component and not a stray string", () => {
    for (const file of seedBacked) {
      expect(importsOf(sourceOf(file)), file).toContain("../components/DemoDataBanner");
    }
  });

  it("4 · there is exactly ONE implementation of the banner", () => {
    // A copy-pasted banner in ten files is ten things that can drift from each other and from the truth.
    const defining = screens.filter((f) => /function DemoDataBanner/.test(sourceOf(f)));
    expect(defining).toEqual([]);
    expect(readFileSync(`${process.cwd()}/src/components/DemoDataBanner.tsx`, "utf8"))
      .toMatch(/export function DemoDataBanner/);
  });

  it("5 · the governed screen is NOT in the set, and that is a real distinction", () => {
    // `RecoveryCaseCenter` names `useRecovery()` in its header comment to explain why it does not use it.
    // A token scan would flag it; an import scan does not. The banner would be a lie on that screen.
    expect(seedBacked).not.toContain("RecoveryCaseCenter.tsx");
    expect(sourceOf("RecoveryCaseCenter.tsx")).toContain("useRecovery");
    expect(sourceOf("RecoveryCaseCenter.tsx")).not.toContain("<DemoDataBanner");
  });

  it("6 · the banner says DEMO and SYNTHETIC, denies proven revenue, and points somewhere", () => {
    const banner = readFileSync(`${process.cwd()}/src/components/DemoDataBanner.tsx`, "utf8");
    expect(banner).toMatch(/DEMO · SYNTHETIC DATA/);
    expect(banner).toMatch(/nothing here is proven Revenue\s*\n?\s*Returned/);
    // A warning with no destination says what not to trust, never what to do instead.
    expect(banner).toMatch(/Recovery Case/);
  });
});

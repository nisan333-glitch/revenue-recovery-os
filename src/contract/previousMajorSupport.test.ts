// The previous-major support registry: the governed fact of WHICH older majors are read, HOW FAR, and
// by what means.
//
// WHAT THESE TESTS ARE FOR. The registry replaced a hole, not an inconvenience: before it, a previous
// major declared compatible was compatible to INFINITY, so an implemented 2.0.0 accepted `1.999.999`
// while refusing `2.0.1` as too new. So the tests below are mostly about what the registry REFUSES, and
// about the one thing that must never happen — a malformed or missing ceiling quietly meaning "no
// limit".
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PREVIOUS_MAJOR_SUPPORT,
  PREVIOUS_MAJOR_SUPPORT_RULE,
  declaredPreviousMajors,
  parseTriple,
  previousMajorSupport,
  previousMajorSupportDecision,
  projectSupportDeclarations,
  withinPreviousMajorCeiling,
  type PreviousMajorSupportEntry,
} from "./previousMajorSupport";
import { MAJOR_ROW_SEMANTICS, PILOT_DATA_CONTRACT_VERSION, parseContractVersion } from "./pilotDataContract";
// THE SELECTOR MODULE IS NOT REFERENCED HERE AT ALL — not imported, not type-imported, not named. Its
// own pinned inertness vector fails on ANY textual occurrence of its module name outside its own test,
// which is stricter than "no import" and is not ours to relax. So the two cross-consumer tests — the
// projection's type compatibility, and the agreement between the selector and the live predicate — live
// in that module's own test file, which is already its one permitted importer.

const triple = (v: string) => parseTriple(v)!;

describe("previous-major support · the registry's governed facts", () => {
  it("names its rule, so a change in what it decides is a new id rather than a silent re-grade", () => {
    expect(PREVIOUS_MAJOR_SUPPORT_RULE).toBe("nh-previous-major-support-v1");
  });

  it("declares exactly one real previous-major relationship today: 2 reads 1, up to 1.1.0, IDENTICAL", () => {
    // THE SINGLE CEILING FACT. `1.1.0` was the last 1.x this product published. It is written here and
    // nowhere else — stated by a human, never computed from git history, which would have swallowed the
    // reverted 2.1.0 experiment.
    expect(declaredPreviousMajors(2)).toEqual([1]);
    expect(previousMajorSupport(2, 1)).toEqual({ mode: "IDENTICAL", maxSupportedVersion: "1.1.0" });
  });

  it("major 1 declares no previous major — there is no major 0", () => {
    expect(declaredPreviousMajors(1)).toEqual([]);
    expect(previousMajorSupport(1, 0)).toBeNull();
  });

  it("every entry carries a parseable ceiling for its own major, and names an interpreter iff preserved", () => {
    // A registry-wide well-formedness check, so a future entry cannot be added half-written.
    for (const [implemented, entries] of Object.entries(PREVIOUS_MAJOR_SUPPORT)) {
      for (const [previous, entry] of Object.entries(entries as Record<number, PreviousMajorSupportEntry>)) {
        const where = `implemented ${implemented} → previous ${previous}`;
        const ceiling = parseTriple(entry.maxSupportedVersion);
        expect(ceiling, where).not.toBeNull();
        expect(ceiling!.major, where).toBe(Number(previous));
        expect(Number(previous), where).toBeLessThan(Number(implemented));
        if (entry.mode === "PRESERVED_INTERPRETER") {
          expect(typeof entry.interpreter, where).toBe("string");
          expect((entry.interpreter ?? "").trim(), where).not.toBe("");
        } else {
          expect(entry.mode, where).toBe("IDENTICAL");
        }
      }
    }
  });
});

describe("previous-major support · fails closed", () => {
  it("an UNDECLARED previous major is unsupported — absence is the safe default, written by nobody", () => {
    expect(previousMajorSupport(2, 0)).toBeNull();
    expect(withinPreviousMajorCeiling(2, triple("0.9.0"))).toBe(false);
  });

  it("an UNKNOWN implemented major declares nothing — a future major grants itself no window", () => {
    // The fail-closed default survives opening the window once: major 3 saying nothing refuses major 2.
    expect(previousMajorSupport(3, 2)).toBeNull();
    expect(withinPreviousMajorCeiling(3, triple("2.0.0"))).toBe(false);
    expect(declaredPreviousMajors(3)).toEqual([]);
  });

  it("never infers support from PROXIMITY — one major below is not a relationship", () => {
    expect(withinPreviousMajorCeiling(3, triple("2.999.999"))).toBe(false);
  });
});

describe("previous-major support · the ceiling comparison", () => {
  it("accepts up to and INCLUDING the ceiling — it is a ceiling, not an allowlist", () => {
    for (const v of ["1.0.0", "1.0.1", "1.0.99", "1.1.0"]) {
      expect(withinPreviousMajorCeiling(2, triple(v)), v).toBe(true);
    }
  });

  it("refuses anything above it — the boundary pair is 1.1.0 / 1.1.1", () => {
    expect(withinPreviousMajorCeiling(2, triple("1.1.0"))).toBe(true);
    expect(withinPreviousMajorCeiling(2, triple("1.1.1"))).toBe(false);
    for (const v of ["1.1.1", "1.2.0", "1.99.0", "1.999.999"]) {
      expect(withinPreviousMajorCeiling(2, triple(v)), v).toBe(false);
    }
  });

  it("a MALFORMED ceiling refuses everything rather than admitting everything", () => {
    // THE FAILURE MODE THIS MODULE EXISTS TO PREVENT. A typo in the registry must not silently become
    // "no limit" — which is precisely the defect being closed. Probed through a stand-in registry shape
    // rather than by mutating the real one.
    const broken: PreviousMajorSupportEntry = { mode: "IDENTICAL", maxSupportedVersion: "1.1" };
    expect(parseTriple(broken.maxSupportedVersion)).toBeNull();
    for (const bad of ["", "1.1", "v1.1.0", "1.1.0-rc1", "1.1.x", "1.1.0.0", "a.b.c"]) {
      expect(parseTriple(bad), bad).toBeNull();
    }
    // SURROUNDING WHITESPACE IS NOT MALFORMED, because `parseContractVersion` trims and this parser is
    // rule-identical to it by construction. Pinned so the two cannot drift apart on this point again.
    expect(parseTriple(" 1.1.0")).toEqual({ major: 1, minor: 1, patch: 0 });
    expect(parseTriple("1.1.0 ")).toEqual({ major: 1, minor: 1, patch: 0 });
  });

  it("a ceiling recorded for a DIFFERENT major is meaningless, so it refuses", () => {
    // Checked rather than asserted away: the comparison would otherwise be between unrelated numbers.
    const ceiling = triple("2.0.0");
    expect(ceiling.major).not.toBe(1);
    // The real registry has no such entry — this pins the rule the comparison applies.
    expect(withinPreviousMajorCeiling(2, { major: 1, minor: 0, patch: 0 })).toBe(true);
    expect(withinPreviousMajorCeiling(2, { major: 2, minor: 0, patch: 0 })).toBe(false);
  });
});

describe("previous-major support · parseTriple agrees with the contract's parser", () => {
  // WHY THIS EXISTS. The registry imports NOTHING — `pilotDataContract.ts` has no imports of its own and
  // must consume the registry, so the registry must not import back or the contract root acquires a
  // cycle. The price is one semver regex in two places. This test makes that duplication CHECKED rather
  // than hoped: the two parsers must agree on every input, well-formed and malformed alike.
  const BATTERY = [
    "0.0.0", "1.0.0", "1.1.0", "1.1.1", "2.0.0", "10.20.30", "1.999.999",
    "", " ", "1", "1.1", "1.1.0.0", "v1.1.0", "1.1.0-rc1", "1.1.x", " 1.1.0", "1.1.0 ",
    "-1.0.0", "1.-1.0", "01.1.0", "1.01.0", "a.b.c", "1,1,0",
  ];

  it("agrees on parseability for every input in the battery", () => {
    for (const v of BATTERY) {
      expect(parseTriple(v) === null, v).toBe(parseContractVersion(v) === null);
    }
  });

  it("agrees on the parsed components wherever both parse", () => {
    for (const v of BATTERY) {
      const mine = parseTriple(v);
      const theirs = parseContractVersion(v);
      if (mine === null || theirs === null) continue;
      expect({ ...mine }, v).toEqual({ major: theirs.major, minor: theirs.minor, patch: theirs.patch });
    }
  });
});

describe("previous-major support · the projection", () => {
  it("projects the real facts, entry for entry", () => {
    expect(projectSupportDeclarations(2)).toEqual({ 1: { mode: "IDENTICAL", maxSupportedVersion: "1.1.0" } });
  });

  it("projects an empty set for a major that declares nothing — no accidental grant", () => {
    expect(Object.keys(projectSupportDeclarations(3))).toEqual([]);
    expect(Object.keys(projectSupportDeclarations(1))).toEqual([]);
  });

  it("carries a ceiling on EVERY projected declaration — at runtime, not only in the types", () => {
    // The selector's `maxSupportedVersion` is a required field, so a ceiling-less declaration does not
    // compile. This asserts the projection never produces one at RUNTIME either, which is the half the
    // type system cannot see for data crossing a boundary.
    for (const implemented of [1, 2, 3]) {
      for (const entry of Object.values(projectSupportDeclarations(implemented))) {
        expect(typeof entry.maxSupportedVersion).toBe("string");
        expect(parseTriple(entry.maxSupportedVersion)).not.toBeNull();
      }
    }
  });
});

describe("previous-major support · the COMPLETE decision · mode and evidence", () => {
  // THE DEFECT THIS SECTION FIXES. The live predicate used to require `MAJOR_ROW_SEMANTICS` membership
  // for EVERY mode — right for IDENTICAL, wrong for PRESERVED_INTERPRETER, whose premise is that the row
  // semantics are NOT identical. A future preserved major would have been refused by the live gate while
  // the selector accepted it, and the tempting repair would have been a FALSE identity declaration.
  //
  // THESE ARE HYPOTHETICAL ENTRIES, and that is the only way to prove a future major's behaviour before
  // any constant is bumped. `isSupportedContractVersion` reads the module-level registry and is NOT
  // exercised against them — it is proven separately, against the REAL registry.
  const at = (over: Partial<PreviousMajorSupportEntry> = {}): PreviousMajorSupportEntry => ({
    mode: "IDENTICAL",
    maxSupportedVersion: "2.0.0",
    ...over,
  });
  const v = (s: string) => parseTriple(s)!;

  it("IDENTICAL requires the row-semantics evidence — an entry cannot assert an unchecked identity", () => {
    expect(previousMajorSupportDecision(at(), v("2.0.0"), true)).toBe(true);
    expect(previousMajorSupportDecision(at(), v("2.0.0"), false)).toBe(false);
  });

  it("PRESERVED_INTERPRETER does NOT require it — the semantics are specifically not identical", () => {
    const preserved = at({ mode: "PRESERVED_INTERPRETER", interpreter: "nh-interp-2x" });
    expect(previousMajorSupportDecision(preserved, v("2.0.0"), false)).toBe(true);
    // And it is not merely tolerant of the evidence — it is indifferent to it.
    expect(previousMajorSupportDecision(preserved, v("2.0.0"), true)).toBe(true);
  });

  it("PRESERVED_INTERPRETER requires a NAMED interpreter — an unnamed one would fall through", () => {
    for (const interpreter of [undefined, "", "   "]) {
      const entry = at({ mode: "PRESERVED_INTERPRETER", interpreter } as Partial<PreviousMajorSupportEntry>);
      expect(previousMajorSupportDecision(entry, v("2.0.0"), false), JSON.stringify(interpreter)).toBe(false);
      // Not rescued by the evidence either: a missing name is its own disqualification.
      expect(previousMajorSupportDecision(entry, v("2.0.0"), true), JSON.stringify(interpreter)).toBe(false);
    }
  });

  it("the CEILING applies under BOTH modes — no mode can opt out of it", () => {
    const identical = at();
    const preserved = at({ mode: "PRESERVED_INTERPRETER", interpreter: "nh-interp-2x" });
    for (const above of ["2.0.1", "2.1.0", "2.999.999"]) {
      expect(previousMajorSupportDecision(identical, v(above), true), `IDENTICAL ${above}`).toBe(false);
      expect(previousMajorSupportDecision(preserved, v(above), false), `PRESERVED ${above}`).toBe(false);
    }
    // At and below the ceiling, each mode's own rule decides.
    expect(previousMajorSupportDecision(identical, v("2.0.0"), true)).toBe(true);
    expect(previousMajorSupportDecision(preserved, v("2.0.0"), false)).toBe(true);
  });

  it("an UNRECOGNISED mode refuses — no fallthrough to the ceiling result", () => {
    const unknown = { mode: "SOMETHING_ELSE", maxSupportedVersion: "2.0.0" } as unknown as PreviousMajorSupportEntry;
    // The ceiling itself would admit this version, so an acceptance here could only come from falling
    // through the mode switch. It must not.
    expect(previousMajorSupportDecision(unknown, v("2.0.0"), true)).toBe(false);
    expect(previousMajorSupportDecision(unknown, v("2.0.0"), false)).toBe(false);
  });

  it("an ABSENT entry refuses, whatever the evidence says", () => {
    expect(previousMajorSupportDecision(null, v("2.0.0"), true)).toBe(false);
    expect(previousMajorSupportDecision(null, v("2.0.0"), false)).toBe(false);
  });

  it("a MALFORMED or WRONG-MAJOR ceiling refuses under both modes — never 'no limit'", () => {
    for (const bad of ["", "2.0", "v2.0.0", "2.0.0-rc1"]) {
      expect(previousMajorSupportDecision(at({ maxSupportedVersion: bad }), v("2.0.0"), true), bad).toBe(false);
      expect(
        previousMajorSupportDecision(
          at({ mode: "PRESERVED_INTERPRETER", interpreter: "nh-interp-2x", maxSupportedVersion: bad }),
          v("2.0.0"),
          false,
        ),
        bad,
      ).toBe(false);
    }
    // A ceiling belonging to another major makes the comparison meaningless.
    expect(previousMajorSupportDecision(at({ maxSupportedVersion: "9.9.9" }), v("2.0.0"), true)).toBe(false);
  });

  it("the REAL registry entry, routed through the complete decision, still admits exactly 1.x ≤ 1.1.0", () => {
    const real = previousMajorSupport(2, 1);
    for (const [declared, expected] of [["1.0.0", true], ["1.1.0", true], ["1.1.1", false], ["1.999.999", false]] as const) {
      expect(previousMajorSupportDecision(real, v(declared), true), declared).toBe(expected);
    }
    // And the real entry is IDENTICAL, so without the evidence it refuses outright.
    expect(previousMajorSupportDecision(real, v("1.1.0"), false)).toBe(false);
  });
});

describe("previous-major support · the complete decision is the ONLY gate", () => {
  it("the live predicate's module calls the complete decision, not the narrow ceiling query", () => {
    // CONSTRAINT BY STRUCTURE. `withinPreviousMajorCeiling` answers the ceiling alone and says nothing
    // about the mode, so using it as an admission check would re-open the defect in a new shape. This
    // asserts the contract module gates on the complete decision instead. Comments are stripped, because
    // the call site legitimately NAMES the old conjunction in prose to explain what it replaced.
    const code = readFileSync(join(__dirname, "pilotDataContract.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(code).toMatch(/previousMajorSupportDecision\(/);
    expect(code).not.toMatch(/withinPreviousMajorCeiling/);
  });
});

describe("previous-major support · it is not MAJOR_ROW_SEMANTICS", () => {
  it("is a DIFFERENT fact, and neither derives the other", () => {
    // MAJOR_ROW_SEMANTICS = EVIDENCE that row semantics are identical. It says nothing about HOW FAR
    // support reaches, and the ceiling is NOT taken from it. The registry = the governed SUPPORT fact.
    const implMajor = parseContractVersion(PILOT_DATA_CONTRACT_VERSION)!.major;
    expect(MAJOR_ROW_SEMANTICS[implMajor]).toEqual([1]);
    // The evidence names a major; it carries no version at all, which is why a ceiling was needed.
    expect(JSON.stringify(MAJOR_ROW_SEMANTICS)).not.toContain("1.1.0");
  });

  it("every IDENTICAL entry has matching row-semantics evidence", () => {
    // A registry entry claiming IDENTICAL without that evidence would assert an identity nobody checked.
    for (const [implemented, entries] of Object.entries(PREVIOUS_MAJOR_SUPPORT)) {
      const evidence = MAJOR_ROW_SEMANTICS[Number(implemented)] ?? [];
      for (const [previous, entry] of Object.entries(entries as Record<number, PreviousMajorSupportEntry>)) {
        if (entry.mode !== "IDENTICAL") continue;
        expect(evidence, `implemented ${implemented} claims IDENTICAL for ${previous}`).toContain(Number(previous));
      }
    }
  });
});

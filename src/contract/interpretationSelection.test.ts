// The selection semantics of dual-major support, specified before anything dispatches on them.
//
// Two kinds of test live here and they are not interchangeable. The behavioural ones pin what the
// selector decides. The STRUCTURAL one pins that nothing runs it yet — which is the property that makes
// this slice safe to land, and the property a later slice will deliberately break when it wires dispatch.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  INTERPRETATION_SELECTION_RULE,
  selectDataInterpretation,
  type MajorSupportDeclarations,
} from "./interpretationSelection";
import { MAJOR_ROW_SEMANTICS, PILOT_DATA_CONTRACT_VERSION, acceptsPreviousMajor, isSupportedContractVersion } from "./pilotDataContract";
// The REAL support facts, as DATA. Importing the registry into this TEST is fine and is the point:
// the structural assertion below is about what the PRODUCTION module imports, which is unchanged.
import { PREVIOUS_MAJOR_SUPPORT, parseTriple, previousMajorSupportDecision, projectSupportDeclarations } from "./previousMajorSupport";

const NONE: MajorSupportDeclarations = Object.freeze({});
const pick = (declaredVersion: string, implementedVersion: string, declarations: MajorSupportDeclarations = NONE) =>
  selectDataInterpretation({ declaredVersion, implementedVersion, declarations });

describe("interpretation selection · same major", () => {
  it("1 · selects the current interpretation for an exactly-matching version", () => {
    const d = pick("2.0.0", "2.0.0");
    expect(d.selected).toBe(true);
    if (!d.selected) return;
    expect(d.selection.rule).toBe(INTERPRETATION_SELECTION_RULE);
    expect(d.selection.kind).toBe("current_major");
    expect(d.selection.declaredMajor).toBe(2);
    expect(d.selection.interpretationMajor).toBe(2);
    expect(d.selection.preservedInterpreter).toBeNull();
  });

  it("1b · selects the current interpretation for an OLDER minor or patch of the same major", () => {
    // What a minor promises: "a dataset valid under X.Y is still valid under X.(Y+1)". So there is
    // nothing to select between inside a major, and no declaration is consulted.
    for (const declared of ["2.0.0", "2.0.1", "2.1.0"]) {
      const d = pick(declared, "2.2.3");
      expect(d.selected, declared).toBe(true);
      if (!d.selected) continue;
      expect(d.selection.kind, declared).toBe("current_major");
      expect(d.selection.interpretationMajor, declared).toBe(2);
    }
  });

  it("5 · refuses a NEWER major — a build never guesses at a contract it does not implement", () => {
    const d = pick("3.0.0", "2.0.0", { 2: { mode: "IDENTICAL", maxSupportedVersion: "2.0.0" } });
    expect(d.selected).toBe(false);
    if (d.selected) return;
    expect(d.refusal.reason).toBe("declared_major_newer_than_implemented");
  });

  it("5b · refuses a newer MINOR and a newer PATCH of the same major", () => {
    for (const declared of ["2.1.0", "2.0.1"]) {
      const d = pick(declared, "2.0.0");
      expect(d.selected, declared).toBe(false);
      if (d.selected) continue;
      expect(d.refusal.reason, declared).toBe("declared_minor_or_patch_newer_than_implemented");
    }
  });

  it("6 · refuses a malformed version on either side", () => {
    const bad = pick("not-a-version", "2.0.0");
    expect(bad.selected).toBe(false);
    if (!bad.selected) expect(bad.refusal.reason).toBe("declared_version_malformed");

    const badImpl = pick("2.0.0", "2.0");
    expect(badImpl.selected).toBe(false);
    if (!badImpl.selected) expect(badImpl.refusal.reason).toBe("implemented_version_malformed");
  });
});

describe("interpretation selection · previous major", () => {
  it("2 · IDENTICAL means the previous major uses the CURRENT interpretation", () => {
    const d = pick("1.1.0", "2.0.0", projectSupportDeclarations(2));
    expect(d.selected).toBe(true);
    if (!d.selected) return;
    expect(d.selection.kind).toBe("previous_major_identical");
    expect(d.selection.declaredMajor).toBe(1);
    // THE POINT: identical semantics ⇒ the implemented major's code is the correct reader.
    expect(d.selection.interpretationMajor).toBe(2);
    expect(d.selection.preservedInterpreter).toBeNull();
  });

  it("3 · PRESERVED_INTERPRETER selects the PREVIOUS major's own interpretation, and names it", () => {
    const d = pick("2.0.0", "3.0.0", { 2: { mode: "PRESERVED_INTERPRETER", interpreter: "nh-interp-2x", maxSupportedVersion: "2.0.0" } });
    expect(d.selected).toBe(true);
    if (!d.selected) return;
    expect(d.selection.kind).toBe("previous_major_preserved");
    expect(d.selection.declaredMajor).toBe(2);
    // THE POINT: preserved semantics ⇒ the current code is the WRONG reader.
    expect(d.selection.interpretationMajor).toBe(2);
    expect(d.selection.interpretationMajor).not.toBe(3);
    expect(d.selection.preservedInterpreter).toBe("nh-interp-2x");
  });

  it("4 · 9 · refuses a previous major with NO declaration — absent means unsupported", () => {
    const d = pick("1.0.0", "2.0.0", NONE);
    expect(d.selected).toBe(false);
    if (d.selected) return;
    expect(d.refusal.reason).toBe("previous_major_not_declared");
  });

  it("9b · never infers support from version PROXIMITY — an adjacent major is still undeclared", () => {
    // Major 2 sitting one below major 3 means nothing at all.
    const adjacent = pick("2.0.0", "3.0.0", NONE);
    expect(adjacent.selected).toBe(false);
    // And declaring a DIFFERENT major grants nothing to this one.
    const other = pick("2.0.0", "3.0.0", { 1: { mode: "IDENTICAL", maxSupportedVersion: "1.0.0" } });
    expect(other.selected).toBe(false);
    if (other.selected) return;
    expect(other.refusal.reason).toBe("previous_major_not_declared");
  });

  it("7 · refuses PRESERVED_INTERPRETER that names no interpreter", () => {
    for (const declaration of [
      { mode: "PRESERVED_INTERPRETER" as const, maxSupportedVersion: "2.0.0" },
      { mode: "PRESERVED_INTERPRETER" as const, interpreter: "", maxSupportedVersion: "2.0.0" },
      { mode: "PRESERVED_INTERPRETER" as const, interpreter: "   ", maxSupportedVersion: "2.0.0" },
    ]) {
      const d = pick("2.0.0", "3.0.0", { 2: declaration });
      expect(d.selected).toBe(false);
      if (d.selected) continue;
      expect(d.refusal.reason).toBe("preserved_interpreter_not_named");
    }
  });

  it("8 · NO FALLBACK · preserved never degrades to identical or to current semantics", () => {
    // An unnamed preserved interpreter refuses rather than reading the data under current semantics.
    const unnamed = pick("2.0.0", "3.0.0", { 2: { mode: "PRESERVED_INTERPRETER", maxSupportedVersion: "2.0.0" } });
    expect(unnamed.selected).toBe(false);
    if (!unnamed.selected) {
      expect(unnamed.refusal.reason).not.toBe("previous_major_not_declared");
      expect(unnamed.refusal.reason).toBe("preserved_interpreter_not_named");
    }
    // And a NAMED preserved interpreter never reports the implemented major as the reader.
    const named = pick("2.0.0", "3.0.0", { 2: { mode: "PRESERVED_INTERPRETER", interpreter: "nh-interp-2x", maxSupportedVersion: "2.0.0" } });
    expect(named.selected).toBe(true);
    if (named.selected) {
      expect(named.selection.kind).not.toBe("previous_major_identical");
      expect(named.selection.kind).not.toBe("current_major");
      expect(named.selection.interpretationMajor).toBe(2);
    }
  });

  it("11 · refuses a declaration ABOVE the ceiling its own entry carries", () => {
    // THE DEFECT THIS CLOSES. Before the ceiling existed, a declared major below the implemented one was
    // supported to INFINITY, so this case was silently SELECTED — and under PRESERVED_INTERPRETER it
    // would have handed 2.999.999 to a reader built for 2.0.0.
    for (const declared of ["2.0.1", "2.1.0", "2.999.999"]) {
      const d = pick(declared, "3.0.0", {
        2: { mode: "PRESERVED_INTERPRETER", interpreter: "nh-interp-2x", maxSupportedVersion: "2.0.0" },
      });
      expect(d.selected, declared).toBe(false);
      if (d.selected) continue;
      expect(d.refusal.reason, declared).toBe("declared_above_previous_major_ceiling");
    }
  });

  it("11b · the ceiling is INCLUSIVE — a ceiling, never an exact-version allowlist", () => {
    const d = pick("2.0.0", "3.0.0", {
      2: { mode: "PRESERVED_INTERPRETER", interpreter: "nh-interp-2x", maxSupportedVersion: "2.0.0" },
    });
    expect(d.selected).toBe(true);
    // And every version BELOW the ceiling is in, which an allowlist would have refused.
    const below = pick("2.0.0", "3.0.0", {
      2: { mode: "PRESERVED_INTERPRETER", interpreter: "nh-interp-2x", maxSupportedVersion: "2.4.0" },
    });
    expect(below.selected).toBe(true);
  });

  it("12 · an UNUSABLE ceiling refuses as its own reason — never as 'no limit'", () => {
    // Reachable despite the required field: declarations can arrive from data the type system never saw.
    // Each of these must refuse, and must NOT fall through to IDENTICAL or PRESERVED_INTERPRETER.
    const shapes: [string, unknown][] = [
      ["missing at runtime", { mode: "IDENTICAL" }],
      ["empty", { mode: "IDENTICAL", maxSupportedVersion: "" }],
      ["malformed", { mode: "IDENTICAL", maxSupportedVersion: "2.0" }],
      ["prefixed", { mode: "IDENTICAL", maxSupportedVersion: "v2.0.0" }],
      ["prerelease", { mode: "IDENTICAL", maxSupportedVersion: "2.0.0-rc1" }],
      ["wrong major", { mode: "IDENTICAL", maxSupportedVersion: "9.9.9" }],
    ];
    for (const [label, declaration] of shapes) {
      const d = pick("2.0.0", "3.0.0", { 2: declaration } as never);
      expect(d.selected, label).toBe(false);
      if (d.selected) continue;
      expect(d.refusal.reason, label).toBe("support_declaration_invalid");
      // It must not be reported as a MODE problem, nor as the major being undeclared.
      expect(d.refusal.reason, label).not.toBe("previous_major_not_declared");
      expect(d.refusal.reason, label).not.toBe("support_mode_unrecognised");
    }
  });

  it("12b · a VALID ceiling leaves the mode refusals unmasked — each reason still reports itself", () => {
    // THE ORDERING PROPERTY. The ceiling is checked before the mode, so a ceiling complaint could have
    // swallowed every mode refusal. With a valid, satisfied ceiling, each one must still surface.
    const unnamed = pick("2.0.0", "3.0.0", {
      2: { mode: "PRESERVED_INTERPRETER", maxSupportedVersion: "2.0.0" },
    });
    expect(unnamed.selected).toBe(false);
    if (!unnamed.selected) expect(unnamed.refusal.reason).toBe("preserved_interpreter_not_named");

    const unknownMode = pick("2.0.0", "3.0.0", {
      2: { mode: "SOMETHING_ELSE", maxSupportedVersion: "2.0.0" },
    } as never);
    expect(unknownMode.selected).toBe(false);
    if (!unknownMode.selected) expect(unknownMode.refusal.reason).toBe("support_mode_unrecognised");
  });

  it("8b · NO FALLBACK · an unrecognised mode refuses rather than defaulting to anything", () => {
    const d = pick("2.0.0", "3.0.0", { 2: { mode: "SOMETHING_ELSE", maxSupportedVersion: "2.0.0" } as never });
    expect(d.selected).toBe(false);
    if (d.selected) return;
    expect(d.refusal.reason).toBe("support_mode_unrecognised");
  });
});

describe("interpretation selection · properties", () => {
  it("10 · is deterministic — identical inputs yield a deeply equal decision every time", () => {
    const args = { declaredVersion: "2.0.0", implementedVersion: "3.0.0", declarations: { 2: { mode: "PRESERVED_INTERPRETER" as const, interpreter: "nh-interp-2x", maxSupportedVersion: "2.0.0" } } };
    expect(selectDataInterpretation(args)).toEqual(selectDataInterpretation(args));
    expect(pick("1.0.0", "2.0.0")).toEqual(pick("1.0.0", "2.0.0"));
  });

  it("never throws, and every refusal carries a named reason and a detail", () => {
    const inputs: [string, string][] = [
      ["", "2.0.0"], ["2.0.0", ""], ["x", "y"], ["9.9.9", "2.0.0"], ["1.0.0", "2.0.0"], ["2.0.0", "2.0.0"],
    ];
    for (const [declared, implemented] of inputs) {
      const d = selectDataInterpretation({ declaredVersion: declared, implementedVersion: implemented, declarations: NONE });
      if (!d.selected) {
        expect(d.refusal.reason, `${declared}/${implemented}`).toBeTruthy();
        expect(d.refusal.detail.length, `${declared}/${implemented}`).toBeGreaterThan(0);
        expect(d.refusal.rule).toBe(INTERPRETATION_SELECTION_RULE);
      }
    }
  });

  it("refusal details carry no customer data — only versions and majors", () => {
    const d = pick("1.0.0", "2.0.0", NONE);
    if (d.selected) return;
    expect(d.refusal.detail).not.toMatch(/@|synthetic-|acct-|INV-/);
  });

  it("maps today's REAL registry onto IDENTICAL — evidence, not a migration", () => {
    // `MAJOR_ROW_SEMANTICS` is NOT read, replaced or modified by the selector, and is NOT the source of
    // the ceiling. This test only shows that the real registry fact is expressible as the IDENTICAL
    // mode, so the model subsumes what is already there. Any unification is deferred.
    const implemented = PILOT_DATA_CONTRACT_VERSION;
    const implMajor = Number(implemented.split(".")[0]);

    // Today: major 2 implemented, major 1 declared identical.
    expect(MAJOR_ROW_SEMANTICS[implMajor]).toEqual([1]);
    const d = pick("1.1.0", implemented, projectSupportDeclarations(implMajor));
    expect(d.selected).toBe(true);
    if (!d.selected) return;
    expect(d.selection.kind).toBe("previous_major_identical");
    expect(d.selection.interpretationMajor).toBe(implMajor);
  });

  it("the registry's projection IS a MajorSupportDeclarations — a type-level assertion, not decoration", () => {
    // THIS LIVES HERE RATHER THAN BESIDE THE REGISTRY, and deliberately. The registry imports nothing,
    // so it cannot name this type; and this module's pinned inertness vector forbids the registry's test
    // from naming this module. This file is the one place both sides are legitimately in scope, so the
    // compatibility is pinned here instead of hoped for.
    const declarations: MajorSupportDeclarations = projectSupportDeclarations(2);
    expect(declarations[1]).toEqual({ mode: "IDENTICAL", maxSupportedVersion: "1.1.0" });
  });

  it("the live predicate and this selector AGREE across a previous-major sweep — one ceiling fact", () => {
    // ITEM 8. `isSupportedContractVersion` reads the registry directly; this selector is handed the
    // registry's PROJECTION. Two routes, one fact — so they must answer identically for every
    // previous-major version. A disagreement would mean the ceiling drifted, which is the entire failure
    // mode this slice exists to make impossible.
    const IMPLEMENTED = "2.0.0";
    const real = projectSupportDeclarations(2);
    for (const declared of ["1.0.0", "1.0.1", "1.1.0", "1.1.1", "1.2.0", "1.99.0", "1.999.999", "0.9.0", "0.0.1"]) {
      const live = isSupportedContractVersion(declared, IMPLEMENTED);
      const selected = pick(declared, IMPLEMENTED, real).selected;
      expect(selected, `${declared}: live=${live} selector=${selected}`).toBe(live);
    }
  });

  it("and they agree on the BOUNDARY specifically — 1.1.0 in, 1.1.1 out, through both", () => {
    const real = projectSupportDeclarations(2);
    const through = (declared: string) => ({
      live: isSupportedContractVersion(declared, "2.0.0"),
      selector: pick(declared, "2.0.0", real).selected,
    });
    expect(through("1.1.0")).toEqual({ live: true, selector: true });
    expect(through("1.1.1")).toEqual({ live: false, selector: false });
    expect(through("1.999.999")).toEqual({ live: false, selector: false });
  });

  it("CLASS B · HYPOTHETICAL future modes · the decision function and this selector agree", () => {
    // TWO CLASSES OF CONSISTENCY, KEPT APART. Class A above compares the LIVE PREDICATE against this
    // selector over the REAL registry. This one compares the registry's pure DECISION FUNCTION against
    // this selector over HYPOTHETICAL entries — the only way a future major's behaviour can be proven
    // before any constant is bumped.
    //
    // `isSupportedContractVersion` IS NOT EXERCISED HERE. It reads the module-level registry, which holds
    // no major-3 entry, so claiming it was tested against a hypothetical would be false.
    const IMPL = "3.0.0";
    const named = "nh-interp-2x";
    const cases: [label: string, entry: Record<string, unknown>, declared: string, evidence: boolean, expected: boolean][] = [
      ["IDENTICAL + evidence true",            { mode: "IDENTICAL", maxSupportedVersion: "2.0.0" },                              "2.0.0", true,  true],
      ["IDENTICAL + evidence false",           { mode: "IDENTICAL", maxSupportedVersion: "2.0.0" },                              "2.0.0", false, false],
      ["PRESERVED + evidence false + named",   { mode: "PRESERVED_INTERPRETER", interpreter: named, maxSupportedVersion: "2.0.0" }, "2.0.0", false, true],
      ["PRESERVED + blank interpreter",        { mode: "PRESERVED_INTERPRETER", interpreter: "   ", maxSupportedVersion: "2.0.0" }, "2.0.0", false, false],
      ["PRESERVED + missing interpreter",      { mode: "PRESERVED_INTERPRETER", maxSupportedVersion: "2.0.0" },                   "2.0.0", false, false],
      ["IDENTICAL above ceiling",              { mode: "IDENTICAL", maxSupportedVersion: "2.0.0" },                              "2.1.0", true,  false],
      ["PRESERVED above ceiling",              { mode: "PRESERVED_INTERPRETER", interpreter: named, maxSupportedVersion: "2.0.0" }, "2.1.0", false, false],
      ["unknown mode",                         { mode: "SOMETHING_ELSE", maxSupportedVersion: "2.0.0" },                          "2.0.0", true,  false],
    ];
    for (const [label, entry, declared, evidence, expected] of cases) {
      const decision = previousMajorSupportDecision(entry as never, parseTriple(declared)!, evidence);
      expect(decision, `${label} · decision`).toBe(expected);
    }

    // ── AND NOW THE SELECTOR, ON THE AXES IT CAN ACTUALLY SEE ──────────────────────────────────────
    //
    // ONE ASYMMETRY, ARCHITECTURAL AND CORRECT — reported rather than hidden, because an earlier draft
    // of this test asserted blanket agreement and failed on it.
    //
    // The selector has NO access to `MAJOR_ROW_SEMANTICS`: it imports only the version parser, stays
    // pure and parameterised, and its declarations arrive as data. So it cannot enforce the
    // row-semantics evidence, and must not — giving it that access would mean importing the registry,
    // which the inertness vector and the agreed architecture both forbid.
    //
    // The two therefore answer DIFFERENT questions. The gate asks "may this dataset be admitted at
    // all?", which for IDENTICAL includes the evidence. The selector asks "given that it is supported,
    // which interpretation reads it?". A dataset the gate refuses never reaches the selector, so
    // `IDENTICAL + evidence false` being refused by one and selected by the other is not a
    // disagreement about a shared question — it is one check living upstream of the other.
    //
    // On every axis the selector CAN see — ceiling, mode, interpreter naming — they must agree exactly.
    for (const [label, entry, declared, evidence, expected] of cases) {
      const selected = pick(declared, IMPL, { 2: entry } as never).selected;
      const decision = previousMajorSupportDecision(entry as never, parseTriple(declared)!, evidence);
      const evidenceIsTheOnlyDifference =
        (entry as { mode?: string }).mode === "IDENTICAL" && evidence === false;
      if (evidenceIsTheOnlyDifference) {
        // The selector cannot see it, so it selects; the gate refuses. Pinned explicitly.
        expect(selected, `${label} · selector cannot see the evidence`).toBe(true);
        expect(decision, `${label} · the gate refuses on it`).toBe(false);
      } else {
        expect(selected, `${label} · selector`).toBe(expected);
        expect(selected, `${label} · the two agree on this axis`).toBe(decision);
      }
    }
  });

  it("CLASS B · the live gate would have refused the PRESERVED case before the correction", () => {
    // THE DEFECT, PINNED AS A REGRESSION GUARD. `acceptsPreviousMajor(3, 2)` is false and reads ONLY
    // `MAJOR_ROW_SEMANTICS`, so a gate that required it unconditionally could never admit a preserved
    // major — no registry entry could rescue it, and the tempting repair was to declare a false
    // identity. The decision function must therefore IGNORE that evidence for this mode.
    expect(acceptsPreviousMajor(3, 2)).toBe(false);
    const preserved = { mode: "PRESERVED_INTERPRETER" as const, interpreter: "nh-interp-2x", maxSupportedVersion: "2.0.0" };
    expect(previousMajorSupportDecision(preserved, parseTriple("2.0.0")!, acceptsPreviousMajor(3, 2))).toBe(true);
    // And MAJOR_ROW_SEMANTICS stays out of it — no entry was added to make this pass.
    expect(MAJOR_ROW_SEMANTICS[3]).toBeUndefined();
  });

  it("the REAL registry's IDENTICAL entry is compatible with MAJOR_ROW_SEMANTICS — two facts, agreeing", () => {
    // THE TWO ARE NOT THE SAME FACT AND NEITHER DERIVES THE OTHER.
    //   MAJOR_ROW_SEMANTICS  — EVIDENCE that a previous major's row semantics are identical to ours.
    //   the registry         — the GOVERNED SUPPORT fact: which majors, how far into them, by what means.
    // A registry entry claiming IDENTICAL without the matching row-semantics evidence would be asserting
    // an identity nobody checked, so that pairing is asserted here. The ceiling is NOT taken from
    // `MAJOR_ROW_SEMANTICS`, which says nothing about how far support reaches.
    const implMajor = Number(PILOT_DATA_CONTRACT_VERSION.split(".")[0]);
    const identicalEntries = Object.entries(PREVIOUS_MAJOR_SUPPORT[implMajor] ?? {})
      .filter(([, entry]) => entry.mode === "IDENTICAL")
      .map(([previous]) => Number(previous));
    const rowSemanticsEvidence = MAJOR_ROW_SEMANTICS[implMajor] ?? [];
    for (const previous of identicalEntries) {
      expect(rowSemanticsEvidence, `registry claims IDENTICAL for major ${previous}`).toContain(previous);
    }
    // Today, concretely: one IDENTICAL entry, for major 1, and the evidence names major 1.
    expect(identicalEntries).toEqual([1]);
  });
});

describe("interpretation selection · structural", () => {
  it("has NO runtime importer outside its own test — the property that makes this slice inert", () => {
    const roots = ["src", "server"].map((r) => join(__dirname, "..", "..", r));
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) {
          if (entry !== "node_modules") walk(path);
          continue;
        }
        if (!/\.(ts|tsx|mts|cts)$/.test(entry)) continue;
        if (entry === "interpretationSelection.test.ts") continue; // this file, the only permitted importer
        const code = readFileSync(path, "utf8");
        if (/interpretationSelection/.test(code)) offenders.push(path);
      }
    };
    for (const root of roots) walk(root);
    expect(offenders, `unexpected importers: ${offenders.join(", ")}`).toEqual([]);
  });

  it("imports nothing but the contract's own version parser", () => {
    const code = readFileSync(join(__dirname, "interpretationSelection.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    const imports = [...code.matchAll(/from "([^"]+)"/g)].map((m) => m[1]!);
    expect(imports).toEqual(["./pilotDataContract"]);
  });
});

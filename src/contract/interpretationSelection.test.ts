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
import { MAJOR_ROW_SEMANTICS, PILOT_DATA_CONTRACT_VERSION } from "./pilotDataContract";

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
    const d = pick("3.0.0", "2.0.0", { 2: { mode: "IDENTICAL" } });
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
    const d = pick("1.1.0", "2.0.0", { 1: { mode: "IDENTICAL" } });
    expect(d.selected).toBe(true);
    if (!d.selected) return;
    expect(d.selection.kind).toBe("previous_major_identical");
    expect(d.selection.declaredMajor).toBe(1);
    // THE POINT: identical semantics ⇒ the implemented major's code is the correct reader.
    expect(d.selection.interpretationMajor).toBe(2);
    expect(d.selection.preservedInterpreter).toBeNull();
  });

  it("3 · PRESERVED_INTERPRETER selects the PREVIOUS major's own interpretation, and names it", () => {
    const d = pick("2.0.0", "3.0.0", { 2: { mode: "PRESERVED_INTERPRETER", interpreter: "nh-interp-2x" } });
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
    const other = pick("2.0.0", "3.0.0", { 1: { mode: "IDENTICAL" } });
    expect(other.selected).toBe(false);
    if (other.selected) return;
    expect(other.refusal.reason).toBe("previous_major_not_declared");
  });

  it("7 · refuses PRESERVED_INTERPRETER that names no interpreter", () => {
    for (const declaration of [
      { mode: "PRESERVED_INTERPRETER" as const },
      { mode: "PRESERVED_INTERPRETER" as const, interpreter: "" },
      { mode: "PRESERVED_INTERPRETER" as const, interpreter: "   " },
    ]) {
      const d = pick("2.0.0", "3.0.0", { 2: declaration });
      expect(d.selected).toBe(false);
      if (d.selected) continue;
      expect(d.refusal.reason).toBe("preserved_interpreter_not_named");
    }
  });

  it("8 · NO FALLBACK · preserved never degrades to identical or to current semantics", () => {
    // An unnamed preserved interpreter refuses rather than reading the data under current semantics.
    const unnamed = pick("2.0.0", "3.0.0", { 2: { mode: "PRESERVED_INTERPRETER" } });
    expect(unnamed.selected).toBe(false);
    if (!unnamed.selected) {
      expect(unnamed.refusal.reason).not.toBe("previous_major_not_declared");
      expect(unnamed.refusal.reason).toBe("preserved_interpreter_not_named");
    }
    // And a NAMED preserved interpreter never reports the implemented major as the reader.
    const named = pick("2.0.0", "3.0.0", { 2: { mode: "PRESERVED_INTERPRETER", interpreter: "nh-interp-2x" } });
    expect(named.selected).toBe(true);
    if (named.selected) {
      expect(named.selection.kind).not.toBe("previous_major_identical");
      expect(named.selection.kind).not.toBe("current_major");
      expect(named.selection.interpretationMajor).toBe(2);
    }
  });

  it("8b · NO FALLBACK · an unrecognised mode refuses rather than defaulting to anything", () => {
    const d = pick("2.0.0", "3.0.0", { 2: { mode: "SOMETHING_ELSE" } as never });
    expect(d.selected).toBe(false);
    if (d.selected) return;
    expect(d.refusal.reason).toBe("support_mode_unrecognised");
  });
});

describe("interpretation selection · properties", () => {
  it("10 · is deterministic — identical inputs yield a deeply equal decision every time", () => {
    const args = { declaredVersion: "2.0.0", implementedVersion: "3.0.0", declarations: { 2: { mode: "PRESERVED_INTERPRETER" as const, interpreter: "nh-interp-2x" } } };
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

  it("maps today's MAJOR_ROW_SEMANTICS onto IDENTICAL — evidence, not a migration", () => {
    // `MAJOR_ROW_SEMANTICS` is NOT read, replaced or modified by the selector. This test only shows that
    // the existing declaration is expressible as the IDENTICAL mode, so the model subsumes what is
    // already there. Any unification is deferred.
    const implemented = PILOT_DATA_CONTRACT_VERSION;
    const implMajor = Number(implemented.split(".")[0]);
    const asDeclarations: Record<number, { mode: "IDENTICAL" }> = {};
    for (const previous of MAJOR_ROW_SEMANTICS[implMajor] ?? []) asDeclarations[previous] = { mode: "IDENTICAL" };

    // Today: major 2 implemented, major 1 declared identical.
    expect(MAJOR_ROW_SEMANTICS[implMajor]).toEqual([1]);
    const d = pick("1.1.0", implemented, asDeclarations);
    expect(d.selected).toBe(true);
    if (!d.selected) return;
    expect(d.selection.kind).toBe("previous_major_identical");
    expect(d.selection.interpretationMajor).toBe(implMajor);
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

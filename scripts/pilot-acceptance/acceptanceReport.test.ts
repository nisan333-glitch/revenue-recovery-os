// Falsifiers for the pilot acceptance report.
//
// THE RULES WORTH BREAKING ARE ABOUT WHAT THE REPORT REFUSES TO SAY. That an expected refusal is a
// PASS, that an unexpected proof is a FAILURE, and that the two money figures are never combined. Each
// is tested by feeding the shape that would violate it and reading the verdict, not by inspecting prose.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  ACCEPTANCE_SCHEME,
  ACCEPTANCE_STAGES,
  buildAcceptanceReport,
  formatAcceptanceReport,
  type ScenarioRecord,
} from "./acceptanceReport";

const HERE = dirname(fileURLToPath(import.meta.url));

const provenScenario = (id: string, provenMinor = 60_000, exposureMinor = 60_000): ScenarioRecord => ({
  id,
  intent: "a clean billing correction, collected in full",
  expected: "PROVEN",
  stagesReached: [...ACCEPTANCE_STAGES],
  outcome: { kind: "PROVEN", provenMinor, exposureMinor },
});

const refusedScenario = (id: string, code = "ABSORBED_OBSERVATION_RECORDED"): ScenarioRecord => ({
  id,
  intent: "a second observation was folded into the same claim",
  expected: "REFUSED",
  stagesReached: ACCEPTANCE_STAGES.slice(0, 7),
  outcome: { kind: "REFUSED", atStage: "proven_decision", code, detail: "stored evidence shows absorption" },
});

describe("the acceptance verdict scores PRE-REGISTRATION, not money", () => {
  it("an EXPECTED refusal is a pass, and the verdict stays ACCEPTED", () => {
    const r = buildAcceptanceReport([provenScenario("S1"), refusedScenario("S2")]);
    expect(r.verdict).toBe("ACCEPTED");
    expect(r.surprises).toEqual([]);
    expect(r.totals.refused).toBe(1);
  });

  it("an UNEXPECTED proof is a FAILURE — proving more than predicted is not success", () => {
    // The scenario was pre-registered to be refused and was proven instead. A journey scored by money
    // would call that a win; this one calls it a surprise, because the refusal was the property.
    const surprising: ScenarioRecord = { ...refusedScenario("S3"), outcome: { kind: "PROVEN", provenMinor: 99_000, exposureMinor: 99_000 } };
    const r = buildAcceptanceReport([surprising]);
    expect(r.verdict).toBe("NOT_ACCEPTED");
    expect(r.surprises).toEqual(["S3: expected REFUSED, got PROVEN"]);
  });

  it("an UNEXPECTED refusal is also a failure, and names which direction it went", () => {
    const surprising: ScenarioRecord = { ...provenScenario("S4"), outcome: { kind: "REFUSED", atStage: "collection_evidence", code: "OUTCOME_EVIDENCE_INSUFFICIENT", detail: "d" } };
    const r = buildAcceptanceReport([surprising]);
    expect(r.verdict).toBe("NOT_ACCEPTED");
    expect(r.surprises).toEqual(["S4: expected PROVEN, got REFUSED"]);
  });

  it("NOT_RUN is a surprise whatever it was expected to do — an absence is never a pass", () => {
    const notRun: ScenarioRecord = { ...refusedScenario("S5"), outcome: { kind: "NOT_RUN", why: "the fixture could not be built" } };
    const r = buildAcceptanceReport([notRun]);
    expect(r.verdict).toBe("NOT_ACCEPTED");
    expect(r.surprises[0]).toContain("NOT RUN");
    expect(r.totals.notRun).toBe(1);
  });
});

describe("the two money figures are kept apart", () => {
  it("exposure and proven return are summed SEPARATELY, never into one total", () => {
    const r = buildAcceptanceReport([
      provenScenario("S1", 60_000, 60_000),
      provenScenario("S2", 100_000, 150_000),   // partial collection: proven < exposure
    ]);
    expect(r.totals.provenMinor).toBe(160_000);
    expect(r.totals.provenScenarioExposureMinor).toBe(210_000);
    // And there is no field anywhere that holds their sum.
    expect(Object.values(r.totals)).not.toContain(370_000);
  });

  it("a REFUSED scenario contributes to NEITHER figure", () => {
    const r = buildAcceptanceReport([provenScenario("S1", 60_000, 60_000), refusedScenario("S2")]);
    expect(r.totals.provenMinor).toBe(60_000);
    expect(r.totals.provenScenarioExposureMinor).toBe(60_000);
  });

  it("the rendering prints them on separate lines and labels which ledger each belongs to", () => {
    const out = formatAcceptanceReport(buildAcceptanceReport([provenScenario("S1", 60_000, 150_000)]));
    expect(out).toContain("Revenue Opportunity - NOT money");
    expect(out).toContain("Collected - Baseline");
    expect(out).toMatch(/identified exposure on the PROVEN scenarios\s+\$1500\.00/);
    expect(out).toMatch(/Revenue Returned, frozen in proofs\s+\$600\.00/);
    // The combined figure must appear nowhere.
    expect(out).not.toContain("$2100.00");
  });

  it("the renderer contains no expression that ADDS the two figures", () => {
    // Structural, because the arithmetic rule must hold for inputs no fixture supplies. Comments are
    // stripped first: the prose above the renderer discusses adding them in order to forbid it, and a
    // guard that matched the prose would fire on the explanation rather than on the code.
    const src = readFileSync(resolve(HERE, "acceptanceReport.ts"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(code).not.toMatch(/provenMinor\s*\+\s*proven(Scenario)?Exposure/);
    expect(code).not.toMatch(/provenScenarioExposureMinor\s*\+\s*/);
    // And the stripper is not vacuous: the forbidden idea really is discussed in the prose.
    expect(src).toMatch(/never added|never merge|never combined/i);
  });
});

describe("the report labels itself and its data honestly", () => {
  it("carries its own scheme id", () => {
    expect(buildAcceptanceReport([]).scheme).toBe(ACCEPTANCE_SCHEME);
  });

  it("an empty journey is ACCEPTED with zero of everything, and claims nothing", () => {
    // Deliberate: no scenario ran, so nothing was pre-registered and nothing surprised us. The totals
    // are zero because there is nothing to total, which the renderer says rather than implying a result.
    const r = buildAcceptanceReport([]);
    expect(r.verdict).toBe("ACCEPTED");
    expect(r.totals).toEqual({
      scenarios: 0, proven: 0, refused: 0, notRun: 0, provenMinor: 0, provenScenarioExposureMinor: 0,
    });
  });

  it("every rendering says the data is synthetic and that nothing became Revenue Returned", () => {
    const out = formatAcceptanceReport(buildAcceptanceReport([provenScenario("S1")]));
    expect(out).toContain("SYNTHETIC DATA ONLY");
    expect(out).toMatch(/no observed amount became Revenue Returned/);
  });

  it("the eight stages are declared in loop order, and a refusal names one of them", () => {
    expect(ACCEPTANCE_STAGES).toHaveLength(8);
    expect(ACCEPTANCE_STAGES[0]).toBe("opportunity");
    expect(ACCEPTANCE_STAGES[7]).toBe("audit_evidence");
    const r = refusedScenario("S2");
    expect(ACCEPTANCE_STAGES).toContain(r.outcome.kind === "REFUSED" ? r.outcome.atStage : "");
  });

  it("stages reached is a PREFIX of the loop — a scenario cannot skip a stage", () => {
    const r = refusedScenario("S2");
    expect(r.stagesReached).toEqual(ACCEPTANCE_STAGES.slice(0, r.stagesReached.length));
  });

  it("the same records always render byte-identically", () => {
    const rec = [provenScenario("S1"), refusedScenario("S2")];
    expect(formatAcceptanceReport(buildAcceptanceReport(rec)))
      .toBe(formatAcceptanceReport(buildAcceptanceReport(rec)));
  });
});

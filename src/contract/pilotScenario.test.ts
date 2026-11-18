// A CRITERION THAT NO TEST CAN FAIL IS A HOPE, SO EVERY CITATION IS CHECKED AGAINST THE DISK.
//
// The repository has the pattern already: the method registry's test asserts each cited test file
// exists, because a reviewed declaration citing a file nobody wrote is worse than no declaration. The
// same applies here, with one addition — a BLOCKED criterion must name an owner, or it never moves.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import {
  PILOT_CRITERIA,
  PILOT_OUT_OF_SCOPE,
  PILOT_SCENARIO_VERSION,
  PILOT_VERDICT_RULE,
  UNREACHABLE_BY_CONSTRUCTION,
  blockedCriteria,
  decidableCriteria,
} from "./pilotScenario";

const repoRoot = resolve(__dirname, "../..");

describe("every bound criterion cites evidence that exists", () => {
  it("each cited path is a real file in this repository", () => {
    for (const c of decidableCriteria()) {
      for (const p of c.evidence) {
        expect(existsSync(resolve(repoRoot, p)), `${c.id} cites ${p}, which does not exist`).toBe(true);
      }
    }
  });

  it("each bound criterion cites at least one file that actually contains tests", () => {
    for (const c of decidableCriteria()) {
      const testFiles = c.evidence.filter((p) => p.endsWith(".test.ts"));
      expect(testFiles.length, `${c.id} is BOUND_TO_TEST but cites no test file`).toBeGreaterThan(0);
      for (const p of testFiles) {
        const src = readFileSync(resolve(repoRoot, p), "utf8");
        expect(/\bit\(/.test(src), `${p} declares no test`).toBe(true);
      }
    }
  });

  it("every refusal code a criterion rests on is exercised in a file it cites", () => {
    // AN EXISTENCE CHECK IS NOT A RELEVANCE CHECK, and this assertion is here because the first form
    // of this scenario failed exactly that way: A2 and A3 cited the gate's test file, which exists,
    // while the value-date and finality refusals are exercised one layer down in the pure core's own
    // test. Both citations passed and both were wrong.
    for (const c of decidableCriteria()) {
      if (c.decidedBy.length === 0) continue;
      const sources = c.evidence.map((p) => readFileSync(resolve(repoRoot, p), "utf8"));
      for (const code of c.decidedBy) {
        expect(
          sources.some((src) => src.includes(code)),
          `${c.id} rests on ${code}, which appears in none of the files it cites`,
        ).toBe(true);
      }
    }
  });

  it("an unreachable refusal is recorded as such, not quietly cited or quietly dropped", () => {
    // The third state: NOT a code a criterion rests on, and NOT an omission. This list is the
    // difference, and the check below proves each entry really is untested — so if someone later
    // makes the branch reachable AND tests it, this assertion fails and the record gets updated.
    expect(UNREACHABLE_BY_CONSTRUCTION.length).toBeGreaterThan(0);
    const cited = new Set(PILOT_CRITERIA.flatMap((c) => [...c.decidedBy]));
    for (const u of UNREACHABLE_BY_CONSTRUCTION) {
      expect(cited.has(u.code), `${u.code} is both cited and declared unreachable`).toBe(false);
      expect(u.why.trim().length, `${u.code} is declared unreachable with no reason`).toBeGreaterThan(80);
      const hits = execSync(
        `grep -rl ${JSON.stringify(u.code)} --include=*.test.ts . | grep -v node_modules || true`,
        { cwd: repoRoot, encoding: "utf8" },
      ).trim();
      expect(hits, `${u.code} IS exercised by a test — move it out of UNREACHABLE_BY_CONSTRUCTION`).toBe(
        "",
      );
    }
  });

  it("a criterion resting on no named code is one whose subject is not a refusal", () => {
    // Stated so an empty `decidedBy` is a decision rather than an omission: B2 is about a ladder, D3
    // about transactional release, F1 about what is NOT stored, F2 about placement of arrivals.
    const noCodes = decidableCriteria().filter((c) => c.decidedBy.length === 0).map((c) => c.id);
    expect(noCodes).toEqual(["A1", "B2", "D3", "F1", "F2"]);
  });

  it("a non-test citation is only ever supporting material, never the whole basis", () => {
    // B2 cites `sourceFactAuthority.ts` for the ladder itself alongside the test that exercises it.
    // Naming a source file as evidence is fine; naming ONLY a source file would make the criterion
    // undecidable while looking decided.
    for (const c of decidableCriteria()) {
      const nonTests = c.evidence.filter((p) => !p.endsWith(".test.ts"));
      if (nonTests.length > 0) {
        expect(
          c.evidence.some((p) => p.endsWith(".test.ts")),
          `${c.id} cites only non-test files`,
        ).toBe(true);
      }
    }
  });
});

describe("every blocked criterion names a blocker and an owner", () => {
  it("no blocker is left unattributed", () => {
    for (const c of blockedCriteria()) {
      expect(c.blocker.trim().length, `${c.id} is BLOCKED with no stated blocker`).toBeGreaterThan(60);
      expect(c.blockerOwnedBy.trim().length, `${c.id}'s blocker has no owner`).toBeGreaterThan(8);
      expect(c.evidence, `${c.id} is BLOCKED but cites evidence`).toEqual([]);
    }
  });

  it("the two blockers are the ones outside this repository, and they are named as such", () => {
    expect(blockedCriteria().map((c) => c.id)).toEqual(["C2", "F3"]);
    const owners = blockedCriteria().map((c) => c.blockerOwnedBy).join(" | ");
    expect(owners).toMatch(/customer/i);
    expect(owners).toMatch(/owner/i);
  });

  it("a bound or manual criterion carries no blocker, so the states stay distinguishable", () => {
    for (const c of PILOT_CRITERIA.filter((x) => x.status !== "BLOCKED")) {
      expect(c.blocker, `${c.id} is ${c.status} yet names a blocker`).toBe("");
      expect(c.blockerOwnedBy).toBe("");
    }
  });
});

describe("the verdict rule cannot be read as acceptance", () => {
  it("a fully passing run is BEHAVIOUR_CONFIRMED and PROVISIONAL, never VERIFIED or ACCEPTED", () => {
    expect(PILOT_VERDICT_RULE.allBoundCriteriaPass).toBe("BEHAVIOUR_CONFIRMED · PROVISIONAL");
    expect(PILOT_VERDICT_RULE.allBoundCriteriaPass).not.toMatch(/VERIFIED|ACCEPTED/);
    expect(PILOT_VERDICT_RULE.blockedCriteriaAreNotWaivable).toBe(true);
  });

  it("the reason the stronger word is unavailable is stated, not merely the refusal to use it", () => {
    expect(PILOT_VERDICT_RULE.whyNotVerified).toMatch(/payer/i);
    expect(PILOT_VERDICT_RULE.whyNotVerified).toMatch(/authority/i);
    expect(PILOT_VERDICT_RULE.whyNotVerified).toMatch(/no run may report VERIFIED or ACCEPTED/);
  });

  it("there is at least one blocked criterion, so the rule is not vacuous", () => {
    // A SCENARIO WITH NOTHING BLOCKED WOULD MAKE THE VERDICT RULE DECORATIVE. The rule's whole
    // content is that passing cannot clear what passing does not touch.
    expect(blockedCriteria().length).toBeGreaterThan(0);
  });
});

describe("the scenario is narrow on purpose, and says what it excludes", () => {
  it("every exclusion carries a reason", () => {
    expect(PILOT_OUT_OF_SCOPE.length).toBeGreaterThan(3);
    for (const x of PILOT_OUT_OF_SCOPE) {
      expect(x.item.trim().length).toBeGreaterThan(10);
      expect(x.why.trim().length, `${x.item} is excluded with no reason`).toBeGreaterThan(40);
    }
  });

  it("production migration and the production key are excluded explicitly", () => {
    const text = PILOT_OUT_OF_SCOPE.map((x) => `${x.item} ${x.why}`).join(" ");
    expect(text).toMatch(/migration/i);
    expect(text).toMatch(/disposable databases only/);
  });
});

describe("the scenario is well formed", () => {
  it("criterion ids are unique", () => {
    const ids = PILOT_CRITERIA.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every criterion states something that could fail", () => {
    for (const c of PILOT_CRITERIA) {
      expect(c.criterion.trim().length, `${c.id} states nothing`).toBeGreaterThan(60);
    }
  });

  it("the version is pinned", () => {
    expect(PILOT_SCENARIO_VERSION).toBe("fin-pilot-2026.1");
  });
});

describe("the scenario promises no money", () => {
  const text = JSON.stringify({ PILOT_CRITERIA, PILOT_OUT_OF_SCOPE, PILOT_VERDICT_RULE });

  it("states no amount and no percentage", () => {
    expect(text).not.toMatch(/[$€£]\s?\d/);
    expect(text).not.toMatch(/\d+(?:\.\d+)?\s?%/);
  });

  it("names the thing a green run does NOT establish", () => {
    const f4 = PILOT_CRITERIA.find((c) => c.id === "F4");
    expect(f4).toBeDefined();
    expect(f4!.criterion).toMatch(/does NOT establish/);
    expect(f4!.criterion).toMatch(/synthetic/);
    expect(f4!.status).toBe("MANUAL_REVIEW");
  });
});

// THE FREEZE GATE for the pre-registered scenario expectations.
//
// It recomputes the digest of the expectation module and compares it to the TRACKED lock. The lock is
// written by hand and by no generator, which is the property that matters: this repository has already
// recorded a freeze record that a generator rewrote on every run, so it always agreed with the bytes on
// disk — a gate that updates itself cannot detect the only thing it exists to detect.
//
// It also asserts the lock and the expectations are TRACKED IN GIT, because an uncommitted freeze is not
// a freeze: a lock naming the hash of a file nobody kept is a receipt for a lost artefact, and this
// project has already had to reconstruct one such artefact from recorded patches.
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PROVEN_GRAIN_AUTHORIZATION, SCENARIOS } from "./reconciliation.scenarios.expectations";

const HERE = resolve(__dirname);
const LOCK = JSON.parse(readFileSync(resolve(HERE, "SCENARIOS.FREEZE.lock.json"), "utf8")) as {
  readonly covered: readonly { readonly path: string; readonly bytes: number; readonly sha256: string }[];
  readonly semantic: {
    readonly requiredOutcomes: string;
    readonly scenarios: string;
    readonly provenGrainAuthorization: string;
  };
  readonly revisions: readonly {
    readonly revision: number; readonly sha256: string; readonly semanticsMoved: boolean;
    readonly reason: string; readonly proof: string;
  }[];
};

const semantic = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex");

describe("scenario expectation freeze", () => {
  it("every covered file matches the lock byte for byte", () => {
    expect(LOCK.covered.length).toBeGreaterThan(0);
    for (const entry of LOCK.covered) {
      const bytes = readFileSync(resolve(HERE, "../../..", entry.path));
      expect(bytes.byteLength, `${entry.path} byte count`).toBe(entry.bytes);
      expect(createHash("sha256").update(bytes).digest("hex"), `${entry.path} digest`).toBe(entry.sha256);
    }
  });

  // TWO DIGESTS, AND THE SECOND IS THE ONE THAT MATTERS FOR A REWORD. The file digest above catches any
  // byte change, including a comment. This one catches a change of MEANING, and nothing else — so a
  // revision that leaves every expectation intact is provable rather than asserted, and a revision that
  // quietly moves one cannot hide behind "it was only a comment". Separate, for the same reason the
  // unavailable states stay distinguishable: one hash cannot tell the two events apart.
  it("the scenario semantics match the lock, independently of the bytes", () => {
    expect(semantic(SCENARIOS)).toBe(LOCK.semantic.scenarios);
    expect(semantic(PROVEN_GRAIN_AUTHORIZATION)).toBe(LOCK.semantic.provenGrainAuthorization);
  });

  // THE THIRD DIGEST, AND THE ONLY ONE A PRODUCT FIX MUST NEVER MOVE. The file digest moves on a
  // comment; the scenarios digest moves when the description of current behaviour follows the code; this
  // one moves ONLY if a REQUIREMENT changed. That is the separation that makes "we fixed the product"
  // distinguishable from "we adjusted the ruler", which no single hash can tell apart.
  it("the REQUIREMENTS match the lock — the one digest a product fix may never move", () => {
    expect(semantic(SCENARIOS.map((s) => [s.id, s.requiredOutcome]))).toBe(LOCK.semantic.requiredOutcomes);
  });

  it("every revision that moved the meaning says what it moved, and a requirement-moving one would stand out", () => {
    for (const r of LOCK.revisions) {
      if (r.semanticsMoved) {
        // A revision claiming the meaning moved must name the SCOPE of the move, so a reader can see
        // whether a requirement was among it without re-deriving anything.
        expect((r as { semanticsMovedScope?: string }).semanticsMovedScope?.trim().length ?? 0,
          `revision ${r.revision} scope`).toBeGreaterThan(0);
        expect(r.proof, `revision ${r.revision} proof`).toMatch(/REQUIRED_OUTCOMES/);
      }
    }
  });

  // A SUPERSEDED REVISION IS PRESERVED, NEVER DELETED. Each entry keeps the digest it was judged under,
  // why it moved, and whether the meaning moved with it — so no figure can be quoted without the ruler
  // it was measured against still being on the record.
  it("every superseded revision keeps its digest, its reason and its proof", () => {
    for (const r of LOCK.revisions) {
      expect(/^[a-f0-9]{64}$/.test(r.sha256), `revision ${r.revision} digest`).toBe(true);
      expect(r.reason.trim().length, `revision ${r.revision} reason`).toBeGreaterThan(0);
      expect(r.proof.trim().length, `revision ${r.revision} proof`).toBeGreaterThan(0);
      // A revision claiming the meaning did not move must not reuse the CURRENT file digest, which
      // would mean nothing was superseded at all.
      if (!r.semanticsMoved) expect(r.sha256).not.toBe(LOCK.covered[0]!.sha256);
    }
  });

  it("the lock and the expectations are tracked in git — an uncommitted freeze is not a freeze", () => {
    const tracked = execFileSync("git", ["ls-files", "--", "server/agents/fixtures/"], {
      cwd: resolve(HERE, "../../.."), encoding: "utf8",
    }).split("\n");
    expect(tracked).toContain("server/agents/fixtures/SCENARIOS.FREEZE.lock.json");
    for (const entry of LOCK.covered) expect(tracked).toContain(entry.path);
  });
});

describe("the three statements stay separate", () => {
  // The structural half of "documented behaviour is not required behaviour". A scenario whose required
  // outcome merely restates its current behaviour has collapsed the distinction this file exists for,
  // and the collapse is invisible by reading — so it is asserted.
  it("no required outcome is a copy of the current behaviour", () => {
    for (const s of SCENARIOS) {
      expect(s.requiredOutcome.statement, s.id).not.toBe(s.currentBehaviour.statement);
    }
  });

  it("a required outcome with no approved source is marked NOT_ESTABLISHED and names what was searched", () => {
    for (const s of SCENARIOS) {
      const b = s.requiredOutcome.basis;
      if (b.kind === "NOT_ESTABLISHED") {
        expect(b.searched.length, s.id).toBeGreaterThan(0);
        expect(b.detail.trim().length, s.id).toBeGreaterThan(0);
      } else {
        expect(b.source.trim().length, s.id).toBeGreaterThan(0);
      }
    }
  });

  it("every scenario anchors its current behaviour to file:line evidence or says it is measured in the run", () => {
    for (const s of SCENARIOS) {
      const measured = s.currentBehaviour.statement.includes("MEASURED IN THE RUN");
      expect(s.currentBehaviour.evidence.length, s.id).toBeGreaterThan(0);
      if (!measured) {
        // A behavioural claim must cite a position in the code, not a remembered fact.
        expect(s.currentBehaviour.evidence.some((e) => /:\d+/.test(e)), s.id).toBe(true);
      }
    }
  });

  it("the duplication family is split, because one scenario cannot carry opposite required outcomes", () => {
    const dup = SCENARIOS.filter((s) => s.id.startsWith("S-DUP-"));
    expect(dup.map((s) => s.id)).toEqual(["S-DUP-1", "S-DUP-2", "S-DUP-3", "S-DUP-4"]);
    // THE LOAD-BEARING CONTRAST MOVED TO THE REQUIREMENTS, and that is the right place for it.
    //
    // Its first form contrasted the GAPS: S-DUP-1 had none and S-DUP-3 carried "REQUIRED OUTCOME NOT
    // MET". That held only while the product was defective — once the obligation-grained key closed
    // S-DUP-3 both gaps were null and the guard failed, having pinned the DEFECT rather than the
    // distinction it existed to protect. The distinction is between the two REQUIREMENTS, which differ
    // whether or not either is currently met, so it is now asserted there and survives the fix.
    const req = (id: string) => dup.find((s) => s.id === id)!.requiredOutcome.statement;
    expect(req("S-DUP-1")).toContain("No additional case");
    expect(req("S-DUP-3")).toContain("must not be silently lost");
    expect(req("S-DUP-1")).not.toBe(req("S-DUP-3"));
    // And a closed gap is null rather than a sentence saying it is closed, so "no gap" has exactly one
    // representation and a reader cannot mistake prose for a state.
    expect(dup.find((s) => s.id === "S-DUP-1")!.knownGap).toBeNull();
    expect(dup.find((s) => s.id === "S-DUP-3")!.knownGap).toBeNull();
  });

  it("no expectation class is ZERO where the real answer is blocked, unsupported or unknown", () => {
    // ZERO asserts a population was examined and found clean. It is reserved, and today unused.
    for (const s of SCENARIOS) {
      expect(["DETECTED", "BLOCKED", "UNSUPPORTED", "UNKNOWN", "ZERO"]).toContain(s.expectedClass);
    }
    expect(SCENARIOS.some((s) => s.expectedClass === "UNKNOWN")).toBe(true);
    expect(SCENARIOS.every((s) => s.expectedClass !== "ZERO")).toBe(true);
  });
});

describe("the proven-grain question is open, not answered by the code", () => {
  it("records that a route exists and the business authorization is not proven", () => {
    expect(PROVEN_GRAIN_AUTHORIZATION.routeExists).toBe(true);
    expect(PROVEN_GRAIN_AUTHORIZATION.businessAuthorizationProven).toBe(false);
    expect(PROVEN_GRAIN_AUTHORIZATION.doubleAttributionPrevented).toBe("WITHIN_CASE_ONLY");
  });

  it("PROOF_MODEL.md really is silent on grain — the absence is checked, not asserted", () => {
    const doc = readFileSync(resolve(HERE, "../../../docs/PROOF_MODEL.md"), "utf8");
    expect(/\bgrain\b/i.test(doc)).toBe(false);
    expect(/obligation-level/i.test(doc)).toBe(false);
  });
});

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
};

describe("scenario expectation freeze", () => {
  it("every covered file matches the lock byte for byte", () => {
    expect(LOCK.covered.length).toBeGreaterThan(0);
    for (const entry of LOCK.covered) {
      const bytes = readFileSync(resolve(HERE, "../../..", entry.path));
      expect(bytes.byteLength, `${entry.path} byte count`).toBe(entry.bytes);
      expect(createHash("sha256").update(bytes).digest("hex"), `${entry.path} digest`).toBe(entry.sha256);
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
    // The load-bearing contrast: suppressing a repeat is correct and has no gap; absorbing a second
    // obligation across runs loses money and must carry one.
    expect(dup.find((s) => s.id === "S-DUP-1")!.knownGap).toBeNull();
    expect(dup.find((s) => s.id === "S-DUP-3")!.knownGap).toContain("NOT MET");
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

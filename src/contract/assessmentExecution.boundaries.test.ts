// EP-16 · The boundaries the orchestration's pure core must not cross, asserted structurally.
//
// These are not style checks. Each one locks a property that a single careless import would undo,
// and that no behavioural test would notice until the day it mattered:
//
//   • the pure core stays pure — no server, no Prisma, no Fastify, no filesystem. If it could reach
//     a database it would stop being reasonable-about-without-one, and the lifecycle rules would be
//     testable only by standing up Postgres.
//   • the two ledgers stay unblended — an execution computes Revenue OPPORTUNITY, and the proof
//     kernel is the only thing that may compute Revenue Returned. One import is all it would take
//     for a forecast to be summed into a proven number, and the constitution says that is the day
//     the moat is gone.
//   • the agent cannot create a case — the handler's only return path is an empty signal array.
//
// Doc comments are stripped before scanning: every one of these modules deliberately DISCUSSES the
// boundaries it must not cross, and scanning prose would force those explanations to be deleted to
// satisfy a regex, which is exactly backwards.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const read = (relative: string): string =>
  stripComments(readFileSync(join(__dirname, relative), "utf8"));

/** Every `from "..."` specifier in executable code. */
function imports(code: string): readonly string[] {
  return [...code.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]!);
}

const PURE_MODULES = ["assessmentExecution.ts", "executionCodes.ts"] as const;

describe("EP-16 · the orchestration's pure core stays pure", () => {
  it.each(PURE_MODULES)("%s imports nothing from the server", (file) => {
    for (const specifier of imports(read(file))) {
      expect(specifier, `${file} imports ${specifier}`).not.toMatch(/server|prisma|@prisma/i);
      // No Node builtins either: this module is bundled into the browser, where they do not exist.
      expect(specifier, `${file} imports ${specifier}`).not.toMatch(/^node:/);
      expect(specifier).not.toMatch(/fastify|fs|path|crypto$/i);
    }
  });

  it("assessmentExecution.ts imports only the assessment core and the contract's own codes", () => {
    // An explicit allow-list, not a pattern. A NEW dependency has to be added here deliberately,
    // which is the moment to ask whether it belongs.
    expect([...imports(read("assessmentExecution.ts"))].sort()).toEqual([
      "../assessment/adapters/saasActivation",
      "../assessment/assess",
      "../assessment/fingerprint",
      "../assessment/policy",
      "../assessment/types",
      "./rejectionCodes",
    ]);
  });

  it("executionCodes.ts imports nothing at all — a code catalogue needs no dependencies", () => {
    expect(imports(read("executionCodes.ts"))).toEqual([]);
  });
});

describe("EP-16 · the two ledgers are never blended", () => {
  it.each(PURE_MODULES)("%s cannot reach the proof kernel or the proven ledger", (file) => {
    for (const specifier of imports(read(file))) {
      expect(specifier, `${file} imports ${specifier}`).not.toMatch(
        /domain\/(proof|provenLedger|outcomes|invariants)/,
      );
    }
  });

  it("no executable line names a counted concept as a value it produces", () => {
    const code = read("assessmentExecution.ts");
    // `constitutesProof` / `constitutesRevenue` are the DENIALS of these concepts, so they are
    // removed before the scan rather than excused by it.
    const withoutDenials = code
      .replace(/constitutesProof/g, "")
      .replace(/constitutesRevenue/g, "")
      .replace(/createsRecoveryCase/g, "");
    for (const forbidden of [
      /revenueReturned/i,
      /auditableRevenue/i,
      /provenLedger/i,
      /collectedMinor/i,
      /approveProof/i,
    ]) {
      expect(withoutDenials, `matched ${forbidden}`).not.toMatch(forbidden);
    }
  });
});

describe("EP-16 · the agent cannot create a recovery case", () => {
  const agent = stripComments(
    readFileSync(join(__dirname, "../../server/agents/pilotAssessmentAgent.ts"), "utf8"),
  );

  it("returns only the empty-signal constant — there is no branch that emits a CandidateSignal", () => {
    // Every `return` inside the handler must be the named empty constant. A handler that could
    // return a populated array would have a live path into candidate publication, and from there
    // into case creation.
    const returns = [...agent.matchAll(/return\s+([A-Za-z_][\w.]*)/g)].map((m) => m[1]!);
    expect(returns).toContain("NO_CANDIDATE_SIGNALS");
    expect(agent).toMatch(/const NO_CANDIDATE_SIGNALS[^=]*=\s*Object\.freeze\(\[\]\)/);
    // No literal array of signals is ever constructed.
    expect(agent).not.toMatch(/return\s*\[\s*\{/);
    expect(agent).not.toMatch(/signalId\s*:/);
  });

  it("imports nothing that could author a case, a baseline, evidence or a proof", () => {
    for (const specifier of [...agent.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]!)) {
      expect(specifier, `agent imports ${specifier}`).not.toMatch(
        /proofService|proofStore|recoveryCase|caseAdmission|baselineStore|evidenceStore|authorityStore|candidateSignalWriter/i,
      );
    }
    // It DOES import the halt gate — reading halt state is the one thing it must be able to do.
    expect(agent).toMatch(/from "\.\.\/services\/caseGuard"/);
    expect(agent).toMatch(/isCaseHalted/);
  });

  it("never widens the set of mutations a Case Halt blocks", () => {
    // Adding the assessment to HALTED_MUTATIONS would change what Halt means for the proof chain.
    // The agent reads halt state; it does not redefine it.
    expect(agent).not.toMatch(/HALTED_MUTATIONS/);
    expect(agent).not.toMatch(/withGovernedCaseMutation/);
  });
});

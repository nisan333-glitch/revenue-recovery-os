// Falsifiers for the CI-generated status record. A generator that can report success when it should not is
// the failure that matters, so most cases here try to coax a green out of a run that was not green.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CI_STATUS_SCHEMA, buildCiStatus, ciStatusEvidence, renderSummary, type CiStatusInput } from "./ciStatus.ts";
import { SCHEMA, validateStatusRecord } from "./statusRecord.ts";

const SHA = "9c18c82b4266c89f7f1151c1ee909b7acb75d5a8";
const NOW = new Date("2026-10-24T20:00:00Z");

const allGreen = {
  verify: { result: "success", outputs: {} },
  "frozen-verifiers": { result: "success" },
  "postgres-integration": { result: "success" },
};

function input(over: Partial<CiStatusInput> = {}): CiStatusInput {
  return {
    repo: "example-org/example-repo",
    headSha: SHA,
    runId: "40130003019",
    runAttempt: "1",
    ref: "claude/pilot-reconciler-demo-v1",
    event: "push",
    needs: allGreen,
    ...over,
  };
}

describe("buildCiStatus · what a green means", () => {
  it("is success only when every job succeeded", () => {
    const s = buildCiStatus(input());
    expect(s.schema).toBe(CI_STATUS_SCHEMA);
    expect(s.generated_by).toBe("github-actions");
    expect(s.overall).toBe("success");
    expect(s.run_url).toBe("https://github.com/example-org/example-repo/actions/runs/40130003019");
    expect(s.jobs.map((j) => j.id)).toEqual(["frozen-verifiers", "postgres-integration", "verify"]);
  });

  it("one failure makes the whole run a failure, whatever else succeeded", () => {
    const s = buildCiStatus(input({ needs: { ...allGreen, verify: { result: "failure" } } }));
    expect(s.overall).toBe("failure");
  });

  it("a skipped or cancelled job is INCOMPLETE, never success", () => {
    for (const result of ["skipped", "cancelled"]) {
      const s = buildCiStatus(input({ needs: { ...allGreen, verify: { result } } }));
      expect(s.overall, result).toBe("incomplete");
    }
  });

  it("a failure outranks a skip", () => {
    const s = buildCiStatus(input({ needs: { a: { result: "skipped" }, b: { result: "failure" } } }));
    expect(s.overall).toBe("failure");
  });

  it("an EMPTY job list is refused, so 'all of nothing succeeded' can never read as success", () => {
    expect(() => buildCiStatus(input({ needs: {} }))).toThrow(/nothing to report/);
  });

  it("an unrecognised or missing result is refused rather than treated as success", () => {
    expect(() => buildCiStatus(input({ needs: { verify: { result: "passed" } } }))).toThrow(/no recognised result/);
    expect(() => buildCiStatus(input({ needs: { verify: {} } }))).toThrow(/no recognised result/);
    expect(() => buildCiStatus(input({ needs: { verify: null } }))).toThrow(/no recognised result/);
    expect(() => buildCiStatus(input({ needs: { verify: "success" } }))).toThrow(/no recognised result/);
  });

  it("the job order does not change the record (it is sorted)", () => {
    const a = buildCiStatus(input({ needs: { b: { result: "success" }, a: { result: "success" } } }));
    const b = buildCiStatus(input({ needs: { a: { result: "success" }, b: { result: "success" } } }));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("extra fields GitHub may add to a job entry are ignored, not trusted", () => {
    const s = buildCiStatus(input({ needs: { verify: { result: "failure", outputs: { overall: "success" } } } }));
    expect(s.overall).toBe("failure");
  });
});

describe("buildCiStatus · malformed inputs are refused", () => {
  const cases: Array<[string, Partial<CiStatusInput>, RegExp]> = [
    ["short sha", { headSha: "9c18c82" }, /40-character/],
    ["uppercase sha", { headSha: SHA.toUpperCase() }, /40-character/],
    ["empty sha", { headSha: "" }, /40-character/],
    ["bad repo", { repo: "not a repo" }, /owner\/name/],
    ["repo with a path escape", { repo: "a/b/../c" }, /owner\/name/],
    ["non-numeric run id", { runId: "12;rm" }, /run id/],
    ["empty run id", { runId: "" }, /run id/],
    ["non-numeric attempt", { runAttempt: "x" }, /attempt/],
    ["ref with a space", { ref: "a b" }, /ref/],
    ["ref with a newline", { ref: "a\nb" }, /ref/],
    ["bad event", { event: "Push!" }, /event/],
    ["needs is an array", { needs: [] }, /not an object/],
    ["needs is null", { needs: null }, /not an object/],
    ["needs is a string", { needs: "x" }, /not an object/],
    ["malformed job id", { needs: { "Bad Id": { result: "success" } } }, /job id/],
  ];
  for (const [name, over, re] of cases) {
    it(name, () => expect(() => buildCiStatus(input(over))).toThrow(re));
  }
});

describe("bridge into an nh-status record", () => {
  const record = (evidence: unknown, state: string) => ({
    schema: SCHEMA,
    id: "issue-12-p3",
    subject: { kind: "issue", number: 12 },
    author: { name: "claude-code", agent: "claude-code" },
    owner: "claude-code",
    branch: "claude/pilot-reconciler-demo-v1",
    commit: SHA,
    state,
    summary: "CI-generated evidence bridged into a status record.",
    evidence: [evidence],
    blockers: [],
    approval_gates: [],
    timestamps: { created_at: "2026-10-24T19:30:00Z", updated_at: "2026-10-24T19:45:00Z" },
  });

  it("a green run yields evidence the validator accepts for `tested`", () => {
    const ev = ciStatusEvidence(buildCiStatus(input()));
    expect(ev.kind).toBe("ci_run");
    expect(ev.conclusion).toBe("success");
    const r = validateStatusRecord(record(ev, "tested"), NOW);
    expect(r.errors, JSON.stringify(r.errors)).toEqual([]);
  });

  it("a failed run cannot carry a record to `tested`", () => {
    const ev = ciStatusEvidence(buildCiStatus(input({ needs: { verify: { result: "failure" } } })));
    expect(ev.conclusion).toBe("failure");
    expect(validateStatusRecord(record(ev, "tested"), NOW).errors.length).toBeGreaterThan(0);
  });

  it("an incomplete run cannot carry a record to `tested` either", () => {
    const ev = ciStatusEvidence(buildCiStatus(input({ needs: { verify: { result: "skipped" } } })));
    expect(ev.conclusion).toBe("cancelled");
    expect(validateStatusRecord(record(ev, "tested"), NOW).errors.length).toBeGreaterThan(0);
  });

  it("evidence for a different commit is refused by the existing SHA rule", () => {
    const other = "b15b3f7000000000000000000000000000000000";
    const ev = ciStatusEvidence(buildCiStatus(input({ headSha: other })));
    expect(validateStatusRecord(record(ev, "tested"), NOW).errors.length).toBeGreaterThan(0);
  });
});

describe("renderSummary", () => {
  it("states the limits and embeds exactly one parseable record", () => {
    const status = buildCiStatus(input());
    const md = renderSummary(status);
    expect(md).toContain("not what it tested");
    expect(md).toContain("only as independent as the workflow file");
    const m = [...md.matchAll(/```nh-ci-status\n([\s\S]*?)\n```/g)];
    expect(m).toHaveLength(1);
    expect(JSON.parse(m[0]![1]!)).toEqual(status);
  });

  it("carries no secret-looking or transcript content (it is built from ids and results only)", () => {
    const md = renderSummary(buildCiStatus(input()));
    expect(md).not.toMatch(/token|password|secret|BEGIN [A-Z ]*KEY/i);
  });
});

// The workflow is configuration, and configuration is silently outgrown. These pin the properties that make the
// emitted record worth reading, reading the YAML text with comments removed so prose cannot satisfy them.
describe("workflow wiring · the job that emits the record", () => {
  const yml = readFileSync(".github/workflows/ci.yml", "utf8")
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");
  const job = (() => {
    const m = yml.match(/\n  ci-status:\n([\s\S]*?)(?=\n  [a-z0-9-]+:\n|$)/);
    return m ? m[1]! : "";
  })();

  it("exists", () => expect(job.length).toBeGreaterThan(0));

  it("needs every other job, so it can only describe a finished run", () => {
    const all = [...yml.matchAll(/\n  ([a-z0-9-]+):\n    name:/g)].map((m) => m[1]!).filter((n) => n !== "ci-status");
    expect(all.length).toBeGreaterThanOrEqual(5);
    const needs = job.match(/needs:\s*\[([^\]]*)\]/);
    expect(needs, "needs: [..] list").not.toBeNull();
    const listed = needs![1]!.split(",").map((s) => s.trim()).filter(Boolean).sort();
    expect(listed).toEqual([...all].sort());
  });

  it("runs even when a needed job failed (otherwise a red run has no record)", () => {
    expect(job).toMatch(/if:\s*\$\{\{\s*always\(\)\s*\}\}/);
  });

  it("is read-only and posts nothing: no permissions beyond contents: read, no write scope, no token use", () => {
    expect(job).not.toMatch(/write/);
    expect(job).not.toMatch(/secrets\./);
    expect(job).not.toMatch(/GITHUB_TOKEN|github\.token/);
    expect(job).not.toMatch(/gh (api|pr|issue)|curl|wget/);
  });

  it("passes only run metadata and the needs results to the emitter", () => {
    for (const k of ["NH_NEEDS_JSON", "NH_HEAD_SHA", "NH_RUN_ID", "NH_RUN_ATTEMPT", "NH_REPO", "NH_REF", "NH_EVENT"]) {
      expect(job, k).toContain(k);
    }
    expect(job).toMatch(/toJSON\(needs\)/);
    expect(job).toContain("npm run coordination:ci-status");
  });

  it("takes the head sha of the PR on pull_request events, not the synthetic merge commit", () => {
    expect(job).toMatch(/github\.event\.pull_request\.head\.sha\s*\|\|\s*github\.sha/);
  });

  it("pins every action to a full commit SHA and swallows no exit", () => {
    for (const m of job.matchAll(/uses:\s*(\S+)/g)) expect(m[1], m[1]).toMatch(/@[0-9a-f]{40}$/);
    expect(job).not.toMatch(/continue-on-error/);
    expect(job).not.toMatch(/\|\|\s*true/);
  });

  it("the emitter's script file and the npm script exist and the emitter makes no network call", () => {
    expect(existsSync("scripts/coordination/ci-status.ts")).toBe(true);
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts["coordination:ci-status"]).toBe("vite-node scripts/coordination/ci-status.ts");
    const code = readFileSync("scripts/coordination/ci-status.ts", "utf8").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/\bfetch\(|node:https?|node:net|child_process/);
  });
});

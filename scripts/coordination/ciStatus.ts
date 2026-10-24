// CI-generated status — the half of the shared interface that nobody types.
//
// An `nh-status` record is written by a person or an agent and is therefore a CLAIM. This is the other
// half: a record the CI run produces about ITSELF, from the results GitHub Actions hands to a final job
// (`needs.<job>.result`). It exists so a reader — the owner, Claude Code, or ChatGPT through the GitHub API
// — has one machine-readable object whose fields were filled in by the runner rather than by the party who
// benefits from a green result.
//
// WHAT IT IS NOT. It is not independent of whoever can push to the branch: that party can also edit the
// workflow. Its authority is "GitHub's hosted run said so", so a reader who needs more than a claim opens
// the run (`run_url`) and checks that it exists and belongs to `head_sha`. It also says nothing about what
// the jobs tested — only how each ended.
//
// Pure: no network, no filesystem, no clock. The CLI (`ci-status.ts`) does the I/O.
import type { Evidence } from "./statusRecord.ts";

export const CI_STATUS_SCHEMA = "nh-ci-status/v1";

export type JobResult = "success" | "failure" | "cancelled" | "skipped";
const RESULTS: readonly string[] = ["success", "failure", "cancelled", "skipped"];

export interface CiStatusInput {
  /** `owner/repo`, from `github.repository`. */
  repo: string;
  /** The commit under test: the PR head on pull_request events, `github.sha` on push. */
  headSha: string;
  runId: string;
  runAttempt: string;
  ref: string;
  event: string;
  /** `toJSON(needs)`: job id → `{ result }`. Other fields GitHub may add are ignored. */
  needs: unknown;
}

export interface CiStatus {
  schema: typeof CI_STATUS_SCHEMA;
  generated_by: "github-actions";
  repo: string;
  head_sha: string;
  run_id: string;
  run_attempt: string;
  run_url: string;
  ref: string;
  event: string;
  jobs: Array<{ id: string; result: JobResult }>;
  /** `success` only when every job succeeded. `failure` when any failed. Otherwise `incomplete`. */
  overall: "success" | "failure" | "incomplete";
}

const SHA_RE = /^[0-9a-f]{40}$/;
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const DIGITS_RE = /^[0-9]{1,20}$/;
const JOB_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const REF_RE = /^[A-Za-z0-9._\-/]{1,200}$/;
const EVENT_RE = /^[a-z_]{1,40}$/;

/**
 * Build the record. Throws on anything malformed or missing: a status generator that papers over a missing
 * input would produce a record that looks complete and is not, which is worse than no record. In particular
 * an EMPTY job list is refused — "all of nothing succeeded" must never read as success.
 */
export function buildCiStatus(input: CiStatusInput): CiStatus {
  const bad = (what: string): never => {
    throw new Error(`ci-status: ${what}`);
  };
  if (!REPO_RE.test(input.repo)) bad("repo is not owner/name");
  if (!SHA_RE.test(input.headSha)) bad("head sha is not a full 40-character lowercase hex SHA");
  if (!DIGITS_RE.test(input.runId)) bad("run id is not numeric");
  if (!DIGITS_RE.test(input.runAttempt)) bad("run attempt is not numeric");
  if (!REF_RE.test(input.ref)) bad("ref contains characters a branch name should not need");
  if (!EVENT_RE.test(input.event)) bad("event name is malformed");

  const needs = input.needs;
  if (typeof needs !== "object" || needs === null || Array.isArray(needs)) bad("needs is not an object");
  const entries = Object.entries(needs as Record<string, unknown>);
  if (entries.length === 0) bad("needs is empty, so there is nothing to report");

  const jobs = entries
    .map(([id, v]) => {
      if (!JOB_ID_RE.test(id)) bad("a job id is malformed");
      const result = typeof v === "object" && v !== null ? (v as { result?: unknown }).result : undefined;
      if (typeof result !== "string" || !RESULTS.includes(result)) bad(`job '${id}' has no recognised result`);
      return { id, result: result as JobResult };
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const overall: CiStatus["overall"] = jobs.every((j) => j.result === "success")
    ? "success"
    : jobs.some((j) => j.result === "failure")
      ? "failure"
      : "incomplete";

  return {
    schema: CI_STATUS_SCHEMA,
    generated_by: "github-actions",
    repo: input.repo,
    head_sha: input.headSha,
    run_id: input.runId,
    run_attempt: input.runAttempt,
    run_url: `https://github.com/${input.repo}/actions/runs/${input.runId}`,
    ref: input.ref,
    event: input.event,
    jobs,
    overall,
  };
}

/**
 * The bridge into an `nh-status` record: the `ci_run` evidence item a status author would otherwise type
 * by hand. A skipped or cancelled job makes the run `incomplete`, which maps to `cancelled` — never to
 * `success`, so a record cannot reach `tested` on a partial run.
 */
export function ciStatusEvidence(status: CiStatus): Evidence {
  return {
    kind: "ci_run",
    url: status.run_url,
    head_sha: status.head_sha,
    conclusion: status.overall === "success" ? "success" : status.overall === "failure" ? "failure" : "cancelled",
    note: `generated by CI, attempt ${status.run_attempt}, event ${status.event}`,
  };
}

/** A GitHub job-summary body: a human line, then the machine record in a fenced block. */
export function renderSummary(status: CiStatus): string {
  const lines = [
    `### CI status for \`${status.head_sha.slice(0, 8)}\`: ${status.overall.toUpperCase()}`,
    "",
    "| Job | Result |",
    "|---|---|",
    ...status.jobs.map((j) => `| ${j.id} | ${j.result} |`),
    "",
    "Generated by the CI run itself from `needs.*.result`. It records how each job ended, not what it tested, and",
    "it is only as independent as the workflow file; open the run to confirm it exists and belongs to this SHA.",
    "",
    "```nh-ci-status",
    JSON.stringify(status, null, 2),
    "```",
    "",
  ];
  return lines.join("\n");
}

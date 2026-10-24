// `npm run coordination:ci-status` — emit the CI-generated status record. Runs inside GitHub Actions, in the
// final job, with `permissions: contents: read`. It writes ONLY:
//   · ci-status.json in the working directory (uploaded as an artifact), and
//   · $GITHUB_STEP_SUMMARY when GitHub provides it.
// It makes no network call, posts nothing and holds no credential. Exit 1 on any malformed input.
import { appendFileSync, writeFileSync } from "node:fs";
import { buildCiStatus, renderSummary } from "./ciStatus.ts";

function main(): number {
  const env = process.env;
  let needs: unknown;
  try {
    needs = JSON.parse(env.NH_NEEDS_JSON ?? "");
  } catch {
    console.error("ci-status: NH_NEEDS_JSON is missing or not valid JSON, so no status was produced.");
    return 1;
  }
  try {
    const status = buildCiStatus({
      repo: env.NH_REPO ?? "",
      headSha: env.NH_HEAD_SHA ?? "",
      runId: env.NH_RUN_ID ?? "",
      runAttempt: env.NH_RUN_ATTEMPT ?? "",
      ref: env.NH_REF ?? "",
      event: env.NH_EVENT ?? "",
      needs,
    });
    writeFileSync("ci-status.json", `${JSON.stringify(status, null, 2)}\n`);
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, renderSummary(status));
    console.log(`ci-status: ${status.overall} for ${status.head_sha} (${status.jobs.length} job(s)) — ${status.run_url}`);
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : "ci-status: failed");
    return 1;
  }
}

process.exit(main());

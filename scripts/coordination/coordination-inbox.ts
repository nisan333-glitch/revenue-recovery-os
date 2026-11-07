// `npm run coordination:inbox -- <issue>` — READ-ONLY. Which bridge messages were never recorded?
//
// ALL THE I/O IS HERE AND NOTHING ELSE IS. The decision lives in `inbox.ts`, which is pure, so every
// claim this command makes can be falsified without a network call. `main()` runs at module scope, so
// argv, the environment, stdout and the exit code must stay in this file.
//
// IT READS BODIES AND REPORTS NONE. A comment body may hold anything a sender wrote; this is a delivery
// check, so only ids, hashes and counts are printed.
import { readFileSync } from "node:fs";
import { buildInboxReport, inboxExitCode, renderInboxReport, toInboxComment } from "./inbox.ts";

const API = "https://api.github.com";

/** Reads the piped JSON. I/O, so it stays in the entry point and never in the core. */
function readStdin(): string {
  return readFileSync(0, "utf8");
}

function need(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === "") throw new Error(`missing environment variable ${name}`);
  return v;
}
async function main(): Promise<number> {
  const issue = Number(process.argv[2]);
  if (!Number.isSafeInteger(issue) || issue <= 0) {
    console.error("usage: npm run coordination:inbox -- <issue-number> [--stdin]");
    return 2;
  }
  if (process.argv.includes("--stdin")) {
    const parsed: unknown = JSON.parse(readStdin());
    if (!Array.isArray(parsed)) {
      console.error("--stdin expects the JSON array GitHub returns for an issue's comments");
      return 2;
    }
    const report = buildInboxReport(issue, parsed.map((r) => toInboxComment(r as never)));
    console.log(renderInboxReport(report));
    return inboxExitCode(report);
  }
  const repo = process.env.NH_REPO ?? "nisan333-glitch/revenue-recovery-os";
  const token = need("GH_TOKEN");
  const rows: Parameters<typeof toInboxComment>[0][] = [];
  for (let page = 1; page <= 20; page += 1) {
    const res = await fetch(`${API}/repos/${repo}/issues/${issue}/comments?per_page=100&page=${page}`, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "nh-coordination-inbox",
      },
    });
    if (!res.ok) throw new Error(`GitHub returned ${res.status} for issue #${issue} comments`);
    const batch = (await res.json()) as typeof rows;
    rows.push(...batch);
    if (batch.length < 100) break;
  }
  const report = buildInboxReport(issue, rows.map(toInboxComment));
  console.log(renderInboxReport(report));
  return inboxExitCode(report);
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`NH_INTERNAL_ERROR — ${error instanceof Error ? error.message : String(error)}`);
    process.exit(3);
  });

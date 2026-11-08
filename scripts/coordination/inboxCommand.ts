// The inbox command's logic, separated from its entry point.
//
// WHY THIS FILE EXISTS, STATED PLAINLY. CI run 42421190355 failed two jobs with an unhandled rejection at
// `coordination-inbox.ts:137` — `process.exit(3)` — while all 1705 tests PASSED. The cause was that
// `inbox.test.ts` imported `toInboxComment` from the CLI module, whose `main()` ran at module scope. The
// chain, reproduced exactly:
//
//     import  ->  main()  ->  argv has no issue number  ->  usage printed  ->  return 2
//             ->  .then(code => process.exit(2))  ->  vitest's process.exit guard THROWS
//             ->  .catch(...) prints `NH_INTERNAL_ERROR — process.exit unexpectedly called with "2"`
//             ->  process.exit(3)  ->  throws again, with nothing after it to catch
//
// So the `.catch()` handler was itself what made the failure UNHANDLED. **A catch that calls `process.exit`
// cannot be the last link in a promise chain** — it converts a handled failure into an unhandled one.
//
// AND THE FIRST FIX WAS INCOMPLETE. Commit `4587561` moved `toInboxComment` into `inbox.ts` so the test no
// longer imported the CLI. That stopped the failure and left the real defect in place: argv parsing, the
// `--stdin` path, the GitHub paging loop and the exit-code mapping were ALL still inside the entry point,
// reachable by no test. The claims that matter — that a usage error is 2, that an unhealthy report is 1,
// that nothing examined is 2, that a GitHub refusal is 3, that no body text is ever printed — could not be
// falsified. *A command whose claims cannot be imported cannot be falsified*, which this repository has now
// recorded three times.
//
// BEHAVIOUR IS PRESERVED AT THE OBSERVABLE BOUNDARY. Every message string and every exit code is unchanged
// from the pre-fix CLI; the GitHub-refusal path returns the same stderr text with the same code 3 instead of
// throwing, which makes it testable without altering what a caller sees. A genuinely unexpected throw still
// reaches the entry point's single catch and still ends as `NH_INTERNAL_ERROR` with code 3.
//
// PURE OF AMBIENT I/O. `fetch` and stdin arrive as injected dependencies; argv and the environment arrive as
// arguments. Nothing here reads `process`, writes a stream or exits.
import { buildInboxReport, inboxExitCode, renderInboxReport, toInboxComment } from "./inbox.ts";

const API = "https://api.github.com";

export const INBOX_USAGE = "usage: npm run coordination:inbox -- <issue-number> [--stdin]";
export const INBOX_STDIN_SHAPE_ERROR = "--stdin expects the JSON array GitHub returns for an issue's comments";

export interface InboxCommandResult {
  /** Lines for stdout: the rendered report, and nothing else. */
  lines: readonly string[];
  /** Lines for stderr: usage and refusals. */
  errLines: readonly string[];
  exitCode: number;
}

export interface InboxCommandDeps {
  fetchImpl: typeof fetch;
  /** Reads the piped JSON. Injected, so the `--stdin` path is reachable without a real pipe. */
  readStdin: () => string;
}

/**
 * Run the command.
 *
 * Returns lines and an exit code. It never writes a stream and never exits, so a test can assert what it
 * would have printed and what code it would have ended with.
 */
export async function runInboxCommand(
  argv: readonly string[],
  env: Record<string, string | undefined>,
  deps: InboxCommandDeps,
): Promise<InboxCommandResult> {
  const issue = Number(argv[0]);
  if (!Number.isSafeInteger(issue) || issue <= 0) {
    return { lines: [], errLines: [INBOX_USAGE], exitCode: 2 };
  }

  if (argv.includes("--stdin")) {
    const parsed: unknown = JSON.parse(deps.readStdin());
    if (!Array.isArray(parsed)) {
      return { lines: [], errLines: [INBOX_STDIN_SHAPE_ERROR], exitCode: 2 };
    }
    const report = buildInboxReport(issue, parsed.map((r) => toInboxComment(r as never)));
    return { lines: [renderInboxReport(report)], errLines: [], exitCode: inboxExitCode(report) };
  }

  const repo = env.NH_REPO ?? "nisan333-glitch/revenue-recovery-os";
  const token = env.GH_TOKEN;
  if (token === undefined || token === "") {
    // Preserved verbatim: this used to be a thrown Error that the entry point rendered under the same
    // prefix with the same code. It is returned now so the path is reachable by a test.
    return { lines: [], errLines: ["NH_INTERNAL_ERROR — missing environment variable GH_TOKEN"], exitCode: 3 };
  }

  const rows: Parameters<typeof toInboxComment>[0][] = [];
  for (let page = 1; page <= 20; page += 1) {
    const res = await deps.fetchImpl(`${API}/repos/${repo}/issues/${issue}/comments?per_page=100&page=${page}`, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "nh-coordination-inbox",
      },
    });
    if (!res.ok) {
      // NOT our bug, so it does not claim to be one beyond the prefix the pre-fix CLI already printed.
      return {
        lines: [],
        errLines: [`NH_INTERNAL_ERROR — GitHub returned ${res.status} for issue #${issue} comments`],
        exitCode: 3,
      };
    }
    const batch = (await res.json()) as typeof rows;
    rows.push(...batch);
    if (batch.length < 100) break;
  }
  const report = buildInboxReport(issue, rows.map(toInboxComment));
  return { lines: [renderInboxReport(report)], errLines: [], exitCode: inboxExitCode(report) };
}

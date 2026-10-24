// `npm run bridge:endpoint` — run one party's side of the coordination bridge.
//
// THIS FILE IS THE EDGE AND NOTHING ELSE. argv, the real GitHub transport, the sleep between polls and the
// exit code. Every decision it makes lives in `endpoint.ts`, which imports nothing that can act and runs
// nothing on import, so the logic is driven directly by `endpoint.test.ts` without a network.
//
// WHY THIS FILE EXISTS AT ALL, recorded because it cost a failed end-to-end run. `endpoint.ts` originally
// ended with `main()` behind a guard testing `process.argv[1]`. Under `vite-node` that is the vite-node
// BINARY and the script path never appears in argv, so the guard never fired: two endpoints started, did
// nothing, exited 0 silently, and the end-to-end test timed out having seen zero comments. The repository
// had already settled the shape — `ciStatus.ts` beside `ci-status.ts` — and this follows it.
//
// Usage:
//   bridge:endpoint -- --repo owner/name --issue 13 --as claude-code
//                      [--send "text" --to chatgpt] [--auto-respond "text"]
//                      [--poll 15] [--once | --max-cycles N] [--ledger PATH]
//
// It holds NO credential: `gh` authenticates, and this process never reads a token.
import {
  DEFAULT_RETRY,
  PARTIES,
} from "./bridge.ts";
import type { Party } from "./bridge.ts";
import { runCycle, send } from "./endpoint.ts";
import type { EndpointConfig, Transport } from "./endpoint.ts";
import {
  DEFAULT_POLL_SECONDS,
  checkChannel,
  listCommentsSince,
  pollInterval,
  postComment,
} from "./githubChannel.ts";

function arg(name: string, fallback: string | null = null): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1]! : fallback;
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const isParty = (x: string | null): x is Party => x !== null && (PARTIES as readonly string[]).includes(x);

async function main(): Promise<number> {
  const repo = arg("repo");
  const issueRaw = arg("issue");
  const me = arg("as");
  if (repo === null || issueRaw === null || me === null) {
    console.error(
      "usage: bridge:endpoint -- --repo owner/name --issue N --as <" + PARTIES.join("|") + ">" +
        " [--ledger P] [--poll S] [--once] [--max-cycles N] [--send TEXT --to PARTY] [--auto-respond TEXT]",
    );
    return 2;
  }
  if (!isParty(me)) {
    console.error(`--as must be one of ${PARTIES.join(", ")}`);
    return 2;
  }
  const issue = Number.parseInt(issueRaw, 10);
  if (!Number.isSafeInteger(issue) || issue <= 0) {
    console.error("--issue must be a positive integer");
    return 2;
  }

  const ledgerPath = arg("ledger", `.nh-bridge/${me}.ledger.json`)!;
  const cfg: EndpointConfig = {
    me,
    ledgerPath,
    cursorPath: arg("cursor", `${ledgerPath}.cursor.json`)!,
    retry: {
      maxAttempts: Number.parseInt(arg("max-attempts", String(DEFAULT_RETRY.maxAttempts))!, 10),
      baseSeconds: Number.parseInt(arg("retry-base", String(DEFAULT_RETRY.baseSeconds))!, 10),
      capSeconds: Number.parseInt(arg("retry-cap", String(DEFAULT_RETRY.capSeconds))!, 10),
    },
    autoRespond: arg("auto-respond"),
  };

  const ref = { repo, issue };
  // CHECKED BEFORE ANYTHING IS CLAIMED. An unusable channel is the INPUT's problem and is reported as
  // such; discovering it later as a confusing parse failure would blame the wrong thing.
  const health = await checkChannel(ref);
  if (!health.ok) {
    console.error(`endpoint ${me}: channel unusable — ${health.detail}`);
    return 1;
  }
  console.log(`endpoint ${me}: ${health.detail}`);

  const transport: Transport = {
    post: (body) => postComment(ref, body),
    poll: (since, etag) => listCommentsSince(ref, since, etag),
  };

  const sendText = arg("send");
  if (sendText !== null) {
    const to = arg("to");
    if (!isParty(to)) {
      console.error(`--send requires --to <${PARTIES.join("|")}>`);
      return 2;
    }
    const out = await send(cfg, transport, to, sendText, new Date(), { salt: arg("salt", "")! });
    console.log(`endpoint ${me}: sent ${out.message.id} -> ${to} outcome=${out.outcome} comment=${out.commentId ?? "none"}`);
    if (out.commentId === null) return 1;
  }

  const { seconds, floored } = pollInterval(Number.parseInt(arg("poll", String(DEFAULT_POLL_SECONDS))!, 10));
  if (floored) console.log(`endpoint ${me}: poll interval floored to ${seconds}s`);
  const maxCycles = Number.parseInt(arg("max-cycles", flag("once") ? "1" : "0")!, 10);

  for (let n = 1; maxCycles === 0 || n <= maxCycles; n += 1) {
    const report = await runCycle(cfg, transport, new Date());
    // One line per cycle, and only when something happened: a long idle run must not fill a log, but every
    // state change must be visible — including failures, which are the whole point of a bounded schedule.
    const moved =
      report.accepted.length + report.duplicates.length + report.delivered.length +
      report.receiptsPosted.length + report.responsesPosted.length + report.failed.length +
      report.conflicts.length + report.errors.length;
    if (moved > 0) {
      console.log(
        `endpoint ${me}: cycle ${n} seen=${report.commentsSeen} accepted=[${report.accepted.join(",")}] ` +
          `dup=[${report.duplicates.join(",")}] conflict=[${report.conflicts.join(",")}] ` +
          `acked=[${report.receiptsPosted.join(",")}] responded=[${report.responsesPosted.join(",")}] ` +
          `delivered=[${report.delivered.join(",")}] failed=[${report.failed.join(",")}]` +
          (report.errors.length > 0 ? ` errors=${JSON.stringify(report.errors)}` : ""),
      );
    }
    if (maxCycles !== 0 && n >= maxCycles) break;
    await sleep(seconds * 1000);
  }
  return 0;
}

// Unconditional, like every other command in this repository. Nothing imports this file.
main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`endpoint: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });

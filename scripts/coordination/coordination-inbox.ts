// `npm run coordination:inbox -- <issue>` — READ-ONLY. Which bridge messages were never recorded?
//
// ALL THE I/O IS HERE AND NOTHING ELSE IS. The decision lives in `inbox.ts`, which is pure, so every
// claim this command makes can be falsified without a network call. `main()` runs at module scope, so
// argv, the environment, stdout and the exit code must stay in this file.
//
// IT READS BODIES AND REPORTS NONE. A comment body may hold anything a sender wrote; this is a delivery
// check, so only ids, hashes and counts are printed.
import { readFileSync } from "node:fs";
import { parseComment } from "./wire.ts";
import { buildInboxReport, inboxExitCode, renderInboxReport, type InboxComment } from "./inbox.ts";

const API = "https://api.github.com";
const LEDGER_FENCE = "nh-ledger-receipt";

function need(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === "") throw new Error(`missing environment variable ${name}`);
  return v;
}

/**
 * The receiver's own reply format. It posts an `nh-ledger-receipt` block — NOT an `nh-receipt` — which is
 * why a checker looking only for the wire receipt finds nothing and would wrongly report every message
 * unhandled. Read from the receiver's actual output rather than from what the protocol doc calls a receipt.
 */
function ledgerReceipt(body: string): { messageId: string | null; bodySha256: string | null } {
  const m = body.match(/```nh-ledger-receipt\s*\n([\s\S]*?)\n```/);
  if (!m) return { messageId: null, bodySha256: null };
  try {
    const parsed = JSON.parse(m[1]!) as { message_id?: unknown; body_sha256?: unknown };
    return {
      messageId: typeof parsed.message_id === "string" ? parsed.message_id : null,
      bodySha256: typeof parsed.body_sha256 === "string" ? parsed.body_sha256 : null,
    };
  } catch {
    return { messageId: null, bodySha256: null };
  }
}

export function toInboxComment(row: {
  id: number; created_at: string; user: { login: string } | null; body: string | null;
}): InboxComment {
  const body = row.body ?? "";
  const ledger = ledgerReceipt(body);
  // A ledger receipt is the receiver's own artefact and is never also a message, so it is not re-parsed
  // as one: `parseComment` would report "a body block without an envelope" and inflate `unusable`.
  if (ledger.messageId !== null) {
    return {
      commentId: row.id, createdAt: row.created_at, author: row.user?.login ?? "unknown",
      messageId: null, bodySha256: null,
      receiptForMessageId: ledger.messageId, receiptBodySha256: ledger.bodySha256,
      errors: [],
    };
  }
  // A comment carrying no fence at all is ordinary prose, not a wire error. Only a comment that TRIED to
  // carry an envelope and failed is unusable — otherwise every human sentence would read as a fault.
  const attempted = /```nh-(msg|body|receipt)\s/.test(body) || body.includes(`\`\`\`${LEDGER_FENCE}`);
  if (!attempted) {
    return {
      commentId: row.id, createdAt: row.created_at, author: row.user?.login ?? "unknown",
      messageId: null, bodySha256: null, receiptForMessageId: null, receiptBodySha256: null, errors: [],
    };
  }
  const parsed = parseComment(body);
  const envelope = parsed.message as { id?: unknown; body_sha256?: unknown } | null;
  return {
    commentId: row.id,
    createdAt: row.created_at,
    author: row.user?.login ?? "unknown",
    messageId: envelope && typeof envelope.id === "string" ? envelope.id : null,
    bodySha256: envelope && typeof envelope.body_sha256 === "string" ? envelope.body_sha256 : null,
    receiptForMessageId: null,
    receiptBodySha256: null,
    errors: parsed.errors,
  };
}

function readStdin(): string {
  return readFileSync(0, "utf8");
}

/**
 * TWO INPUT MODES, and `--stdin` is the one that works everywhere.
 *
 * `gh` authenticates through a proxy in some environments and exposes no token, so a direct fetch gets a
 * 401 there. The repository already solved this for `coordination:validate`, which takes piped input, so
 * this command takes the same shape rather than inventing a second convention:
 *
 *   gh api "repos/<o>/<r>/issues/13/comments?per_page=100" > c.json
 *   npm run coordination:inbox -- 13 --stdin < c.json
 *
 * The fetch path stays for CI, where `GH_TOKEN` is the run's own token.
 */
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

// The transport: GitHub issue comments · step 5 of the Phase 4 plan.
//
// WHAT THIS IS. The only module in the bridge that touches the network. It posts a comment and it reads
// comments back, and it does both through `gh api` — the REST API — and nothing else.
//
// WHY `gh` AND NOT A TOKEN OF OUR OWN. This process never reads, stores, logs or forwards a credential:
// `gh` holds the authentication and this module shells out to it. That makes "never expose secrets" a
// property of the design rather than a discipline — there is no secret in scope to leak. The cost is an
// external dependency on `gh` being installed and authenticated, which is checked explicitly at startup
// rather than discovered as a confusing parse failure.
//
// REST ONLY, AND THAT IS NOT A PREFERENCE. GitHub's GraphQL endpoint is unavailable from this environment
// (`gh issue create` fails with HTTP 403 and a message saying to use REST). Every call here is
// `gh api repos/{owner}/{repo}/...`, which works. A future rewrite onto GraphQL would break the bridge in
// exactly the environment it was built for.
//
// POLLING IS A FALLBACK AND IS CONDITIONAL. `listCommentsSince` sends `If-None-Match` with the previous
// ETag, so an unchanged channel costs a 304 — which GitHub does not count against the primary rate limit.
// The interval is a parameter with a floor, because a one-second poll is both rude and pointless: the
// owner's brief rules it out, and the authenticated limit of 5000 requests an hour is 1.4 per second.
import { execFile } from "node:child_process";

/** The floor on any poll interval. A tighter loop is refused rather than silently widened. */
export const MIN_POLL_SECONDS = 5;
/** What an endpoint uses when nothing is specified: frequent enough to feel immediate, cheap under ETags. */
export const DEFAULT_POLL_SECONDS = 15;

export interface ChannelRef {
  /** `owner/repo`. */
  readonly repo: string;
  readonly issue: number;
}

export interface CommentRecord {
  readonly id: number;
  readonly body: string;
  readonly createdAt: string;
  readonly author: string;
}

export interface PollResult {
  /** Empty when the channel was unchanged (HTTP 304) — not an error, and not a failure to report. */
  readonly comments: readonly CommentRecord[];
  /** Pass back on the next call. `null` when GitHub returned none. */
  readonly etag: string | null;
  /** True when GitHub answered 304, so a caller can distinguish "nothing new" from "nothing matched". */
  readonly unchanged: boolean;
}

class GhError extends Error {
  constructor(message: string, readonly stderr: string) {
    super(message);
  }
}

/**
 * Run `gh` with arguments.
 *
 * ARGUMENTS, NEVER A SHELL STRING. `execFile` with an argv array cannot be shell-injected, and a message
 * body is arbitrary text that may contain quotes, backticks and newlines. A `gh api ... -f body="$X"`
 * built by string concatenation is a command injection waiting for the first message that contains a
 * quote — and in this bridge the bodies come from another party.
 */
function gh(args: readonly string[], input?: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "gh",
      args,
      { maxBuffer: 16 * 1024 * 1024, env: process.env },
      (err, stdout, stderr) => {
        if (err) {
          // The stderr is surfaced because `gh` explains itself there, but it is never prefixed with the
          // argv: a future caller passing a token on the command line must not have it echoed into a log.
          reject(new GhError(`gh ${args[0]} failed: ${err.message.split("\n")[0]}`, stderr));
          return;
        }
        resolve({ stdout, stderr });
      },
    );
    if (input !== undefined) {
      child.stdin?.end(input);
    }
  });
}

/**
 * Is `gh` present and authenticated enough to use this channel?
 *
 * Checked by READING THE CHANNEL, not by `gh auth status`. In this environment `gh auth status` reports the
 * environment token as invalid while `gh api` works through the session's proxy, so the status command
 * would refuse a channel that functions perfectly. The only question that matters is whether the call this
 * module actually makes succeeds.
 */
export async function checkChannel(ref: ChannelRef): Promise<{ ok: boolean; detail: string }> {
  try {
    const { stdout } = await gh(["api", `repos/${ref.repo}/issues/${ref.issue}`, "--jq", ".number"]);
    const n = Number.parseInt(stdout.trim(), 10);
    if (n !== ref.issue) return { ok: false, detail: `expected issue ${ref.issue}, got '${stdout.trim()}'` };
    return { ok: true, detail: `issue ${ref.repo}#${ref.issue} is readable` };
  } catch (err) {
    const detail = err instanceof GhError ? `${err.message}: ${err.stderr.trim().split("\n")[0]}` : String(err);
    return { ok: false, detail };
  }
}

/** Post a comment. Returns its id, so a caller can record exactly what it published. */
export async function postComment(ref: ChannelRef, body: string): Promise<number> {
  // The body goes in via stdin as JSON rather than as an `-f` flag: `-f` would require escaping, and a
  // body containing a newline cannot be passed that way at all.
  const payload = JSON.stringify({ body });
  const { stdout } = await gh(
    ["api", `repos/${ref.repo}/issues/${ref.issue}/comments`, "--method", "POST", "--input", "-", "--jq", ".id"],
    payload,
  );
  const id = Number.parseInt(stdout.trim(), 10);
  if (!Number.isSafeInteger(id)) throw new Error(`posted a comment but could not read its id from '${stdout.trim()}'`);
  return id;
}

/**
 * Read comments, conditionally.
 *
 * `since` narrows server-side; the ETag makes an unchanged channel free. Both are used: `since` alone
 * still transfers and still counts, and an ETag alone would re-transfer the whole thread whenever any
 * comment changed.
 */
export async function listCommentsSince(
  ref: ChannelRef,
  since: string | null,
  etag: string | null,
): Promise<PollResult> {
  const path = since === null
    ? `repos/${ref.repo}/issues/${ref.issue}/comments?per_page=100`
    : `repos/${ref.repo}/issues/${ref.issue}/comments?per_page=100&since=${encodeURIComponent(since)}`;
  const args = ["api", path, "--include"];
  if (etag !== null) args.push("--header", `If-None-Match: ${etag}`);

  let raw: string;
  try {
    ({ stdout: raw } = await gh(args));
  } catch (err) {
    // A 304 is surfaced by `gh` as a non-zero exit with the status in its output. It is NOT an error for
    // this caller: "nothing new" is the expected answer most of the time.
    const text = err instanceof GhError ? `${err.stderr}` : String(err);
    if (/\b304\b/.test(text)) return { comments: [], etag, unchanged: true };
    throw err;
  }

  const split = raw.indexOf("\n\n") >= 0 ? raw.indexOf("\n\n") : raw.indexOf("\r\n\r\n");
  const head = split >= 0 ? raw.slice(0, split) : "";
  const bodyText = split >= 0 ? raw.slice(split).trimStart() : raw;
  if (/^HTTP\/[\d.]+\s+304\b/m.test(head)) return { comments: [], etag, unchanged: true };

  const nextEtag = /^etag:\s*(.+)$/im.exec(head)?.[1]?.trim() ?? etag;

  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText) as unknown;
  } catch {
    throw new Error("could not parse the comment list returned by GitHub");
  }
  if (!Array.isArray(parsed)) throw new Error("GitHub did not return a comment array");

  const comments: CommentRecord[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) continue;
    const c = item as Record<string, unknown>;
    if (typeof c.id !== "number" || typeof c.body !== "string" || typeof c.created_at !== "string") continue;
    const user = c.user as Record<string, unknown> | null | undefined;
    comments.push(
      Object.freeze({
        id: c.id,
        body: c.body,
        createdAt: c.created_at,
        author: typeof user?.login === "string" ? user.login : "unknown",
      }),
    );
  }
  // Ordered by the id GitHub allocated, which is its append order — never by `created_at` alone, which is
  // second-granular and would tie. This repository has already paid for a log ordered by a clock with a
  // random tie-break; the same mistake is not repeated here.
  comments.sort((a, b) => a.id - b.id);
  return { comments: Object.freeze(comments), etag: nextEtag, unchanged: false };
}

/** The interval a poller may use: the request, floored, with the floor reported rather than applied silently. */
export function pollInterval(requestedSeconds: number): { seconds: number; floored: boolean } {
  if (!Number.isFinite(requestedSeconds) || requestedSeconds <= 0) {
    return { seconds: DEFAULT_POLL_SECONDS, floored: false };
  }
  if (requestedSeconds < MIN_POLL_SECONDS) return { seconds: MIN_POLL_SECONDS, floored: true };
  return { seconds: requestedSeconds, floored: false };
}

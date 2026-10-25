// Receiver for the NH coordination bridge · step 2 of docs/NH_COORDINATION_PROTOCOL_V1.md "Phase 4".
//
// A GitHub Actions run, started by an `issue_comment` event, replays the issue's own comment history through the
// delivery core (`bridge.ts`) and answers with a ledger record. GitHub is the ledger and the transport; this
// holds no state of its own, so a re-run recomputes the same answer.
//
// WHAT A COMMENT IS. The one wire format is `wire.ts`: a message is a comment carrying one fenced `nh-msg`
// envelope (JSON) AND one fenced `nh-body` block holding the content verbatim; the envelope's `body_sha256`
// must equal the SHA-256 of that body. A receipt is a comment carrying one fenced `nh-receipt` block. Anything
// else is ignored. The earlier "body = the surrounding comment text" form is RETIRED: a comment in it is
// rejected with an explicit hint rather than guessed at, so the two formats can never disagree about a hash.
//
// WHAT IT CAN AND CANNOT PROVE.
//   · It proves the message was RECORDED in the issue's ledger, and that its content, hash, expiry, duplicate
//     status and receipts are consistent.
//   · It does NOT authenticate the sender or the addressee. Every comment here comes from one GitHub account
//     (the repository owner), so `from`, `to` and `received_by` are claims the receiver checks for consistency,
//     not identities it verifies. A receipt is a CLAIM by the addressee that it read the message.
//   · It cannot make ChatGPT read anything. ChatGPT runs only on a user turn.
//
// SAFETY. The comment text is data: it is parsed as JSON under size caps and never reaches a shell, a `uses:`
// or an `eval`. Edited comments are not part of the ledger (an edit would rewrite history). Text echoed back
// into a reply is restricted to a safe character set and cannot carry an @-mention or a link.
import {
  acknowledge,
  receive,
  type AckOutcome,
  type Ledger,
  type ReceiveOutcome,
} from "./bridge.ts";
import { BODY_FENCE, MSG_FENCE, RECEIPT_FENCE, parseComment } from "./wire.ts";

export const LEDGER_SCHEMA = "nh-ledger-receipt/v1";
export const MAX_COMMENT_CHARS = 20_000;
export const MAX_BLOCK_CHARS = 4_000;

export interface Comment {
  id: number;
  body: string;
  created_at: string;
  updated_at: string;
  /** GitHub's author_association for the commenter. */
  author_association: string;
  /** GitHub's user.type for the commenter: "User", "Bot", ... */
  user_type: string;
}

export type Kind =
  | "message_recorded"
  | "message_duplicate"
  | "message_conflict"
  | "message_rejected"
  | "delivered"
  | "already_delivered"
  | "receipt_refused";

export interface LedgerReceipt {
  schema: typeof LEDGER_SCHEMA;
  generated_by: "github-actions";
  kind: Kind;
  comment_id: number;
  message_id: string | null;
  body_sha256: string | null;
  errors: string[];
  decided_at: string;
}

/** Fence markers are built from parts so this source file never contains a literal fence that a parser might read. */
const TICKS = "`".repeat(3);

/** GitHub may store a comment typed in the web UI with CRLF line endings; the canonical body uses LF. */
const normalise = (text: string): string => text.replace(/\r\n/g, "\n");

/** Does the text contain a line that opens a protocol fence? Used only to decide whether silence would hide a message. */
const opensProtocolFence = (text: string): boolean =>
  new RegExp(`^\\x60{3,}(?:${MSG_FENCE}|${BODY_FENCE}|${RECEIPT_FENCE})[ \\t]*$`, "m").test(normalise(text));

const LEGACY_HINT =
  "the text-as-body form is retired; put the message content in a separate nh-body block";

export type Sha256 = (text: string) => string;

/**
 * Keep only characters that cannot form a mention, link, fence or markup; cap the length. Colon and dot are
 * dropped on purpose: GitHub autolinks `scheme://host` and `www.host`, and neither can be spelled without them.
 */
export function sanitize(text: string, max = 200): string {
  return text.replace(/[^A-Za-z0-9 _,'()/=-]/g, "?").slice(0, max);
}

interface Applied {
  ledger: Ledger;
  kind: Kind | null; // null: this comment is not part of the protocol
  messageId: string | null;
  bodySha: string | null;
  errors: string[];
}

const rec = (x: unknown): Record<string, unknown> | null =>
  typeof x === "object" && x !== null && !Array.isArray(x) ? (x as Record<string, unknown>) : null;

const MSG_KIND: Record<ReceiveOutcome, Kind> = {
  accepted: "message_recorded",
  duplicate: "message_duplicate",
  conflict: "message_conflict",
  rejected: "message_rejected",
};
const ACK_KIND: Record<AckOutcome, Kind> = {
  delivered: "delivered",
  already_delivered: "already_delivered",
  refused: "receipt_refused",
};

/** Apply one comment to the ledger. `now` is the comment's own creation time, so replay is deterministic. */
export function applyComment(ledger: Ledger, c: Comment, sha256: Sha256): Applied {
  const none: Applied = { ledger, kind: null, messageId: null, bodySha: null, errors: [] };
  if (c.body.length > MAX_COMMENT_CHARS) return none;
  const parsed = parseComment(normalise(c.body));
  if (parsed.message === null && parsed.receipt === null && parsed.errors.length === 0) return none;
  const now = new Date(c.created_at);
  const reject = (errors: string[], messageId: string | null = null, bodySha: string | null = null): Applied => ({
    ledger,
    kind: "message_rejected",
    messageId,
    bodySha,
    errors,
  });

  if (parsed.errors.length > 0) {
    const errors = [...parsed.errors];
    // A legacy comment has an envelope and no nh-body block: say what to do instead of only what is wrong.
    if (errors.some((e) => e.includes("must be accompanied by exactly one"))) errors.push(LEGACY_HINT);
    return reject(errors);
  }

  if (parsed.message !== null) {
    const r = rec(parsed.message);
    const id = typeof r?.id === "string" ? r.id : null;
    const body = parsed.body ?? "";
    const declared = typeof r?.body_sha256 === "string" ? r.body_sha256 : null;
    const actual = sha256(body);
    if (declared !== actual) {
      return reject(["body_sha256 does not match the SHA-256 of the nh-body block"], id, actual);
    }
    if (JSON.stringify(parsed.message).length > MAX_BLOCK_CHARS) {
      return reject(["the nh-msg envelope exceeds the size cap"], id, actual);
    }
    const out = receive(ledger, parsed.message, now);
    return { ledger: out.ledger, kind: MSG_KIND[out.outcome], messageId: id, bodySha: actual, errors: out.errors };
  }

  const mk = (errors: string[]): Applied => ({ ledger, kind: "receipt_refused", messageId: null, bodySha: null, errors });
  if (JSON.stringify(parsed.receipt).length > MAX_BLOCK_CHARS) return mk(["the nh-receipt block exceeds the size cap"]);
  const r = rec(parsed.receipt);
  const out = acknowledge(ledger, parsed.receipt, now);
  return {
    ledger: out.ledger,
    kind: ACK_KIND[out.outcome],
    messageId: typeof r?.message_id === "string" ? r.message_id : null,
    bodySha: typeof r?.body_sha256 === "string" ? r.body_sha256 : null,
    errors: out.errors,
  };
}

/** Comments that may be part of the ledger: the owner's, never edited. */
export function isLedgerComment(c: Comment): boolean {
  return c.author_association === "OWNER" && c.created_at === c.updated_at;
}

export interface Decision {
  /** null when the triggering comment is not part of the protocol, so nothing should be posted. */
  receipt: LedgerReceipt | null;
}

/** Replay the issue's history in comment-id order, then decide on the triggering comment. */
export function decide(all: Comment[], triggerId: number, sha256: Sha256): Decision {
  const ordered = [...all].sort((a, b) => a.id - b.id);
  const trigger = ordered.find((c) => c.id === triggerId);
  if (trigger === undefined) throw new Error("triggering comment is not among the issue's comments");
  if (trigger.author_association !== "OWNER") return { receipt: null };
  // An oversized trigger that opens a protocol fence is REJECTED VISIBLY: silence would look like "not yet processed".
  if (trigger.body.length > MAX_COMMENT_CHARS) {
    if (!opensProtocolFence(trigger.body.slice(0, MAX_COMMENT_CHARS * 4))) return { receipt: null };
    return { receipt: ledgerReceipt(trigger, "message_rejected", null, null, [`the comment exceeds ${MAX_COMMENT_CHARS} characters and was not processed`]) };
  }
  const trig = parseComment(normalise(trigger.body));
  if (trig.message === null && trig.receipt === null && trig.errors.length === 0) return { receipt: null };
  if (trigger.created_at !== trigger.updated_at) {
    return { receipt: ledgerReceipt(trigger, "message_rejected", null, null, ["the comment was edited; edited comments are not part of the ledger"]) };
  }
  let ledger: Ledger = Object.freeze({});
  for (const c of ordered) {
    if (c.id >= triggerId) break;
    if (!isLedgerComment(c)) continue;
    ledger = applyComment(ledger, c, sha256).ledger;
  }
  const a = applyComment(ledger, trigger, sha256);
  if (a.kind === null) return { receipt: null };
  return { receipt: ledgerReceipt(trigger, a.kind, a.messageId, a.bodySha, a.errors) };
}

function ledgerReceipt(c: Comment, kind: Kind, messageId: string | null, bodySha: string | null, errors: string[]): LedgerReceipt {
  const safeId = messageId !== null && /^[a-z0-9][a-z0-9._-]{2,63}$/.test(messageId) ? messageId : null;
  const safeSha = bodySha !== null && /^[0-9a-f]{64}$/.test(bodySha) ? bodySha : null;
  return {
    schema: LEDGER_SCHEMA,
    generated_by: "github-actions",
    kind,
    comment_id: c.id,
    message_id: safeId,
    body_sha256: safeSha,
    errors: errors.map((e) => sanitize(e)),
    decided_at: c.created_at,
  };
}

export const marker = (commentId: number) => `<!-- nh-ledger-receipt:comment:${commentId} -->`;

const HEADLINE: Record<Kind, string> = {
  message_recorded: "RECORDED. The message is in this issue's ledger. This is not a read receipt.",
  message_duplicate: "DUPLICATE. Same id and content as an earlier message; nothing changed.",
  message_conflict: "CONFLICT. This id already exists with different content; the original stands.",
  message_rejected: "REJECTED. The message is not valid and was not recorded.",
  delivered: "DELIVERED. The addressee's receipt was accepted. It is the addressee's claim; this run cannot see who sent it.",
  already_delivered: "ALREADY DELIVERED. A receipt was already accepted; nothing changed.",
  receipt_refused: "RECEIPT REFUSED. The message state is unchanged.",
};

/** The comment the receiver posts. Contains no text taken from the triggering comment beyond sanitised fields. */
export function renderReply(r: LedgerReceipt): string {
  const lines = [
    marker(r.comment_id),
    `**NH ledger: ${r.kind}** (comment ${r.comment_id})`,
    "",
    HEADLINE[r.kind],
    ...(r.errors.length > 0 ? ["", ...r.errors.map((e) => `- ${e}`)] : []),
    "",
    "Sender and addressee are claims inside the records: every comment on this issue comes from one GitHub account.",
    "",
    `${TICKS}nh-ledger-receipt`,
    JSON.stringify(r, null, 2),
    TICKS,
    "",
  ];
  return lines.join("\n");
}

// ---------------------------------------------------------------------------------------------------------
// I/O edge, injected so the retry, idempotency and failure behaviour are testable without a network.

export interface Deps {
  listComments: () => Promise<Comment[]>;
  postComment: (body: string) => Promise<void>;
  sha256: Sha256;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
}

export const MAX_API_ATTEMPTS = 3;

/** Run `fn` up to MAX_API_ATTEMPTS times with doubling backoff. The last error is rethrown: failure is visible. */
export async function withRetry<T>(fn: () => Promise<T>, deps: Pick<Deps, "sleep" | "log">, what: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_API_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      deps.log(`${what}: attempt ${attempt} of ${MAX_API_ATTEMPTS} failed`);
      if (attempt < MAX_API_ATTEMPTS) await deps.sleep(1000 * 2 ** (attempt - 1));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${what} failed`);
}

export type Result = "ignored" | "posted" | "already_answered";

/**
 * The whole receive step. Idempotent: if a reply carrying this comment's marker already exists, it posts
 * nothing, so re-running the job cannot answer twice. Throws (job fails, visibly) if the API stays down.
 */
export async function handle(triggerId: number, deps: Deps): Promise<Result> {
  const all = await withRetry(() => deps.listComments(), deps, "list comments");
  const decision = decide(all, triggerId, deps.sha256);
  if (decision.receipt === null) {
    deps.log("comment is not part of the protocol; nothing to do");
    return "ignored";
  }
  const m = marker(triggerId);
  // Only the Actions bot's own comment counts as an answer: a third party cannot pre-empt a reply by quoting a marker.
  if (all.some((c) => c.user_type === "Bot" && c.body.includes(m))) {
    deps.log("a ledger reply for this comment already exists; not posting again");
    return "already_answered";
  }
  await withRetry(() => deps.postComment(renderReply(decision.receipt as LedgerReceipt)), deps, "post reply");
  deps.log(`posted ${decision.receipt.kind} for comment ${triggerId}`);
  return "posted";
}

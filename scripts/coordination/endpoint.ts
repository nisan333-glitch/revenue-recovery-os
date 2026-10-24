// A bridge endpoint · step 6 of the Phase 4 plan. This is the process that actually moves messages.
//
// WHAT IT IS. One party's side of the exchange, runnable on its own: it publishes messages addressed to
// another party, detects messages addressed to itself, acknowledges them, optionally answers them, and
// retries anything that was never acknowledged until the bounded schedule in `bridge.ts` gives up and says
// so. State lives in a file, so none of that is lost when the process stops.
//
// THE CYCLE IS A PURE-ISH FUNCTION AND THE LOOP IS NOT. `runCycle` takes its transport and its clock as
// parameters, so every claim this file makes can be driven from a test without GitHub and without waiting:
// *a command whose claims cannot be imported cannot be falsified*. `main` holds argv, the real transport,
// the sleep and the exit code, and is the only part a test cannot reach.
//
// WHAT A DELIVERY MEANS, STATED ONCE. A receipt in this channel proves a message reached the RECIPIENT
// ENDPOINT'S ledger. It does not prove a human read it, and it does not prove a model read it. For the
// `chatgpt` party specifically: GitHub cannot wake an inactive ChatGPT conversation, so `delivered` there
// means delivered to a service running on ChatGPT's behalf — never to a conversation. Nothing in this file
// claims otherwise, and the end-to-end test asserts the distinction rather than assuming it.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import {
  MSG_SCHEMA,
  RECEIPT_SCHEMA,
  acknowledge,
  nextAction,
  receive,
  recordAttempt,
  settle,
  undelivered,
} from "./bridge.ts";
import type { Ledger, Message, Party, Receipt, RetryPolicy } from "./bridge.ts";
import { bodyHash, formatMessageComment, formatReceiptComment, parseComment } from "./wire.ts";
import { loadLedger, saveLedger } from "./ledgerStore.ts";
// NOTHING FROM `githubChannel.ts` IS IMPORTED HERE EXCEPT A TYPE, and that is the point: this module
// cannot reach the network. The transport arrives as a parameter, so the only thing that can post a
// comment is whatever the caller passes in — which is how `endpoint.test.ts` drives every path below
// without GitHub.
import type { PollResult } from "./githubChannel.ts";

/** How far back `since` reaches beyond the last seen comment, so a clock skew cannot skip one. */
const LOOKBACK_SECONDS = 120;

export interface Transport {
  post(body: string): Promise<number>;
  poll(since: string | null, etag: string | null): Promise<PollResult>;
}

export interface Cursor {
  /** The highest comment id already processed. Progress is by ID, never by timestamp. */
  lastCommentId: number;
  /** The newest `created_at` seen, used only to narrow the server-side query. */
  lastCreatedAt: string | null;
  etag: string | null;
}

export const EMPTY_CURSOR: Readonly<Cursor> = Object.freeze({ lastCommentId: 0, lastCreatedAt: null, etag: null });

export interface EndpointConfig {
  readonly me: Party;
  readonly ledgerPath: string;
  readonly cursorPath: string;
  readonly retry: RetryPolicy;
  /** When set, a message accepted from another party is answered with this body. */
  readonly autoRespond: string | null;
}

export interface CycleReport {
  readonly unchanged: boolean;
  readonly commentsSeen: number;
  readonly accepted: readonly string[];
  readonly duplicates: readonly string[];
  readonly conflicts: readonly string[];
  readonly receiptsPosted: readonly string[];
  readonly responsesPosted: readonly string[];
  readonly delivered: readonly string[];
  readonly retried: readonly string[];
  readonly failed: readonly string[];
  readonly errors: readonly string[];
}

const EMPTY_REPORT: CycleReport = Object.freeze({
  unchanged: true,
  commentsSeen: 0,
  accepted: [],
  duplicates: [],
  conflicts: [],
  receiptsPosted: [],
  responsesPosted: [],
  delivered: [],
  retried: [],
  failed: [],
  errors: [],
});

export function loadCursor(path: string): Cursor {
  if (!existsSync(path)) return { ...EMPTY_CURSOR };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<Cursor>;
    return {
      lastCommentId: Number.isSafeInteger(parsed.lastCommentId) ? (parsed.lastCommentId as number) : 0,
      lastCreatedAt: typeof parsed.lastCreatedAt === "string" ? parsed.lastCreatedAt : null,
      etag: typeof parsed.etag === "string" ? parsed.etag : null,
    };
  } catch {
    // A cursor is a position, not evidence: losing it costs a re-read of the channel, which dedupes. So
    // unlike the ledger, a corrupt cursor is recoverable by starting over rather than a refusal.
    return { ...EMPTY_CURSOR };
  }
}

export function saveCursor(path: string, cursor: Cursor): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(cursor, null, 2)}\n`, "utf8");
}

/** An id that is stable for a given body and sender, so a re-send is the SAME message and not a new one. */
export function messageId(from: Party, body: string, salt = ""): string {
  return `msg-${bodyHash(`${from}\u0000${salt}\u0000${body}`).slice(0, 24)}`;
}

export function buildMessage(
  from: Party,
  to: Party,
  body: string,
  now: Date,
  ttlSeconds: number,
  inReplyTo: string | null = null,
  salt = "",
): Message {
  return {
    schema: MSG_SCHEMA,
    id: messageId(from, body, salt),
    from,
    to,
    in_reply_to: inReplyTo,
    body_sha256: bodyHash(body),
    created_at: now.toISOString().replace(/\.\d{3}Z$/, ".000Z"),
    expires_at: new Date(now.getTime() + ttlSeconds * 1000).toISOString().replace(/\.\d{3}Z$/, ".000Z"),
  };
}

function iso(now: Date): string {
  return now.toISOString().replace(/\.\d{3}Z$/, ".000Z");
}

/**
 * Publish a message and record it as pending in this endpoint's ledger.
 *
 * The ledger is written BEFORE the comment is posted. If the post then fails, the endpoint has a pending
 * entry it will retry; if the order were reversed, a crash between the two would leave a message published
 * that this endpoint has no record of and will never chase.
 */
export async function send(
  cfg: EndpointConfig,
  transport: Transport,
  to: Party,
  body: string,
  now: Date,
  opts: { ttlSeconds?: number; inReplyTo?: string | null; salt?: string } = {},
): Promise<{ message: Message; commentId: number | null; outcome: string }> {
  const msg = buildMessage(cfg.me, to, body, now, opts.ttlSeconds ?? 3600, opts.inReplyTo ?? null, opts.salt ?? "");
  const ledger = loadLedger(cfg.ledgerPath, now);
  const result = receive(ledger, msg, now);
  if (result.outcome === "rejected" || result.outcome === "conflict") {
    return { message: msg, commentId: null, outcome: `${result.outcome}: ${result.errors.join("; ")}` };
  }
  saveLedger(cfg.ledgerPath, result.ledger);
  let commentId: number | null = null;
  try {
    commentId = await transport.post(formatMessageComment(msg, body));
  } catch (err) {
    return { message: msg, commentId: null, outcome: `post failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  saveLedger(cfg.ledgerPath, recordAttempt(result.ledger, msg.id, now, cfg.retry));
  return { message: msg, commentId, outcome: result.outcome };
}

/**
 * One pass over the channel: read what is new, act on it, then chase what was never acknowledged.
 *
 * ORDER IS DELIBERATE. Inbound first, retries second: a receipt that arrived in this very poll must mark a
 * message delivered BEFORE the retry pass looks at it, or the endpoint would re-send something that had
 * just been acknowledged.
 */
export async function runCycle(cfg: EndpointConfig, transport: Transport, now: Date): Promise<CycleReport> {
  const cursor = loadCursor(cfg.cursorPath);
  const since = cursor.lastCreatedAt === null
    ? null
    : iso(new Date(Date.parse(cursor.lastCreatedAt) - LOOKBACK_SECONDS * 1000));

  let poll: PollResult;
  try {
    poll = await transport.poll(since, cursor.etag);
  } catch (err) {
    return { ...EMPTY_REPORT, unchanged: false, errors: [`poll failed: ${err instanceof Error ? err.message : String(err)}`] };
  }

  const accepted: string[] = [];
  const duplicates: string[] = [];
  const conflicts: string[] = [];
  const receiptsPosted: string[] = [];
  const responsesPosted: string[] = [];
  const delivered: string[] = [];
  const retried: string[] = [];
  const failed: string[] = [];
  const errors: string[] = [];

  let ledger: Ledger = loadLedger(cfg.ledgerPath, now);
  let maxId = cursor.lastCommentId;
  let maxCreated = cursor.lastCreatedAt;

  const fresh = poll.comments.filter((c) => c.id > cursor.lastCommentId);
  for (const comment of fresh) {
    maxId = Math.max(maxId, comment.id);
    if (maxCreated === null || Date.parse(comment.createdAt) > Date.parse(maxCreated)) maxCreated = comment.createdAt;

    const parsed = parseComment(comment.body);
    if (parsed.errors.length > 0) {
      errors.push(`comment ${comment.id}: ${parsed.errors.join("; ")}`);
      continue;
    }

    // ── a receipt for something this endpoint sent ───────────────────────────────────────────────
    if (parsed.receipt !== null) {
      const ack = acknowledge(ledger, parsed.receipt, now);
      if (ack.outcome === "delivered") {
        ledger = ack.ledger;
        delivered.push((parsed.receipt as Receipt).message_id);
      } else if (ack.outcome === "refused") {
        // Not an error of ours in the common case: a receipt for a message this endpoint never sent is
        // simply another party's traffic in a shared channel.
        const id = (parsed.receipt as { message_id?: unknown }).message_id;
        if (typeof id === "string" && Object.prototype.hasOwnProperty.call(ledger, id)) {
          errors.push(`receipt for ${id} refused: ${ack.errors.join("; ")}`);
        }
      }
      continue;
    }

    // ── a message ───────────────────────────────────────────────────────────────────────────────
    if (parsed.message === null || parsed.body === null) continue;
    const envelope = parsed.message as Message;
    if (envelope.to !== cfg.me) continue; // addressed to somebody else; not ours to acknowledge
    if (envelope.from === cfg.me) continue; // our own message echoed back; the sender never acks itself

    const got = receive(ledger, envelope, now);
    if (got.outcome === "rejected") {
      errors.push(`message in comment ${comment.id} rejected: ${got.errors.join("; ")}`);
      continue;
    }
    if (got.outcome === "conflict") {
      conflicts.push(envelope.id);
      continue;
    }
    if (got.outcome === "duplicate") {
      // THE DUPLICATE SUPPRESSION POINT. A re-posted message changes nothing and is NOT acknowledged a
      // second time: the first receipt already stands, and a second would suggest two deliveries.
      duplicates.push(envelope.id);
      continue;
    }

    ledger = got.ledger;
    accepted.push(envelope.id);

    const receipt: Receipt = {
      schema: RECEIPT_SCHEMA,
      message_id: envelope.id,
      body_sha256: envelope.body_sha256,
      received_by: cfg.me,
      received_at: iso(now),
    };
    try {
      await transport.post(formatReceiptComment(receipt));
      receiptsPosted.push(envelope.id);
      const self = acknowledge(ledger, receipt, now);
      if (self.outcome === "delivered") ledger = self.ledger;
    } catch (err) {
      errors.push(`could not post receipt for ${envelope.id}: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (cfg.autoRespond !== null) {
      // PERSISTED BEFORE RESPONDING, and this ordering is load-bearing. `send` loads the ledger from DISK,
      // adds its own entry and saves; so if this cycle's accepted message and its receipt were still only
      // in memory, `send`'s write would not contain them and the reload below would discard them.
      //
      // That was a real defect, and it had two symptoms from one cause: the recipient's ledger ended up
      // with no record of the inbound message, and — because `receive` therefore found nothing — a
      // re-posted message was acknowledged a SECOND time, defeating duplicate suppression entirely. The
      // fake-transport tests missed it because they asserted the report rather than the recipient's own
      // ledger; the two-process run over a real issue caught both.
      saveLedger(cfg.ledgerPath, ledger);
      const reply = await send(cfg, transport, envelope.from, cfg.autoRespond, now, { inReplyTo: envelope.id, salt: envelope.id });
      if (reply.commentId !== null) responsesPosted.push(reply.message.id);
      else errors.push(`could not post response to ${envelope.id}: ${reply.outcome}`);
      // `send` wrote on top of what we just persisted, so re-read rather than overwrite it with a stale copy.
      ledger = loadLedger(cfg.ledgerPath, now);
    }
  }

  saveLedger(cfg.ledgerPath, ledger);

  // ── overdue and failed, after inbound ───────────────────────────────────────────────────────────
  //
  // THIS PASS REPORTS; IT DOES NOT RE-SEND, and that is forced by the record rather than chosen. `Entry`
  // stores the envelope and the body HASH — `bridge.ts` deliberately keeps the body out of the record — so
  // nothing reading the ledger alone can reconstruct a message to post. Re-sending therefore belongs to
  // `resend`, which the sender calls with the body it still holds. The alternative, storing bodies in the
  // ledger, would quietly turn a delivery log into a content store.
  //
  // A FAILURE IS WRITTEN DOWN, because the whole point of the bounded schedule is that giving up is a
  // visible state rather than silence.
  let withFailures = ledger;
  for (const { id } of undelivered(ledger, now)) {
    const entry = settle(ledger[id]!, now);
    const action = nextAction(entry, now, cfg.retry);
    if (action.action === "send") {
      retried.push(id);
    } else if (action.action === "none" && action.reason === "failed" && entry.state !== "failed") {
      // `recordAttempt` already flips an entry to `failed` once the attempts are spent; this catches the
      // defence-in-depth case `bridge.ts` tests for — an entry stored as pending whose attempts are maxed.
      withFailures = Object.freeze({ ...withFailures, [id]: Object.freeze({ ...entry, state: "failed" as const }) });
      failed.push(id);
    }
  }
  if (withFailures !== ledger) saveLedger(cfg.ledgerPath, withFailures);

  saveCursor(cfg.cursorPath, { lastCommentId: maxId, lastCreatedAt: maxCreated, etag: poll.etag });
  return {
    unchanged: poll.unchanged,
    commentsSeen: fresh.length,
    accepted,
    duplicates,
    conflicts,
    receiptsPosted,
    responsesPosted,
    delivered,
    retried,
    failed,
    errors,
  };
}

/**
 * Re-post a message that was never acknowledged, with the body the caller still holds.
 *
 * SEPARATE FROM `runCycle` BECAUSE THE LEDGER DOES NOT STORE BODIES. `Entry` keeps the envelope and the
 * hash, by design — so nothing reading the ledger alone can reconstruct a message to send. A sender that
 * wants retries must keep its own bodies, which is honest: the alternative would be storing message bodies
 * in the ledger and quietly making it a content store.
 */
export async function resend(
  cfg: EndpointConfig,
  transport: Transport,
  message: Message,
  body: string,
  now: Date,
): Promise<{ sent: boolean; state: string; attempts: number }> {
  const ledger = loadLedger(cfg.ledgerPath, now);
  const stored = Object.prototype.hasOwnProperty.call(ledger, message.id) ? ledger[message.id] : undefined;
  if (stored === undefined) return { sent: false, state: "unknown", attempts: 0 };
  const entry = settle(stored, now);
  const action = nextAction(entry, now, cfg.retry);
  if (action.action !== "send") {
    // `none/failed` is the schedule saying it has given up. Written down, because a bounded schedule whose
    // exhaustion is not recorded is indistinguishable from one that silently stopped trying.
    if (action.action === "none" && action.reason === "failed" && entry.state !== "failed") {
      saveLedger(cfg.ledgerPath, Object.freeze({ ...ledger, [message.id]: Object.freeze({ ...entry, state: "failed" as const }) }));
      return { sent: false, state: "failed", attempts: entry.attempts };
    }
    return { sent: false, state: action.action === "none" ? action.reason : entry.state, attempts: entry.attempts };
  }
  if (bodyHash(body) !== entry.message.body_sha256) {
    return { sent: false, state: entry.state, attempts: entry.attempts };
  }
  await transport.post(formatMessageComment(entry.message, body));
  const next = recordAttempt(ledger, message.id, now, cfg.retry);
  saveLedger(cfg.ledgerPath, next);
  return { sent: true, state: next[message.id]!.state, attempts: next[message.id]!.attempts };
}

// THE RUNNABLE EDGE LIVES IN `bridge-endpoint.ts`, AND THAT SPLIT WAS FORCED BY A REAL FAILURE.
//
// This file first ended with a `main()` behind an `invokedDirectly` guard that tested
// `/endpoint\.ts$/.test(process.argv[1])`. Under `vite-node` — which is how every script in this
// repository runs — `process.argv[1]` is the vite-node BINARY and the script path is consumed entirely, so
// the guard was always false and `main()` never ran. The endpoint exited 0 in silence, and the end-to-end
// test timed out having seen zero comments: two processes were started and neither did anything.
//
// A conditional self-invocation was the wrong shape anyway. The repository had already settled this with
// `ciStatus.ts` (importable) beside `ci-status.ts` (the command): the module holds the logic and no side
// effects, the command holds argv, the real transport, the sleep and the exit code. That keeps BOTH halves
// of *a command whose claims cannot be imported cannot be falsified* — the claims are importable here, and
// importing this file runs nothing.

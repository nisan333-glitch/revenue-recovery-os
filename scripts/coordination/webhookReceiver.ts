// The inbound WEBHOOK receiver · an HTTP route into the bridge.
//
// THERE ARE TWO RECEIVERS IN THIS DIRECTORY AND THEY ARE NOT DUPLICATES. `receiver.ts` is a GitHub
// ACTIONS receiver: an `issue_comment` event starts a workflow run which replays the issue's comments
// through the delivery core. This one is an HTTP server that accepts GitHub WEBHOOK deliveries directly.
// Same goal, different mechanism, and — importantly — DIFFERENT BLOCKERS:
//
//   · the Actions receiver needs to sit on the DEFAULT BRANCH before `issue_comment` will start it, so it
//     is dormant until an owner merges it;
//   · this one needs a PUBLICLY REACHABLE URL, which nothing in this repository can provide;
//   · the polling endpoint (`endpoint.ts`) needs neither, which is why it is what moves messages today.
//
// THEY ALSO READ DIFFERENT WIRE FORMATS, which is a protocol conflict an owner must settle and which is
// proved rather than asserted in `wireFormatConflict.test.ts`. Do not assume one can read the other's
// messages: it cannot.
//
// WHAT IT IS. An HTTP server that accepts GitHub `issue_comment` webhook deliveries, verifies that each
// one really came from GitHub, and appends the coordination records it carries to a durable inbox file an
// endpoint can consume. With this running and a webhook pointed at it, a comment reaches the other party in
// the time one HTTP request takes, instead of at the next poll.
//
// THE DEPENDENCY THIS CANNOT SATISFY BY ITSELF, stated here rather than in a footnote. GitHub delivers
// webhooks by making an outbound request to a PUBLICLY REACHABLE URL. This process listens on a local
// port; nothing in this repository can give it a public address. So the receiver is complete and tested,
// and *wiring GitHub to it* needs an owner action — a reachable host and a webhook created with a secret.
// Until then the polling path in `githubChannel.ts` is what actually moves messages, which is why that
// path exists and is the one the end-to-end test uses.
//
// AND IT IS STILL NOT A WAY TO WAKE ChatGPT. A receiver running on ChatGPT's behalf is a service we would
// operate; it is not a ChatGPT conversation. GitHub cannot wake an inactive conversation, and a delivery
// accepted here proves a payload arrived at this process — nothing more.
//
// THE HANDLER IS EXPORTED AND THE SERVER IS NOT MUCH. `handleDelivery` takes the raw body, the headers and
// the state, so every claim — signature refused, replay refused, records extracted, inbox appended — is
// reachable from a test without binding a port.
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";

import {
  DELIVERY_HEADER,
  DeliveryWindow,
  EVENT_HEADER,
  admitDelivery,
  statusFor,
} from "./webhookAuth.ts";
import type { AuthFailure } from "./webhookAuth.ts";
import { parseComment } from "./wire.ts";

/** The only event this receiver acts on. Anything else is accepted and ignored, never rejected. */
export const HANDLED_EVENT = "issue_comment";
/** A body larger than this is refused unread: an unbounded read is a denial-of-service against ourselves. */
export const MAX_DELIVERY_BYTES = 2 * 1024 * 1024;

export interface InboxLine {
  received_at: string;
  delivery_id: string;
  comment_id: number | null;
  issue: number | null;
  /** The records the comment carried, if any. Absent when the comment was prose. */
  message: unknown | null;
  body: string | null;
  receipt: unknown | null;
  /** Why nothing was extracted, when that is the case. */
  errors: string[];
}

export interface DeliveryOutcome {
  readonly status: number;
  /** A closed set, so a caller branches on it rather than parsing prose. */
  readonly result: "accepted" | "ignored_event" | "no_records" | AuthFailure | "too_large" | "unparsable";
  /** Appended to the inbox when records were present. */
  readonly line: InboxLine | null;
}

/**
 * Decide what to do with one delivery.
 *
 * NOTHING ABOUT THE BODY IS TRUSTED BEFORE THE SIGNATURE, which is why `admitDelivery` runs before the
 * JSON is even parsed. Parsing first would mean doing work — and potentially logging a shape — on behalf of
 * an unauthenticated caller.
 */
export function handleDelivery(
  secret: string,
  rawBody: string,
  headers: Readonly<Record<string, unknown>>,
  window: DeliveryWindow,
  now: Date,
): DeliveryOutcome {
  if (Buffer.byteLength(rawBody, "utf8") > MAX_DELIVERY_BYTES) {
    return { status: 413, result: "too_large", line: null };
  }
  const admitted = admitDelivery(secret, rawBody, headers, window);
  if (!admitted.ok) {
    return { status: statusFor(admitted.failure!), result: admitted.failure!, line: null };
  }
  const event = headers[EVENT_HEADER];
  if (event !== HANDLED_EVENT) {
    // A 200 and not a 4xx: the delivery was genuine and correctly handled by being ignored. Telling GitHub
    // it failed would make it retry an event we will never want.
    return { status: 200, result: "ignored_event", line: null };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody) as unknown;
  } catch {
    return { status: 400, result: "unparsable", line: null };
  }
  const p = payload as { comment?: { id?: unknown; body?: unknown }; issue?: { number?: unknown } } | null;
  const commentBody = typeof p?.comment?.body === "string" ? p.comment.body : null;
  if (commentBody === null) return { status: 400, result: "unparsable", line: null };

  const parsed = parseComment(commentBody);
  const line: InboxLine = {
    received_at: now.toISOString().replace(/\.\d{3}Z$/, ".000Z"),
    delivery_id: admitted.deliveryId!,
    comment_id: typeof p?.comment?.id === "number" ? p.comment.id : null,
    issue: typeof p?.issue?.number === "number" ? p.issue.number : null,
    message: parsed.message,
    body: parsed.body,
    receipt: parsed.receipt,
    errors: parsed.errors,
  };
  if (parsed.message === null && parsed.receipt === null && parsed.errors.length === 0) {
    // Ordinary prose in the channel. Accepted, and deliberately not queued: an inbox full of human
    // comments would bury the records an endpoint is looking for.
    return { status: 200, result: "no_records", line: null };
  }
  return { status: 202, result: "accepted", line };
}

/** Append one line to the durable inbox. Line-delimited JSON, so a crash truncates at most one record. */
export function appendInbox(path: string, line: InboxLine): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(line)}\n`, "utf8");
}

/**
 * Read the inbox back.
 *
 * A TRUNCATED LAST LINE IS SKIPPED, NOT FATAL. Append-only line-delimited JSON can only ever be damaged at
 * the end, by a crash mid-append; refusing the whole file for that would discard every record before it.
 * This is the opposite choice from the ledger, and for the opposite reason: the inbox is a queue of things
 * to look at, and the channel can be re-read, whereas the ledger is the evidence of what was delivered.
 */
export function readInbox(path: string): { lines: InboxLine[]; skipped: number } {
  if (!existsSync(path)) return { lines: [], skipped: 0 };
  const lines: InboxLine[] = [];
  let skipped = 0;
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    if (raw.trim() === "") continue;
    try {
      lines.push(JSON.parse(raw) as InboxLine);
    } catch {
      skipped += 1;
    }
  }
  return { lines, skipped };
}

export interface ReceiverOptions {
  readonly secret: string;
  readonly inboxPath: string;
  readonly path: string;
  readonly now?: () => Date;
}

/**
 * Start the receiver.
 *
 * THE SECRET IS NEVER LOGGED AND NEVER ECHOED. It enters once, as `options.secret`, read by the caller from
 * the environment; nothing here prints it, returns it or includes it in a response. Responses carry a
 * status and a one-word result, so a probing caller learns whether it was authenticated and nothing about
 * why beyond that.
 */
export function startReceiver(options: ReceiverOptions): Server {
  const window = new DeliveryWindow();
  const now = options.now ?? ((): Date => new Date());

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "POST" || (req.url ?? "/") !== options.path) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ result: "not_found" }));
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let aborted = false;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_DELIVERY_BYTES) {
        // Stop reading rather than buffering an unbounded body.
        aborted = true;
        res.writeHead(413, { "content-type": "application/json" });
        res.end(JSON.stringify({ result: "too_large" }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (aborted) return;
      const raw = Buffer.concat(chunks).toString("utf8");
      const headers = req.headers as unknown as Record<string, unknown>;
      let outcome: DeliveryOutcome;
      try {
        outcome = handleDelivery(options.secret, raw, headers, window, now());
      } catch (err) {
        // Our own failure is reported as ours: a 500 with no detail, and the detail on our stderr. Telling
        // the caller its request was bad when the fault is ours is the mistake this repository records as
        // the `NH-AX-1009` shape.
        console.error(`receiver: internal failure handling a delivery — ${err instanceof Error ? err.message : String(err)}`);
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ result: "internal_error" }));
        return;
      }
      if (outcome.line !== null) {
        try {
          appendInbox(options.inboxPath, outcome.line);
        } catch (err) {
          console.error(`receiver: could not append to the inbox — ${err instanceof Error ? err.message : String(err)}`);
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ result: "inbox_unavailable" }));
          return;
        }
      }
      res.writeHead(outcome.status, { "content-type": "application/json" });
      res.end(JSON.stringify({ result: outcome.result, delivery: headers[DELIVERY_HEADER] ?? null }));
    });
  });
  return server;
}

// THE RUNNABLE EDGE LIVES IN `bridge-webhook-receiver.ts`, for the reason recorded in `endpoint.ts`: under
// vite-node a self-invocation guard on `process.argv[1]` never fires, and a module that starts a server on
// import cannot be tested. `startReceiver` binds nothing until a caller calls `listen`.

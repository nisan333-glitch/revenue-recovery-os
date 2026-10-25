// Delivery core for the NH coordination bridge · step 1 of docs/NH_COORDINATION_PROTOCOL_V1.md "Phase 4".
//
// WHAT THIS IS. The pure rules of a message -> receipt -> response exchange: a closed message record, a closed
// receipt record, idempotent receive, a bounded retry schedule, and failure that is a visible state instead of
// silence. Everything is a function of its inputs and of `now`; it reads no clock, no file and no network.
//
// WHAT THIS IS NOT. It is not a running bridge. Nothing here sends, listens or stores. Delivering anything
// needs a receiver (a workflow with a write permission, or a service), which are owner gates that have not
// been granted. A receipt proves a message reached the RECIPIENT'S SIDE of the ledger; it cannot prove that
// ChatGPT read it, because ChatGPT cannot be pushed to and runs only when a user turn happens.
//
// The standing rule from the Trust Invariant applies to the exchange itself: the party that sent a message
// can never be the party that acknowledges it.

export const MSG_SCHEMA = "nh-msg/v1";
export const RECEIPT_SCHEMA = "nh-receipt/v1";

export const PARTIES = ["claude-code", "chatgpt", "owner"] as const;
export type Party = (typeof PARTIES)[number];

export type DeliveryState = "pending" | "delivered" | "failed" | "expired";

export interface Message {
  schema: typeof MSG_SCHEMA;
  id: string;
  from: Party;
  to: Party;
  in_reply_to: string | null;
  /** SHA-256 of the message body, lowercase hex. The body itself is not part of the record. */
  body_sha256: string;
  created_at: string;
  expires_at: string;
}

export interface Receipt {
  schema: typeof RECEIPT_SCHEMA;
  message_id: string;
  body_sha256: string;
  received_by: Party;
  received_at: string;
}

export interface RetryPolicy {
  maxAttempts: number;
  baseSeconds: number;
  capSeconds: number;
}

export const DEFAULT_RETRY: Readonly<RetryPolicy> = Object.freeze({ maxAttempts: 5, baseSeconds: 60, capSeconds: 3600 });
export const MAX_TTL_SECONDS = 7 * 24 * 3600;

export interface Entry {
  message: Message;
  state: DeliveryState;
  /** Delivery attempts made so far. */
  attempts: number;
  /** ISO time of the last attempt, or null. */
  lastAttemptAt: string | null;
  receipt: Receipt | null;
}

/** An immutable ledger: id -> entry. Every function returns a new one. */
export type Ledger = Readonly<Record<string, Entry>>;

const ID_RE = /^[a-z0-9][a-z0-9._-]{2,63}$/;
const HEX64_RE = /^[0-9a-f]{64}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const MSG_KEYS = ["schema", "id", "from", "to", "in_reply_to", "body_sha256", "created_at", "expires_at"] as const;
const RECEIPT_KEYS = ["schema", "message_id", "body_sha256", "received_by", "received_at"] as const;

export interface Validation<T> {
  ok: boolean;
  errors: string[];
  value: T | null;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function timeOf(s: unknown): number | null {
  if (typeof s !== "string" || !ISO_RE.test(s)) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

function closedKeys(obj: Record<string, unknown>, allowed: readonly string[], errors: string[]): void {
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) errors.push(`unknown field '${k}'`);
  for (const k of allowed) if (!(k in obj)) errors.push(`missing field '${k}'`);
}

const isParty = (x: unknown): x is Party => typeof x === "string" && (PARTIES as readonly string[]).includes(x);

export function validateMessage(input: unknown, now: Date): Validation<Message> {
  const errors: string[] = [];
  if (!isRecord(input)) return { ok: false, errors: ["message is not an object"], value: null };
  closedKeys(input, MSG_KEYS, errors);
  if (input.schema !== MSG_SCHEMA) errors.push(`schema must be '${MSG_SCHEMA}'`);
  if (typeof input.id !== "string" || !ID_RE.test(input.id)) errors.push("id is malformed");
  if (!isParty(input.from)) errors.push("from is not a known party");
  if (!isParty(input.to)) errors.push("to is not a known party");
  if (isParty(input.from) && input.from === input.to) errors.push("a party cannot send a message to itself");
  if (input.in_reply_to !== null && (typeof input.in_reply_to !== "string" || !ID_RE.test(input.in_reply_to))) {
    errors.push("in_reply_to must be null or a message id");
  }
  if (typeof input.in_reply_to === "string" && input.in_reply_to === input.id) errors.push("a message cannot reply to itself");
  if (typeof input.body_sha256 !== "string" || !HEX64_RE.test(input.body_sha256)) errors.push("body_sha256 is not 64 lowercase hex characters");
  const created = timeOf(input.created_at);
  const expires = timeOf(input.expires_at);
  if (created === null) errors.push("created_at is not an ISO-8601 UTC time");
  if (expires === null) errors.push("expires_at is not an ISO-8601 UTC time");
  if (created !== null && created > now.getTime()) errors.push("created_at is in the future");
  if (created !== null && expires !== null) {
    if (expires <= created) errors.push("expires_at must be after created_at");
    else if ((expires - created) / 1000 > MAX_TTL_SECONDS) errors.push("lifetime exceeds the 7-day maximum");
  }
  return errors.length === 0
    ? { ok: true, errors, value: Object.freeze({ ...(input as unknown as Message) }) }
    : { ok: false, errors, value: null };
}

export function validateReceipt(input: unknown, now: Date): Validation<Receipt> {
  const errors: string[] = [];
  if (!isRecord(input)) return { ok: false, errors: ["receipt is not an object"], value: null };
  closedKeys(input, RECEIPT_KEYS, errors);
  if (input.schema !== RECEIPT_SCHEMA) errors.push(`schema must be '${RECEIPT_SCHEMA}'`);
  if (typeof input.message_id !== "string" || !ID_RE.test(input.message_id)) errors.push("message_id is malformed");
  if (typeof input.body_sha256 !== "string" || !HEX64_RE.test(input.body_sha256)) errors.push("body_sha256 is not 64 lowercase hex characters");
  if (!isParty(input.received_by)) errors.push("received_by is not a known party");
  const at = timeOf(input.received_at);
  if (at === null) errors.push("received_at is not an ISO-8601 UTC time");
  else if (at > now.getTime()) errors.push("received_at is in the future");
  return errors.length === 0
    ? { ok: true, errors, value: Object.freeze({ ...(input as unknown as Receipt) }) }
    : { ok: false, errors, value: null };
}

export type ReceiveOutcome = "accepted" | "duplicate" | "conflict" | "rejected";

export interface ReceiveResult {
  ledger: Ledger;
  outcome: ReceiveOutcome;
  errors: string[];
}

/**
 * Record a message. Idempotent: the same id with the same body hash changes nothing and reports `duplicate`;
 * the same id with a different body hash is a `conflict` and changes nothing, because a message whose content
 * can be swapped under a stable id would make every later receipt meaningless.
 */
export function receive(ledger: Ledger, input: unknown, now: Date): ReceiveResult {
  const v = validateMessage(input, now);
  if (!v.ok || v.value === null) return { ledger, outcome: "rejected", errors: v.errors };
  const msg = v.value;
  if (now.getTime() >= Date.parse(msg.expires_at)) {
    return { ledger, outcome: "rejected", errors: ["message is already expired"] };
  }
  const existing = Object.prototype.hasOwnProperty.call(ledger, msg.id) ? ledger[msg.id] : undefined;
  if (existing !== undefined) {
    if (existing.message.body_sha256 === msg.body_sha256 && existing.message.from === msg.from && existing.message.to === msg.to) {
      return { ledger, outcome: "duplicate", errors: [] };
    }
    return { ledger, outcome: "conflict", errors: [`id '${msg.id}' already exists with different content`] };
  }
  const entry: Entry = Object.freeze({ message: msg, state: "pending", attempts: 0, lastAttemptAt: null, receipt: null });
  return { ledger: Object.freeze({ ...ledger, [msg.id]: entry }), outcome: "accepted", errors: [] };
}

export type AckOutcome = "delivered" | "already_delivered" | "refused";

export interface AckResult {
  ledger: Ledger;
  outcome: AckOutcome;
  errors: string[];
}

/**
 * Record a receipt. Refused unless it comes from the addressee (never the sender), names a known message,
 * carries that message's body hash, and the message is still pending. Terminal states stay terminal: a late
 * receipt does not resurrect a failed or expired message, it is refused and the state says why delivery failed.
 */
export function acknowledge(ledger: Ledger, input: unknown, now: Date): AckResult {
  const v = validateReceipt(input, now);
  if (!v.ok || v.value === null) return { ledger, outcome: "refused", errors: v.errors };
  const r = v.value;
  const entry = Object.prototype.hasOwnProperty.call(ledger, r.message_id) ? ledger[r.message_id] : undefined;
  if (entry === undefined) return { ledger, outcome: "refused", errors: ["receipt names an unknown message"] };
  if (r.received_by === entry.message.from) {
    return { ledger, outcome: "refused", errors: ["the sender cannot acknowledge its own message"] };
  }
  if (r.received_by !== entry.message.to) return { ledger, outcome: "refused", errors: ["receipt is not from the addressee"] };
  if (r.body_sha256 !== entry.message.body_sha256) return { ledger, outcome: "refused", errors: ["receipt body hash does not match the message"] };
  if (entry.state === "delivered") return { ledger, outcome: "already_delivered", errors: [] };
  const settled = settle(entry, now);
  if (settled.state !== "pending") return { ledger, outcome: "refused", errors: [`message is ${settled.state}; a late receipt does not change it`] };
  if (Date.parse(r.received_at) < Date.parse(entry.message.created_at)) {
    return { ledger, outcome: "refused", errors: ["receipt predates the message"] };
  }
  const next: Entry = Object.freeze({ ...entry, state: "delivered", receipt: r });
  return { ledger: Object.freeze({ ...ledger, [r.message_id]: next }), outcome: "delivered", errors: [] };
}

/** An entry as it stands at `now`: a pending message past its expiry is `expired`, whatever was last stored. */
export function settle(entry: Entry, now: Date): Entry {
  if (entry.state === "pending" && now.getTime() >= Date.parse(entry.message.expires_at)) {
    return Object.freeze({ ...entry, state: "expired" });
  }
  return entry;
}

export type NextAction =
  | { action: "send"; attempt: number }
  | { action: "wait"; until: string }
  | { action: "none"; reason: DeliveryState };

/** Seconds to wait after attempt `n` (1-based) before attempt n+1. Exponential, capped. */
export function backoffSeconds(n: number, p: RetryPolicy = DEFAULT_RETRY): number {
  const raw = p.baseSeconds * 2 ** Math.max(0, n - 1);
  return Math.min(raw, p.capSeconds);
}

/**
 * What a sender should do next with a pending message. Pure: it neither sends nor records. After the maximum
 * number of attempts the answer is `none/failed`, which is a state a reader can see, not a message that
 * quietly stops being retried.
 */
export function nextAction(entry: Entry, now: Date, p: RetryPolicy = DEFAULT_RETRY): NextAction {
  const e = settle(entry, now);
  if (e.state !== "pending") return { action: "none", reason: e.state };
  if (e.attempts >= p.maxAttempts) return { action: "none", reason: "failed" };
  if (e.lastAttemptAt === null) return { action: "send", attempt: 1 };
  const due = Date.parse(e.lastAttemptAt) + backoffSeconds(e.attempts, p) * 1000;
  if (now.getTime() < due) return { action: "wait", until: new Date(due).toISOString() };
  return { action: "send", attempt: e.attempts + 1 };
}

/** Record that an attempt was made at `now`. Marks the entry `failed` once the attempts are used up. */
export function recordAttempt(ledger: Ledger, id: string, now: Date, p: RetryPolicy = DEFAULT_RETRY): Ledger {
  const entry = Object.prototype.hasOwnProperty.call(ledger, id) ? ledger[id] : undefined;
  if (entry === undefined || settle(entry, now).state !== "pending") return ledger;
  const attempts = entry.attempts + 1;
  const next: Entry = Object.freeze({
    ...entry,
    attempts,
    lastAttemptAt: now.toISOString(),
    state: attempts >= p.maxAttempts ? "failed" : "pending",
  });
  return Object.freeze({ ...ledger, [id]: next });
}

/** Messages a human should look at: anything that did not reach `delivered`, with the reason in plain terms. */
export function undelivered(ledger: Ledger, now: Date): Array<{ id: string; state: DeliveryState; attempts: number }> {
  return Object.values(ledger)
    .map((e) => settle(e, now))
    .filter((e) => e.state !== "delivered")
    .map((e) => ({ id: e.message.id, state: e.state, attempts: e.attempts }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

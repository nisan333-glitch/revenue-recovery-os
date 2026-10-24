// Wire format for the coordination bridge · step 2 of docs/NH_COORDINATION_PROTOCOL_V1.md "Phase 4".
//
// WHAT THIS IS. The translation between a `bridge.ts` record and the text of a GitHub issue comment. A
// comment is the transport, so this module decides exactly what a comment must look like for a message or a
// receipt to be carried by it, and refuses anything it cannot read unambiguously.
//
// WHY THE BODY IS A SEPARATE BLOCK. `Message` carries `body_sha256` and deliberately NOT the body — see
// `bridge.ts`. So the envelope alone cannot be delivered to anyone: a recipient would receive a hash of a
// thing it never got. The comment therefore carries two fenced blocks, the envelope and the body, and this
// module RECOMPUTES the hash and refuses the pair when they disagree. That check is the whole reason the
// split is safe: the envelope's hash is what every receipt in `bridge.ts` is matched against, so a body
// that does not hash to it would make the receipt attest to content nobody sent.
//
// PURE. No clock, no filesystem, no network. `node:crypto` is used for SHA-256 only, which is a pure
// function of its input; the structural test asserts there is no `fetch`, no `node:http`, no
// `child_process` and no filesystem import here.
//
// FAIL CLOSED ON AMBIGUITY, and this is the rule that matters most. A comment carrying two envelopes is
// REFUSED rather than resolved by taking the first: "the first one wins" would let anyone who can comment
// change which message a later receipt appears to acknowledge, by prepending a block. That is the
// beneficiary-determines-the-number shape, one lane over — so there is no first-wins rule anywhere here.
import { createHash } from "node:crypto";

import { MSG_SCHEMA, RECEIPT_SCHEMA } from "./bridge.ts";
import type { Message, Receipt } from "./bridge.ts";

/** The info-string of each fenced block. Deliberately distinct from `nh-status`, which is another record. */
export const MSG_FENCE = "nh-msg";
export const BODY_FENCE = "nh-body";
export const RECEIPT_FENCE = "nh-receipt";

/** A body may not be unbounded: a GitHub comment is capped, and an oversized body cannot be delivered. */
export const MAX_BODY_BYTES = 48 * 1024;

/** SHA-256 of a body, lowercase hex — the one definition, so sender and receiver cannot compute it apart. */
export function bodyHash(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

export interface ParsedComment {
  /** The envelope, when exactly one well-formed `nh-msg` block was present. */
  message: unknown | null;
  /** The body text that accompanied it, verbatim. */
  body: string | null;
  /** The receipt, when exactly one well-formed `nh-receipt` block was present. */
  receipt: unknown | null;
  /** Why this comment carries nothing, or carries something unusable. Empty when it is clean. */
  errors: string[];
}

/**
 * The longest run of backticks anywhere in `text`.
 *
 * NEEDED FOR CORRECTNESS, NOT TIDINESS. A body containing ``` would terminate its own fence, and the
 * envelope would then describe a body that was truncated at that line — a hash mismatch at best, and at
 * worst a body an attacker chose. CommonMark's rule is that a fence is closed only by a run at least as
 * long as the one that opened it, so the opening run is chosen longer than anything inside.
 */
function longestBacktickRun(text: string): number {
  let longest = 0;
  for (const m of text.matchAll(/`+/g)) longest = Math.max(longest, m[0].length);
  return longest;
}

function fence(info: string, content: string): string {
  const ticks = "`".repeat(Math.max(3, longestBacktickRun(content) + 1));
  return `${ticks}${info}\n${content}\n${ticks}`;
}

/**
 * Render a message and its body as the text of one comment.
 *
 * Throws rather than returning an error, because every caller here is constructing its OWN message from
 * values it just created: a failure is a bug in the sender, not untrusted input, and a sender that quietly
 * emitted a comment whose body does not match its envelope would poison the ledger of the recipient.
 */
export function formatMessageComment(message: Message, body: string): string {
  if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) {
    throw new Error(`message body exceeds ${MAX_BODY_BYTES} bytes and cannot be carried in a comment`);
  }
  const computed = bodyHash(body);
  if (computed !== message.body_sha256) {
    throw new Error(`refusing to format: body hashes to ${computed}, envelope declares ${message.body_sha256}`);
  }
  return [
    `<!-- ${MSG_FENCE} ${message.id} -->`,
    fence(MSG_FENCE, JSON.stringify(message, null, 2)),
    fence(BODY_FENCE, body),
  ].join("\n\n");
}

/** Render a receipt as the text of one comment. */
export function formatReceiptComment(receipt: Receipt): string {
  return [
    `<!-- ${RECEIPT_FENCE} ${receipt.message_id} -->`,
    fence(RECEIPT_FENCE, JSON.stringify(receipt, null, 2)),
  ].join("\n\n");
}

/**
 * Every fenced block in `text` whose info-string is exactly `info`.
 *
 * The closing run must be at least as long as the opening one, which is what makes `formatMessageComment`'s
 * variable-length fence readable again. Indented fences are not accepted: GitHub renders them, but allowing
 * them would mean the same bytes parse differently depending on surrounding list nesting.
 */
function blocks(text: string, info: string): string[] {
  const out: string[] = [];
  const re = new RegExp(String.raw`^(\x60{3,})${info}[ \t]*\r?\n([\s\S]*?)\r?\n\1\x60*[ \t]*$`, "gm");
  for (const m of text.matchAll(re)) out.push(m[2] ?? "");
  return out;
}

function parseJsonBlock(raw: string, label: string, errors: string[]): unknown | null {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    errors.push(`${label} block is not valid JSON`);
    return null;
  }
}

/**
 * Read whatever coordination records a comment carries.
 *
 * Returns `errors` rather than throwing, because the input is a comment anyone with write access can
 * author: a malformed one is ordinary traffic to be reported and skipped, never a crash of the endpoint
 * reading the channel.
 *
 * A comment carrying NEITHER kind of block is not an error — most comments in a channel are prose, and
 * reporting each as a failure would bury the real ones.
 */
export function parseComment(text: string): ParsedComment {
  const errors: string[] = [];
  const msgBlocks = blocks(text, MSG_FENCE);
  const bodyBlocks = blocks(text, BODY_FENCE);
  const receiptBlocks = blocks(text, RECEIPT_FENCE);

  // AMBIGUITY IS REFUSED, NEVER RESOLVED. See the header: a first-wins rule would let a later block decide
  // which message a receipt appears to acknowledge.
  if (msgBlocks.length > 1) errors.push(`comment carries ${msgBlocks.length} ${MSG_FENCE} blocks; exactly one is readable`);
  if (bodyBlocks.length > 1) errors.push(`comment carries ${bodyBlocks.length} ${BODY_FENCE} blocks; exactly one is readable`);
  if (receiptBlocks.length > 1) errors.push(`comment carries ${receiptBlocks.length} ${RECEIPT_FENCE} blocks; exactly one is readable`);
  // A message and a receipt in one comment cannot be ordered against each other, and the ledger needs an
  // order: the receipt would be applied either before or after the message it may itself concern.
  if (msgBlocks.length > 0 && receiptBlocks.length > 0) {
    errors.push("comment carries both a message and a receipt; they must be separate comments");
  }
  if (errors.length > 0) return { message: null, body: null, receipt: null, errors };

  let message: unknown | null = null;
  let body: string | null = null;
  if (msgBlocks.length === 1) {
    if (bodyBlocks.length !== 1) {
      errors.push(`a ${MSG_FENCE} block must be accompanied by exactly one ${BODY_FENCE} block`);
      return { message: null, body: null, receipt: null, errors };
    }
    message = parseJsonBlock(msgBlocks[0]!, MSG_FENCE, errors);
    body = bodyBlocks[0]!;
    // THE INTEGRITY CHECK the two-block split exists to make possible.
    const declared = typeof (message as { body_sha256?: unknown })?.body_sha256 === "string"
      ? (message as { body_sha256: string }).body_sha256
      : null;
    if (message !== null && declared !== null && bodyHash(body) !== declared) {
      errors.push("body does not hash to the envelope's body_sha256");
    }
    if (typeof (message as { schema?: unknown })?.schema === "string" && (message as { schema: string }).schema !== MSG_SCHEMA) {
      errors.push(`envelope schema is not '${MSG_SCHEMA}'`);
    }
  } else if (bodyBlocks.length === 1) {
    // A body with no envelope is unusable and must be said so: it has no id, so it can never be acked.
    errors.push(`a ${BODY_FENCE} block appeared without an ${MSG_FENCE} envelope`);
  }

  let receipt: unknown | null = null;
  if (receiptBlocks.length === 1) {
    receipt = parseJsonBlock(receiptBlocks[0]!, RECEIPT_FENCE, errors);
    if (typeof (receipt as { schema?: unknown })?.schema === "string" && (receipt as { schema: string }).schema !== RECEIPT_SCHEMA) {
      errors.push(`receipt schema is not '${RECEIPT_SCHEMA}'`);
    }
  }

  if (errors.length > 0) return { message: null, body: null, receipt: null, errors };
  return { message, body, receipt, errors };
}

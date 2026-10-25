// THE FORMER WIRE-FORMAT CONFLICT, NOW RESOLVED — AND THE RESOLUTION IS PINNED.
//
// Two receivers once disagreed about where a message's BODY lives: `receiver.ts` read it as the surrounding
// comment text, `wire.ts` as a second fenced block, ```nh-body. They computed `body_sha256` over different
// text, so each refused the other's messages. The owner approved one canonical format on 2026-10-25: the
// ENVELOPE (`nh-msg`) and the CONTENT (`nh-body`) are separate, and `wire.ts` is the single reader.
//
// This file replaces `wireFormatConflict.test.ts`, which proved the incompatibility. What it pins now:
//   1. what the Actions receiver and the polling endpoint each produce is read identically by both;
//   2. the retired text-as-body form is refused by BOTH, and the receiver's answer says what to do instead;
//   3. `receiver.ts` has no body parser of its own left to disagree (structural);
//   4. the awkward bodies the old form could not carry — edge whitespace, a fence of its own — now round-trip.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";

import { applyComment } from "./receiver.ts";
import type { Comment } from "./receiver.ts";
import { bodyHash, formatMessageComment, parseComment } from "./wire.ts";
import { buildMessage } from "./endpoint.ts";

const sha256 = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");
const T0 = new Date("2026-10-24T12:00:00.000Z");
const BODY = "obligation grain: the sibling table comes first.";

const asComment = (body: string): Comment => ({
  id: 1, body, created_at: T0.toISOString(), updated_at: T0.toISOString(), author_association: "OWNER", user_type: "User",
});

/** The retired form: envelope in a fence, body as the surrounding prose. */
const legacyComment = (envelope: object, body: string): string =>
  `${body}\n\n\`\`\`nh-msg\n${JSON.stringify(envelope, null, 2)}\n\`\`\``;

describe("unified wire format · one comment, two readers, one answer", () => {
  it("a comment written by wire.ts is read the same by the Actions receiver and by parseComment", () => {
    const msg = buildMessage("claude-code", "chatgpt", BODY, T0, 3600);
    const text = formatMessageComment(msg, BODY);

    const parsed = parseComment(text);
    expect(parsed.errors).toEqual([]);
    expect(parsed.body).toBe(BODY);

    const applied = applyComment({}, asComment(text), sha256);
    expect(applied.kind).toBe("message_recorded");
    expect(applied.bodySha).toBe(msg.body_sha256);
    expect(applied.bodySha).toBe(bodyHash(BODY));
  });

  it("the same awkward bodies the old form could not carry now round-trip through the receiver", () => {
    const awkward = "  leading space matters\n```json\n{\"a\":1}\n```\ntrailing  ";
    const msg = buildMessage("claude-code", "chatgpt", awkward, T0, 3600);
    const applied = applyComment({}, asComment(formatMessageComment(msg, awkward)), sha256);
    expect(applied.kind).toBe("message_recorded");
    expect(applied.bodySha).toBe(sha256(awkward));
  });
});

describe("unified wire format · the retired form is refused by both readers", () => {
  it("parseComment refuses it for having no nh-body block", () => {
    const envelope = { ...buildMessage("claude-code", "chatgpt", BODY, T0, 3600), body_sha256: sha256(BODY) };
    const parsed = parseComment(legacyComment(envelope, BODY));
    expect(parsed.message).toBeNull();
    expect(parsed.errors.join(" ")).toMatch(/must be accompanied by exactly one nh-body block/);
  });

  it("the receiver refuses it too, records nothing, and says what to do instead", () => {
    const envelope = { ...buildMessage("claude-code", "chatgpt", BODY, T0, 3600), body_sha256: sha256(BODY) };
    const applied = applyComment({}, asComment(legacyComment(envelope, BODY)), sha256);
    expect(applied.kind).toBe("message_rejected");
    expect(applied.errors.join(" ")).toMatch(/nh-body/);
    expect(applied.errors.join(" ")).toMatch(/retired/);
    expect(Object.keys(applied.ledger)).toHaveLength(0);
  });
});

describe("unified wire format · receiver.ts has no parser of its own left", () => {
  const code = readFileSync("scripts/coordination/receiver.ts", "utf8").replace(/^\s*\/\/.*$/gm, "");

  it("reads comments only through wire.ts", () => {
    expect(code).toMatch(/from "\.\/wire\.ts"/);
    expect(code).toContain("parseComment(");
  });

  it("no longer defines the text-as-body helpers or a fence regex of its own", () => {
    expect(code).not.toMatch(/function\s+messageBody|function\s+extractBlocks|const\s+FENCE_RE/);
    expect(code).not.toMatch(/export (const|function) (messageBody|extractBlocks)/);
  });
});

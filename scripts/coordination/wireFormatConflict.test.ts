// A PROTOCOL CONFLICT, PROVED RATHER THAN ASSERTED, AND NOT RESOLVED HERE.
//
// Two receivers landed in this directory from two independent workstreams, and they disagree about where a
// message's BODY lives in a comment:
//
//   · `receiver.ts` (GitHub Actions, `issue_comment`) — the body is THE COMMENT TEXT with the `nh-msg`
//     block removed, newline-normalised and trimmed (`messageBody`).
//   · `wire.ts` (the polling endpoint and the webhook receiver) — the body is a SECOND fenced block,
//     ```nh-body, carried beside the envelope.
//
// Both are reasonable. They are not compatible: `body_sha256` is computed over different text, so each
// refuses the other's messages. This file demonstrates that, so the decision is taken on a checked fact
// rather than on either author's description of their own design.
//
// WHY THIS IS NOT FIXED IN THIS SLICE. The wire format is the contract BETWEEN two agents. Picking mine
// because I wrote it last would be exactly the move this repository refuses elsewhere: the party that
// benefits from a choice does not get to make it unilaterally. It needs an owner decision, and the cost of
// each option is stated in the test names rather than in prose nobody re-checks.
//
// WHAT IS SAFE TODAY, and why nothing is currently broken: the two formats are used by DISJOINT paths. The
// polling endpoint writes and reads `nh-body` on both sides of its own exchange, which is why the
// end-to-end run passes; the Actions receiver is dormant until it sits on the default branch. The conflict
// becomes live the moment both run against one issue.
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";

import { applyComment, extractBlocks, messageBody } from "./receiver.ts";
import { bodyHash, formatMessageComment, parseComment } from "./wire.ts";
import { buildMessage } from "./endpoint.ts";

const sha256 = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");
const T0 = new Date("2026-10-24T12:00:00.000Z");
const BODY = "obligation grain: the sibling table comes first.";

/** A comment in the Actions receiver's own format: envelope in a fence, body as the surrounding text. */
function actionsStyleComment(envelope: object, body: string): string {
  return `${body}\n\n\`\`\`nh-msg\n${JSON.stringify(envelope, null, 2)}\n\`\`\``;
}

describe("wire-format conflict · the two formats are genuinely different", () => {
  it("the Actions receiver reads the body as the SURROUNDING TEXT", () => {
    const envelope = { ...buildMessage("claude-code", "chatgpt", BODY, T0, 3600), body_sha256: sha256(BODY) };
    const comment = actionsStyleComment(envelope, BODY);
    expect(messageBody(comment)).toBe(BODY);
    expect(sha256(messageBody(comment))).toBe(envelope.body_sha256);
  });

  it("the polling format reads the body as a SECOND FENCED BLOCK", () => {
    const msg = buildMessage("claude-code", "chatgpt", BODY, T0, 3600);
    const parsed = parseComment(formatMessageComment(msg, BODY));
    expect(parsed.errors).toEqual([]);
    expect(parsed.body).toBe(BODY);
    expect(bodyHash(parsed.body!)).toBe(msg.body_sha256);
  });
});

describe("wire-format conflict · neither can read the other", () => {
  it("THE ACTIONS RECEIVER REJECTS a polling-format message on its body hash", () => {
    // The envelope is well-formed and its hash is correct for the `nh-body` block. The Actions receiver
    // computes the hash over the comment text instead, which includes the whole nh-body fence, so the two
    // disagree and it reports a rejection rather than recording a message.
    const msg = buildMessage("claude-code", "chatgpt", BODY, T0, 3600);
    const comment = formatMessageComment(msg, BODY);

    const theirBody = messageBody(comment);
    expect(theirBody, "it sees the fence, not the body").toContain("nh-body");
    expect(sha256(theirBody)).not.toBe(msg.body_sha256);

    const applied = applyComment(
      {},
      { id: 1, body: comment, created_at: T0.toISOString(), author: "test", updated: false } as never,
      sha256,
    );
    expect(applied.kind).toBe("message_rejected");
    expect(applied.errors.join(" ")).toMatch(/sha|hash|body/i);
  });

  it("THE POLLING FORMAT REJECTS an Actions-style message for having no nh-body block", () => {
    const envelope = { ...buildMessage("claude-code", "chatgpt", BODY, T0, 3600), body_sha256: sha256(BODY) };
    const parsed = parseComment(actionsStyleComment(envelope, BODY));
    expect(parsed.message).toBeNull();
    expect(parsed.errors.join(" ")).toMatch(/must be accompanied by exactly one nh-body block/);
  });

  it("the envelope ITSELF is the same shape in both — only the body's location differs", () => {
    // Which is what makes this a wire-format conflict rather than two different protocols: `bridge.ts`
    // validates both envelopes identically, so whichever body convention wins, the delivery core and every
    // receipt rule are untouched. That bounds the size of the decision.
    const msg = buildMessage("claude-code", "chatgpt", BODY, T0, 3600);
    const mine = parseComment(formatMessageComment(msg, BODY)).message as { id: string; schema: string };
    const theirs = extractBlocks(actionsStyleComment(msg, BODY)).msg;
    expect(theirs).toHaveLength(1);
    expect((JSON.parse(theirs[0]!) as { id: string }).id).toBe(mine.id);
    expect(mine.schema).toBe("nh-msg/v1");
  });
});

describe("wire-format conflict · the cost of each option, so the decision is informed", () => {
  it("choosing the Actions format costs: the body cannot contain a fence or lose whitespace", () => {
    // `messageBody` trims and strips the nh-msg fence from the whole comment, so a body with meaningful
    // leading whitespace, or one containing its own ``` fence, cannot round-trip. Demonstrated, not argued.
    const awkward = "  leading space matters\n```json\n{\"a\":1}\n```\ntrailing  ";
    const envelope = { ...buildMessage("claude-code", "chatgpt", awkward, T0, 3600), body_sha256: sha256(awkward) };
    const comment = actionsStyleComment(envelope, awkward);
    expect(messageBody(comment), "whitespace is lost to the trim").not.toBe(awkward);
    expect(sha256(messageBody(comment))).not.toBe(envelope.body_sha256);

    // The fenced format preserves exactly those bodies.
    const msg = buildMessage("claude-code", "chatgpt", awkward, T0, 3600);
    expect(parseComment(formatMessageComment(msg, awkward)).body).toBe(awkward);
  });

  it("choosing the fenced format costs: a human cannot read the message without the fence markup", () => {
    // The Actions format renders as ordinary prose with a metadata block under it, which is friendlier in a
    // thread a person reads. The fenced format puts the human-readable text inside a code block.
    const msg = buildMessage("claude-code", "chatgpt", BODY, T0, 3600);
    const mineRendered = formatMessageComment(msg, BODY);
    expect(mineRendered.indexOf("```nh-body")).toBeLessThan(mineRendered.indexOf(BODY));
    const theirsRendered = actionsStyleComment(msg, BODY);
    expect(theirsRendered.startsWith(BODY), "theirs leads with the prose").toBe(true);
  });
});

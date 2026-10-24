// Falsifiers for the bridge wire format.
//
// The round-trip tests are the cheap half. The ones that matter are the refusals: a body that does not
// hash to its envelope, a comment carrying two envelopes, and a body that contains a fence of its own.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  BODY_FENCE,
  MAX_BODY_BYTES,
  MSG_FENCE,
  RECEIPT_FENCE,
  bodyHash,
  formatMessageComment,
  formatReceiptComment,
  parseComment,
} from "./wire.ts";
import { MSG_SCHEMA, RECEIPT_SCHEMA, validateMessage, validateReceipt } from "./bridge.ts";
import type { Message, Receipt } from "./bridge.ts";

// AFTER every fixture timestamp below, deliberately. `bridge.ts` refuses a receipt dated in the future,
// so a `NOW` equal to the message's own creation time makes a receipt five seconds later look forged.
// My first form of this file had exactly that bug and the validator was right to reject it.
const NOW = new Date("2026-10-24T13:00:00.000Z");

function msg(body: string, over: Partial<Message> = {}): Message {
  return {
    schema: MSG_SCHEMA,
    id: "msg-0001",
    from: "claude-code",
    to: "chatgpt",
    in_reply_to: null,
    body_sha256: bodyHash(body),
    created_at: "2026-10-24T12:00:00.000Z",
    expires_at: "2026-10-25T12:00:00.000Z",
    ...over,
  };
}

describe("wire · a message round-trips through a comment", () => {
  it("formats and parses back the same envelope and the EXACT body", () => {
    const body = "Obligation-grain identity: proceed with the sibling table first.";
    const text = formatMessageComment(msg(body), body);
    const parsed = parseComment(text);
    expect(parsed.errors).toEqual([]);
    expect(parsed.body).toBe(body);
    // And the envelope is not merely shaped like a message — the real validator accepts it.
    const v = validateMessage(parsed.message, NOW);
    expect(v.errors).toEqual([]);
    expect(v.ok).toBe(true);
    expect(v.value?.id).toBe("msg-0001");
  });

  it("a receipt round-trips and the real validator accepts it", () => {
    const body = "ack me";
    const receipt: Receipt = {
      schema: RECEIPT_SCHEMA,
      message_id: "msg-0001",
      body_sha256: bodyHash(body),
      received_by: "chatgpt",
      received_at: "2026-10-24T12:00:05.000Z",
    };
    const parsed = parseComment(formatReceiptComment(receipt));
    expect(parsed.errors).toEqual([]);
    expect(parsed.message).toBeNull();
    expect(validateReceipt(parsed.receipt, NOW).ok).toBe(true);
  });

  it("preserves a body containing newlines, unicode and leading whitespace byte for byte", () => {
    const body = "  line one\n\tטקסט בעברית · 日本語\n\n   trailing spaces   ";
    const parsed = parseComment(formatMessageComment(msg(body), body));
    expect(parsed.body).toBe(body);
    expect(bodyHash(parsed.body!)).toBe(bodyHash(body));
  });

  it("A BODY CONTAINING ITS OWN FENCE does not truncate the block", () => {
    // The correctness case the variable-length fence exists for. A body with ``` in it would close its own
    // block, and the envelope would then describe content nobody sent.
    const body = "here is code:\n```json\n{\"a\":1}\n```\nand more after the fence";
    const text = formatMessageComment(msg(body), body);
    const parsed = parseComment(text);
    expect(parsed.errors).toEqual([]);
    expect(parsed.body).toBe(body);
  });

  it("…even when the body contains a longer run than the opener would normally use", () => {
    const body = "````````\nnested\n````````";
    const parsed = parseComment(formatMessageComment(msg(body), body));
    expect(parsed.errors).toEqual([]);
    expect(parsed.body).toBe(body);
  });
});

describe("wire · integrity", () => {
  it("REFUSES a body that does not hash to the envelope", () => {
    // Hand-built, because `formatMessageComment` refuses to produce it — which is itself the next test.
    const body = "the real body";
    const text = [
      `\`\`\`${MSG_FENCE}`,
      JSON.stringify(msg(body), null, 2),
      "```",
      "",
      `\`\`\`${BODY_FENCE}`,
      "a DIFFERENT body",
      "```",
    ].join("\n");
    const parsed = parseComment(text);
    expect(parsed.errors).toContain("body does not hash to the envelope's body_sha256");
    expect(parsed.message).toBeNull();
    expect(parsed.body).toBeNull();
  });

  it("the formatter refuses to emit a mismatched pair at all", () => {
    expect(() => formatMessageComment(msg("declared body"), "actual body")).toThrow(/refusing to format/);
  });

  it("refuses a body over the carry limit rather than emitting a truncated comment", () => {
    const tooBig = "x".repeat(MAX_BODY_BYTES + 1);
    expect(() => formatMessageComment(msg(tooBig), tooBig)).toThrow(/exceeds/);
  });
});

describe("wire · ambiguity is refused, never resolved", () => {
  it("TWO ENVELOPES IN ONE COMMENT is an error, not a first-wins pick", () => {
    // The rule that matters: first-wins would let anyone who can comment prepend a block and change which
    // message a later receipt appears to acknowledge.
    const a = "body a";
    const b = "body b";
    const text = `${formatMessageComment(msg(a, { id: "msg-aaaa" }), a)}\n\n${formatMessageComment(msg(b, { id: "msg-bbbb" }), b)}`;
    const parsed = parseComment(text);
    expect(parsed.message).toBeNull();
    expect(parsed.errors.join(" ")).toMatch(/carries 2 nh-msg blocks/);
  });

  it("a message and a receipt in one comment is refused — the ledger needs an order", () => {
    const body = "b";
    const receipt: Receipt = {
      schema: RECEIPT_SCHEMA,
      message_id: "msg-0001",
      body_sha256: bodyHash(body),
      received_by: "chatgpt",
      received_at: "2026-10-24T12:00:05.000Z",
    };
    const parsed = parseComment(`${formatMessageComment(msg(body), body)}\n\n${formatReceiptComment(receipt)}`);
    expect(parsed.errors.join(" ")).toMatch(/both a message and a receipt/);
  });

  it("an envelope with no body, and a body with no envelope, are both refused", () => {
    const body = "orphan";
    const envelopeOnly = `\`\`\`${MSG_FENCE}\n${JSON.stringify(msg(body))}\n\`\`\``;
    expect(parseComment(envelopeOnly).errors.join(" ")).toMatch(/must be accompanied by exactly one nh-body/);
    const bodyOnly = `\`\`\`${BODY_FENCE}\norphan\n\`\`\``;
    expect(parseComment(bodyOnly).errors.join(" ")).toMatch(/without an nh-msg envelope/);
  });

  it("a wrong schema string is refused even when the shape is right", () => {
    const body = "b";
    const text = formatMessageComment(msg(body), body).replace(MSG_SCHEMA, "nh-msg/v2");
    expect(parseComment(text).errors.join(" ")).toMatch(/schema is not 'nh-msg\/v1'/);
  });

  it("a non-JSON block is reported, not thrown", () => {
    const text = `\`\`\`${RECEIPT_FENCE}\nnot json at all\n\`\`\``;
    const parsed = parseComment(text);
    expect(parsed.errors.join(" ")).toMatch(/not valid JSON/);
    expect(parsed.receipt).toBeNull();
  });
});

describe("wire · ordinary prose is not an error", () => {
  it("a comment with no blocks carries nothing and reports nothing", () => {
    // Most comments in a channel are prose. Reporting each as a failure would bury the real ones.
    const parsed = parseComment("Owner: please proceed with the sibling table.\n\n```sh\nnpm test\n```");
    expect(parsed).toEqual({ message: null, body: null, receipt: null, errors: [] });
  });

  it("a fence whose info-string merely STARTS with ours is not ours", () => {
    // `nh-msg-draft` is a different thing; matching it would let an unrelated block be read as a message.
    const parsed = parseComment(`\`\`\`${MSG_FENCE}-draft\n{"schema":"nh-msg/v1"}\n\`\`\``);
    expect(parsed.message).toBeNull();
    expect(parsed.errors).toEqual([]);
  });
});

describe("wire · the module is pure", () => {
  it("imports nothing that can reach a network, a disk or a process", () => {
    // Read as IMPORT SPECIFIERS, not as words: a prose mention is not a dependency. The repository has
    // recorded that lesson against its own guards more than once.
    const code = readFileSync("scripts/coordination/wire.ts", "utf8");
    const specifiers = [...code.matchAll(/^\s*import[^;]*?from\s+"([^"]+)"/gm)].map((m) => m[1]!);
    expect(specifiers.sort()).toEqual(["./bridge.ts", "./bridge.ts", "node:crypto"]);
    for (const banned of ["node:fs", "node:http", "node:https", "node:net", "node:child_process"]) {
      expect(specifiers).not.toContain(banned);
    }
  });

  it("there is no first-wins fallback anywhere in the parser", () => {
    // A structural pin on the decision, because this is the one rule a future tidy-up would be tempted to
    // "simplify" into taking blocks[0] when several are present.
    const code = readFileSync("scripts/coordination/wire.ts", "utf8").replace(/\/\/.*$/gm, "");
    expect(code).toMatch(/msgBlocks\.length > 1/);
    expect(code).toMatch(/exactly one is readable/);
  });
});

// Falsifiers for the bridge delivery check. Pure: no network, no clock, no disk.
import { describe, expect, it } from "vitest";
import { buildInboxReport, inboxExitCode, renderInboxReport, type InboxComment } from "./inbox";
import { toInboxComment } from "./coordination-inbox";

const msg = (id: number, messageId: string, hash = "a".repeat(64)): InboxComment => ({
  commentId: id, createdAt: "2026-11-07T22:00:00Z", author: "nisan333-glitch",
  messageId, bodySha256: hash, receiptForMessageId: null, receiptBodySha256: null, errors: [],
});

const receipt = (id: number, messageId: string, hash = "a".repeat(64)): InboxComment => ({
  commentId: id, createdAt: "2026-11-07T22:00:09Z", author: "github-actions[bot]",
  messageId: null, bodySha256: null, receiptForMessageId: messageId, receiptBodySha256: hash, errors: [],
});

describe("a message with a matching receipt is handled", () => {
  it("matches on BOTH the id and the body hash", () => {
    const r = buildInboxReport(13, [msg(1, "m-1"), receipt(2, "m-1")]);
    expect(r.handled.map((h) => h.messageId)).toEqual(["m-1"]);
    expect(r.unhandled).toEqual([]);
    expect(r.healthy).toBe(true);
    expect(inboxExitCode(r)).toBe(0);
  });

  it("a receipt describing OTHER bytes is a mismatch, never a delivery", () => {
    const r = buildInboxReport(13, [msg(1, "m-1", "a".repeat(64)), receipt(2, "m-1", "b".repeat(64))]);
    expect(r.handled).toEqual([]);
    expect(r.hashMismatched.map((h) => h.messageId)).toEqual(["m-1"]);
    expect(r.healthy).toBe(false);
    expect(inboxExitCode(r)).toBe(1);
  });
});

describe("the thing this tool exists to find", () => {
  it("reports a message with no receipt at all", () => {
    const r = buildInboxReport(18, [msg(1, "m-1")]);
    expect(r.unhandled.map((u) => u.messageId)).toEqual(["m-1"]);
    expect(r.healthy).toBe(false);
  });

  it("reports a receipt naming a message that is not in this issue", () => {
    const r = buildInboxReport(13, [receipt(2, "m-elsewhere")]);
    expect(r.orphanReceipts.map((o) => o.messageId)).toEqual(["m-elsewhere"]);
    expect(r.healthy).toBe(false);
  });
});

describe("an empty look is not a clean bill of health", () => {
  it("exits 2 and says so, rather than reporting healthy", () => {
    const r = buildInboxReport(13, []);
    expect(r.examinedSomething).toBe(false);
    expect(r.healthy).toBe(false);
    expect(inboxExitCode(r)).toBe(2);
    expect(renderInboxReport(r)).toContain("NOTHING WAS EXAMINED");
  });
});

describe("it reads bodies and reports none of them", () => {
  // A HEALTHY report prints counts only: the per-message lines exist to name PROBLEMS, so a delivered
  // message is deliberately not listed. The first form of this test asserted the id appeared on a
  // handled message, which was asserting the renderer's bug rather than its behaviour.
  it("a healthy report prints counts and no identifiers at all", () => {
    const out = renderInboxReport(buildInboxReport(13, [msg(1, "m-1"), receipt(2, "m-1")]));
    expect(out).toContain("handled:          1");
    expect(out).not.toContain("m-1");
    expect(out).not.toContain("a".repeat(64));
  });

  it("an unhandled message is named, and its body hash still is not", () => {
    const out = renderInboxReport(buildInboxReport(18, [msg(1, "m-1")]));
    expect(out).toContain("UNHANDLED m-1");
    expect(out).not.toContain("a".repeat(64));
  });
});

describe("the comment classifier separates prose, envelopes and the receiver's own replies", () => {
  it("ordinary prose is not a wire error", () => {
    const c = toInboxComment({ id: 1, created_at: "2026-11-07T22:00:00Z", user: { login: "x" }, body: "## A normal report\nwith text." });
    expect(c.errors).toEqual([]);
    expect(c.messageId).toBeNull();
    expect(c.receiptForMessageId).toBeNull();
  });

  it("the receiver's nh-ledger-receipt is read as a RECEIPT, not re-parsed as a message", () => {
    const body = "**NH ledger: message_recorded**\n\n```nh-ledger-receipt\n"
      + JSON.stringify({ schema: "nh-ledger-receipt/v1", message_id: "m-1", body_sha256: "c".repeat(64) })
      + "\n```";
    const c = toInboxComment({ id: 2, created_at: "2026-11-07T22:00:09Z", user: { login: "github-actions[bot]" }, body });
    expect(c.receiptForMessageId).toBe("m-1");
    expect(c.receiptBodySha256).toBe("c".repeat(64));
    // THE BUG THIS PREVENTS: parsing it as a message would report "a body block without an envelope"
    // and inflate `unusable` on every single reply the receiver has ever posted.
    expect(c.errors).toEqual([]);
  });

  it("a comment that TRIED to carry an envelope and failed is unusable", () => {
    const c = toInboxComment({ id: 3, created_at: "2026-11-07T22:00:00Z", user: { login: "x" }, body: "```nh-body\nno envelope\n```" });
    expect(c.errors.length).toBeGreaterThan(0);
    expect(c.messageId).toBeNull();
  });

  /**
   * THE PARSER VERIFIES THE BODY HASH, which this test learned by failing. A fabricated envelope whose
   * `body_sha256` did not match its own body was correctly REJECTED — so the integrity check is real,
   * and an envelope cannot describe bytes other than the ones beside it.
   */
  it("a well-formed envelope yields its id, and only when its hash matches the body", async () => {
    const { createHash } = await import("node:crypto");
    const text = "hello";
    const hash = createHash("sha256").update(text, "utf8").digest("hex");
    const envelope = (bodySha256: string) =>
      "```nh-msg\n" + JSON.stringify({
        schema: "nh-msg/v1", id: "m-9", from: "claude-code", to: "chatgpt", in_reply_to: null,
        body_sha256: bodySha256, created_at: "2026-11-07T22:00:00Z", expires_at: "2026-11-14T22:00:00Z",
      }) + "\n```\n\n```nh-body\n" + text + "\n```";

    const good = toInboxComment({ id: 4, created_at: "2026-11-07T22:00:00Z", user: { login: "x" }, body: envelope(hash) });
    expect(good.messageId).toBe("m-9");
    expect(good.bodySha256).toBe(hash);
    expect(good.errors).toEqual([]);

    const tampered = toInboxComment({ id: 5, created_at: "2026-11-07T22:00:00Z", user: { login: "x" }, body: envelope("d".repeat(64)) });
    expect(tampered.messageId).toBeNull();
    expect(tampered.errors.length).toBeGreaterThan(0);
  });
});

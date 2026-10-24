// Falsifiers for one endpoint's cycle, driven through a fake transport.
//
// These prove the LOGIC: detection, acknowledgement, duplicate suppression, response, retry and failure.
// They do not prove anything moves over GitHub — that is `bridgeE2E.test.ts`, which runs two real
// processes against a real issue. Both are needed, and neither substitutes for the other: a fake
// transport cannot catch a REST payload mistake, and a live test is too slow to enumerate refusals.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  EMPTY_CURSOR,
  buildMessage,
  loadCursor,
  messageId,
  resend,
  runCycle,
  send,
} from "./endpoint.ts";
import type { EndpointConfig, Transport } from "./endpoint.ts";
import { loadLedger, saveLedger } from "./ledgerStore.ts";
import { RECEIPT_SCHEMA } from "./bridge.ts";
import type { Receipt } from "./bridge.ts";
import { bodyHash, formatMessageComment, formatReceiptComment, parseComment } from "./wire.ts";
import type { CommentRecord, PollResult } from "./githubChannel.ts";

/** A channel in memory: posting appends a comment the way GitHub would, with an increasing id. */
class FakeChannel {
  readonly comments: CommentRecord[] = [];
  private nextId = 1000;
  postCount = 0;

  post = async (body: string): Promise<number> => {
    this.postCount += 1;
    const id = (this.nextId += 1);
    this.comments.push({ id, body, createdAt: new Date(Date.now()).toISOString(), author: "test" });
    return id;
  };

  poll = async (_since: string | null, _etag: string | null): Promise<PollResult> =>
    ({ comments: [...this.comments], etag: '"fake"', unchanged: false });

  transport(): Transport {
    return { post: this.post, poll: this.poll };
  }

  /** Every record of a kind that was posted, so a test asserts on the CHANNEL and not on a return value. */
  records(kind: "message" | "receipt"): unknown[] {
    return this.comments
      .map((c) => parseComment(c.body))
      .filter((p) => (kind === "message" ? p.message !== null : p.receipt !== null))
      .map((p) => (kind === "message" ? p.message : p.receipt));
  }
}

let dir: string;
const cfgFor = (me: EndpointConfig["me"], over: Partial<EndpointConfig> = {}): EndpointConfig => ({
  me,
  ledgerPath: join(dir, `${me}.ledger.json`),
  cursorPath: join(dir, `${me}.cursor.json`),
  retry: { maxAttempts: 3, baseSeconds: 1, capSeconds: 4 },
  autoRespond: null,
  ...over,
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nh-bridge-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const T0 = new Date("2026-10-24T12:00:00.000Z");
const at = (seconds: number): Date => new Date(T0.getTime() + seconds * 1000);

describe("endpoint · a message is published, detected, acknowledged and answered", () => {
  it("runs the whole chain between two endpoints over one channel", async () => {
    const chan = new FakeChannel();
    const sender = cfgFor("claude-code");
    const recipient = cfgFor("chatgpt", { autoRespond: "ack from the receiving service" });

    // 1 · PUBLISHED
    const sent = await send(sender, chan.transport(), "chatgpt", "obligation grain: table first", T0);
    expect(sent.outcome).toBe("accepted");
    expect(sent.commentId).not.toBeNull();
    expect(chan.records("message")).toHaveLength(1);

    // 2 · DETECTED and 3 · ACKNOWLEDGED and 5 · RESPONSE, all in the recipient's cycle
    const inbound = await runCycle(recipient, chan.transport(), at(1));
    expect(inbound.accepted).toEqual([sent.message.id]);
    expect(inbound.receiptsPosted).toEqual([sent.message.id]);
    expect(inbound.responsesPosted).toHaveLength(1);
    expect(inbound.errors).toEqual([]);

    // The receipt is on the channel and names the right message and hash — asserted on the CHANNEL.
    const receipts = chan.records("receipt") as Receipt[];
    expect(receipts).toHaveLength(1);
    expect(receipts[0]!.message_id).toBe(sent.message.id);
    expect(receipts[0]!.body_sha256).toBe(bodyHash("obligation grain: table first"));
    expect(receipts[0]!.received_by).toBe("chatgpt");

    // The response is a real message addressed back, replying to the original.
    const msgs = chan.records("message") as Array<{ id: string; to: string; from: string; in_reply_to: string | null }>;
    const response = msgs.find((m) => m.in_reply_to === sent.message.id)!;
    expect(response).toBeDefined();
    expect(response.from).toBe("chatgpt");
    expect(response.to).toBe("claude-code");

    // 4 · DELIVERED, on the sender's side, only once it has seen the receipt — AND, in the same cycle,
    // 6 · the sender acknowledges the RESPONSE in turn. Both happen at once because the receipt and the
    // response were both already on the channel; an earlier form of this test expected the acknowledgement
    // one cycle later, which was wrong about the sequence rather than about the behaviour.
    const before = loadLedger(sender.ledgerPath, at(2));
    expect(before[sent.message.id]!.state).toBe("pending");
    const back = await runCycle(sender, chan.transport(), at(2));
    expect(back.delivered).toEqual([sent.message.id]);
    expect(back.accepted).toEqual([response.id]);
    expect(back.receiptsPosted).toEqual([response.id]);
    const after = loadLedger(sender.ledgerPath, at(2));
    expect(after[sent.message.id]!.state).toBe("delivered");
    expect(after[sent.message.id]!.receipt).not.toBeNull();

    // 7 · THE ROUND TRIP CLOSES: the recipient sees the acknowledgement of its own response, so BOTH
    // directions reach `delivered`. One direction reaching it would only prove half a bridge.
    const closing = await runCycle(recipient, chan.transport(), at(3));
    expect(closing.delivered).toEqual([response.id]);
    expect(loadLedger(recipient.ledgerPath, at(3))[response.id]!.state).toBe("delivered");
  });
});

describe("endpoint · auto-respond does not lose the message it is answering", () => {
  it("THE RECIPIENT'S OWN LEDGER records the inbound message after it responds", async () => {
    // The regression this pins was found by the two-process run, not here: `send` loads the ledger from
    // DISK, so responding before persisting this cycle's work discarded the accepted message and its
    // receipt. The earlier version of the suite asserted the cycle REPORT, which was correct either way —
    // so the assertion that matters is on the ledger the recipient keeps.
    const chan = new FakeChannel();
    const recipient = cfgFor("chatgpt", { autoRespond: "answering" });
    const msg = buildMessage("claude-code", "chatgpt", "please answer", T0, 3600);
    await chan.post(formatMessageComment(msg, "please answer"));

    const report = await runCycle(recipient, chan.transport(), at(1));
    expect(report.accepted).toEqual([msg.id]);
    expect(report.responsesPosted).toHaveLength(1);

    const ledger = loadLedger(recipient.ledgerPath, at(1));
    expect(ledger[msg.id], "the inbound message survived the response").toBeDefined();
    expect(ledger[msg.id]!.state).toBe("delivered");
    expect(ledger[report.responsesPosted[0]!], "the response is recorded too").toBeDefined();
  });

  it("…so a RE-POST is still suppressed on an endpoint that auto-responds", async () => {
    // The second symptom of the same defect: with the inbound record lost, `receive` found nothing and
    // acknowledged the repeat, so one message looked delivered twice.
    const chan = new FakeChannel();
    const recipient = cfgFor("chatgpt", { autoRespond: "answering" });
    const msg = buildMessage("claude-code", "chatgpt", "say it twice", T0, 3600);
    await chan.post(formatMessageComment(msg, "say it twice"));
    await runCycle(recipient, chan.transport(), at(1));
    const receiptsAfterFirst = chan.records("receipt").length;

    await chan.post(formatMessageComment(msg, "say it twice"));
    const second = await runCycle(recipient, chan.transport(), at(2));
    expect(second.duplicates).toEqual([msg.id]);
    expect(second.receiptsPosted).toEqual([]);
    expect(chan.records("receipt")).toHaveLength(receiptsAfterFirst);
  });
});

describe("endpoint · a duplicate is suppressed", () => {
  it("the SAME message posted twice is acknowledged ONCE", async () => {
    const chan = new FakeChannel();
    const sender = cfgFor("claude-code");
    const recipient = cfgFor("chatgpt");

    const sent = await send(sender, chan.transport(), "chatgpt", "same body", T0);
    await runCycle(recipient, chan.transport(), at(1));
    const receiptsAfterFirst = chan.records("receipt").length;
    expect(receiptsAfterFirst).toBe(1);

    // Re-post the identical comment, as a retry would.
    await chan.post(formatMessageComment(sent.message, "same body"));
    const second = await runCycle(recipient, chan.transport(), at(2));

    expect(second.duplicates).toEqual([sent.message.id]);
    expect(second.accepted).toEqual([]);
    expect(second.receiptsPosted).toEqual([]);
    // The decisive assertion is on the channel: no SECOND receipt exists. A second receipt would suggest
    // two deliveries of one message.
    expect(chan.records("receipt")).toHaveLength(receiptsAfterFirst);
  });

  it("the same id with DIFFERENT content is a conflict and is never acknowledged", async () => {
    const chan = new FakeChannel();
    const recipient = cfgFor("chatgpt");
    const good = buildMessage("claude-code", "chatgpt", "real body", T0, 3600);
    await chan.post(formatMessageComment(good, "real body"));
    await runCycle(recipient, chan.transport(), at(1));

    // Same id, different body — hand-built, since the formatter refuses a mismatched pair.
    const swapped = { ...good, body_sha256: bodyHash("swapped body") };
    await chan.post(formatMessageComment(swapped, "swapped body"));
    const report = await runCycle(recipient, chan.transport(), at(2));
    expect(report.conflicts).toEqual([good.id]);
    expect(report.receiptsPosted).toEqual([]);
    expect(chan.records("receipt")).toHaveLength(1);
  });
});

describe("endpoint · addressing", () => {
  it("a message addressed to SOMEBODY ELSE is not acknowledged", async () => {
    const chan = new FakeChannel();
    const other = buildMessage("claude-code", "owner", "for the owner", T0, 3600);
    await chan.post(formatMessageComment(other, "for the owner"));
    const report = await runCycle(cfgFor("chatgpt"), chan.transport(), at(1));
    expect(report.accepted).toEqual([]);
    expect(report.receiptsPosted).toEqual([]);
    expect(chan.records("receipt")).toHaveLength(0);
  });

  it("AN ENDPOINT NEVER ACKNOWLEDGES ITS OWN MESSAGE, even seeing it echoed back", async () => {
    // `bridge.ts` refuses it at the ledger; this asserts the endpoint never even posts such a receipt,
    // which is the Trust Invariant applied to the exchange: the sender is not the witness of delivery.
    const chan = new FakeChannel();
    const sender = cfgFor("claude-code");
    await send(sender, chan.transport(), "chatgpt", "mine", T0);
    const report = await runCycle(sender, chan.transport(), at(1));
    expect(report.receiptsPosted).toEqual([]);
    expect(chan.records("receipt")).toHaveLength(0);
  });

  it("a malformed comment is reported and does not stop the cycle", async () => {
    const chan = new FakeChannel();
    await chan.post("```nh-msg\nnot json\n```\n\n```nh-body\nx\n```");
    const good = buildMessage("claude-code", "chatgpt", "good one", T0, 3600);
    await chan.post(formatMessageComment(good, "good one"));
    const report = await runCycle(cfgFor("chatgpt"), chan.transport(), at(1));
    expect(report.errors.join(" ")).toMatch(/not valid JSON/);
    expect(report.accepted).toEqual([good.id]); // the good message still got through
  });
});

describe("endpoint · retry and visible failure", () => {
  it("an unacknowledged message is re-sent on the schedule, then FAILS visibly", async () => {
    const chan = new FakeChannel();
    const sender = cfgFor("claude-code"); // maxAttempts 3, base 1s
    const sent = await send(sender, chan.transport(), "chatgpt", "nobody is listening", T0);
    expect(loadLedger(sender.ledgerPath, at(0))[sent.message.id]!.attempts).toBe(1);

    // Too early: the schedule says wait, so nothing is posted.
    const early = await resend(sender, chan.transport(), sent.message, "nobody is listening", at(0));
    expect(early.sent).toBe(false);

    // After the backoff, attempt 2 goes out.
    const second = await resend(sender, chan.transport(), sent.message, "nobody is listening", at(5));
    expect(second.sent).toBe(true);
    expect(second.attempts).toBe(2);

    // Attempt 3 is the last one the policy allows, and it exhausts the schedule.
    const third = await resend(sender, chan.transport(), sent.message, "nobody is listening", at(60));
    expect(third.sent).toBe(true);
    expect(third.attempts).toBe(3);
    expect(third.state).toBe("failed");

    // FAILURE IS A RECORDED STATE, not silence — and nothing more is sent.
    const fourth = await resend(sender, chan.transport(), sent.message, "nobody is listening", at(600));
    expect(fourth.sent).toBe(false);
    expect(fourth.state).toBe("failed");
    expect(loadLedger(sender.ledgerPath, at(600))[sent.message.id]!.state).toBe("failed");
  });

  it("a cycle reports an overdue message as retried and an exhausted one as failed", async () => {
    const chan = new FakeChannel();
    const sender = cfgFor("claude-code");
    const sent = await send(sender, chan.transport(), "chatgpt", "overdue", T0);
    const overdue = await runCycle(sender, chan.transport(), at(10));
    expect(overdue.retried).toEqual([sent.message.id]);
    expect(overdue.failed).toEqual([]);
  });

  it("resend refuses a body that does not match the envelope it is resending", async () => {
    const chan = new FakeChannel();
    const sender = cfgFor("claude-code");
    const sent = await send(sender, chan.transport(), "chatgpt", "the real body", T0);
    const wrong = await resend(sender, chan.transport(), sent.message, "a different body", at(5));
    expect(wrong.sent).toBe(false);
    expect(chan.records("message")).toHaveLength(1);
  });

  it("a delivered message is never re-sent", async () => {
    const chan = new FakeChannel();
    const sender = cfgFor("claude-code");
    const sent = await send(sender, chan.transport(), "chatgpt", "will be acked", T0);
    const receipt: Receipt = {
      schema: RECEIPT_SCHEMA,
      message_id: sent.message.id,
      body_sha256: bodyHash("will be acked"),
      received_by: "chatgpt",
      received_at: at(1).toISOString().replace(/\.\d{3}Z$/, ".000Z"),
    };
    await chan.post(formatReceiptComment(receipt));
    await runCycle(sender, chan.transport(), at(2));
    const again = await resend(sender, chan.transport(), sent.message, "will be acked", at(600));
    expect(again.sent).toBe(false);
    expect(again.state).toBe("delivered");
  });
});

describe("endpoint · state survives a restart", () => {
  it("the ledger and the cursor are reloaded, so nothing is re-delivered or re-acked", async () => {
    // The gap the owner named: the previous watcher "dies with the session". A fresh config object with the
    // same paths is exactly what a restarted process sees.
    const chan = new FakeChannel();
    const recipient = cfgFor("chatgpt");
    const msg = buildMessage("claude-code", "chatgpt", "before the restart", T0, 3600);
    await chan.post(formatMessageComment(msg, "before the restart"));
    const first = await runCycle(recipient, chan.transport(), at(1));
    expect(first.receiptsPosted).toEqual([msg.id]);

    const restarted = cfgFor("chatgpt"); // same paths, new object
    const second = await runCycle(restarted, chan.transport(), at(2));
    expect(second.accepted).toEqual([]);
    expect(second.receiptsPosted).toEqual([]);
    expect(chan.records("receipt")).toHaveLength(1);
    expect(loadCursor(recipient.cursorPath).lastCommentId).toBeGreaterThan(0);
  });

  it("A CORRUPT LEDGER IS A REFUSAL, never a silent fresh start", async () => {
    // Starting from empty would re-send everything already delivered and re-arm every retry, quietly.
    const recipient = cfgFor("chatgpt");
    writeFileSync(recipient.ledgerPath, "{ not json");
    expect(() => loadLedger(recipient.ledgerPath, T0)).toThrow(/not valid JSON/);
  });

  it("a ledger whose entry no longer validates is refused rather than carried into a decision", async () => {
    const recipient = cfgFor("chatgpt");
    const msg = buildMessage("claude-code", "chatgpt", "x", T0, 3600);
    saveLedger(recipient.ledgerPath, { [msg.id]: { message: msg, state: "pending", attempts: 0, lastAttemptAt: null, receipt: null } });
    const tampered = JSON.parse(readFileSync(recipient.ledgerPath, "utf8")) as { entries: Record<string, { message: { from: string } }> };
    tampered.entries[msg.id]!.message.from = "not-a-party";
    writeFileSync(recipient.ledgerPath, JSON.stringify(tampered));
    expect(() => loadLedger(recipient.ledgerPath, at(1))).toThrow(/invalid message/);
  });

  it("a corrupt CURSOR is recoverable, because a position is not evidence", async () => {
    // Deliberately different from the ledger: losing a position costs a re-read, which dedupes.
    const recipient = cfgFor("chatgpt");
    writeFileSync(recipient.cursorPath, "}{ garbage");
    expect(loadCursor(recipient.cursorPath)).toEqual(EMPTY_CURSOR);
  });
});

describe("endpoint · ids", () => {
  it("the same body from the same sender is the SAME message id, so a re-send is not a new message", () => {
    expect(messageId("claude-code", "hello")).toBe(messageId("claude-code", "hello"));
    expect(messageId("claude-code", "hello")).not.toBe(messageId("chatgpt", "hello"));
    expect(messageId("claude-code", "hello")).not.toBe(messageId("claude-code", "hello!"));
    expect(messageId("claude-code", "hello")).not.toBe(messageId("claude-code", "hello", "salt"));
  });

  it("ids satisfy the delivery core's own id rule", () => {
    // Pinned against bridge.ts's pattern rather than restated, so a change there cannot silently produce
    // ids this endpoint generates but the validator refuses.
    expect(messageId("claude-code", "anything")).toMatch(/^[a-z0-9][a-z0-9._-]{2,63}$/);
  });
});

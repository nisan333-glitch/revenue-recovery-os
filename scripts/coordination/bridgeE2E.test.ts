// THE END-TO-END PROOF. Two independently running processes exchanging messages through a real GitHub
// issue, with no manual copying and no shared memory between them.
//
// WHY THIS EXISTS SEPARATELY FROM `endpoint.test.ts`. That suite drives the cycle through a fake transport:
// it proves the LOGIC and it cannot prove that anything moves. This one spawns two OS processes that share
// nothing but the GitHub issue, and asserts the outcome by reading GitHub and each process's own ledger
// file. A fake channel cannot catch a REST payload mistake, a comment GitHub refuses, or an ETag that
// never advances; this can, and it did — see the notes in the commit for what it caught.
//
// GATED, AND THE GATE IS DELIBERATE. It posts real comments to a real issue, so it runs only when
// `NH_BRIDGE_E2E=1` is set with a repo and an issue. CI does not set it: a bridge test that posted on every
// push would fill the channel with traffic from commits nobody is coordinating about. The consequence is
// stated rather than hidden — THIS TEST IS NOT RUN BY CI, so the evidence for it is the recorded output of
// a real run, and the suites CI does run are the unit ones.
//
// WHAT A PASS HERE PROVES, EXACTLY. That a message published by process A was detected by process B,
// acknowledged by B, answered by B, that the answer was detected and acknowledged by A, that a re-posted
// message produced no second acknowledgement, and that an unanswered message reached a recorded `failed`
// state. It does NOT prove that any human or any model read anything: the `chatgpt` endpoint here is a
// service we ran, and GitHub cannot wake an inactive ChatGPT conversation.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { listCommentsSince, postComment } from "./githubChannel.ts";
import type { CommentRecord } from "./githubChannel.ts";
import { parseComment, formatMessageComment } from "./wire.ts";
import { loadLedger } from "./ledgerStore.ts";
import { buildMessage, messageId, resend, send } from "./endpoint.ts";
import type { EndpointConfig, Transport } from "./endpoint.ts";
import type { Message, Receipt } from "./bridge.ts";

const ENABLED = process.env.NH_BRIDGE_E2E === "1";
const REPO = process.env.NH_BRIDGE_REPO ?? "";
const ISSUE = Number.parseInt(process.env.NH_BRIDGE_ISSUE ?? "0", 10);
const ref = { repo: REPO, issue: ISSUE };

/** A nonce per run, so this run's messages are distinct from every previous run's on the same issue. */
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const SUBJECT = `e2e ${RUN}`;

let dir: string;
const children: ChildProcess[] = [];

function startEndpoint(party: string, extra: readonly string[] = []): ChildProcess {
  const child = spawn(
    "npx",
    [
      "vite-node",
      "scripts/coordination/bridge-endpoint.ts",
      "--repo", REPO,
      "--issue", String(ISSUE),
      "--as", party,
      "--ledger", join(dir, `${party}.ledger.json`),
      "--poll", "5",
      ...extra,
    ],
    { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"], env: process.env },
  );
  const log = (prefix: string) => (buf: Buffer) => {
    const text = buf.toString().trim();
    if (text !== "") console.log(`[${party}${prefix}] ${text}`);
  };
  child.stdout?.on("data", log(""));
  child.stderr?.on("data", log(" err"));
  children.push(child);
  return child;
}

/** Poll GitHub until `predicate` holds over all comments, or give up. Returns the comments it saw. */
async function waitForChannel(
  predicate: (comments: readonly CommentRecord[]) => boolean,
  what: string,
  timeoutMs = 150_000,
): Promise<readonly CommentRecord[]> {
  const deadline = Date.now() + timeoutMs;
  let last: readonly CommentRecord[] = [];
  while (Date.now() < deadline) {
    // No ETag here on purpose: this is the test's own observation of the channel and must never be served
    // a 304 that hides a change the endpoints just made.
    const { comments } = await listCommentsSince(ref, null, null);
    last = comments;
    if (predicate(comments)) return comments;
    await new Promise((r) => setTimeout(r, 4000));
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}; saw ${last.length} comment(s)`);
}

/**
 * Poll one endpoint's ledger FILE until `predicate` holds.
 *
 * NEEDED BECAUSE THE PROCESSES ARE GENUINELY INDEPENDENT. A receipt appearing on the channel says the
 * SENDER posted it; the other endpoint only learns of it on its next poll, and writes its ledger then. An
 * earlier form of this test asserted both ledgers the instant the receipt appeared and failed with
 * `pending` — it was assuming a synchronicity that two separate processes do not have. The assertion is
 * unchanged; only the waiting is.
 */
async function waitForLedger(
  path: string,
  predicate: (ledger: ReturnType<typeof loadLedger>) => boolean,
  what: string,
  timeoutMs = 90_000,
): Promise<ReturnType<typeof loadLedger>> {
  const deadline = Date.now() + timeoutMs;
  let last: ReturnType<typeof loadLedger> = {};
  while (Date.now() < deadline) {
    try {
      last = loadLedger(path, new Date());
      if (predicate(last)) return last;
    } catch {
      // A ledger mid-write is momentary; the atomic rename means the next read sees a whole file.
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`timed out waiting for ${what} in ${path}; ids=[${Object.keys(last).join(",")}]`);
}

const messagesIn = (comments: readonly CommentRecord[]): Message[] =>
  comments.map((c) => parseComment(c.body).message).filter((m): m is Message => m !== null);
const receiptsIn = (comments: readonly CommentRecord[]): Receipt[] =>
  comments.map((c) => parseComment(c.body).receipt).filter((r): r is Receipt => r !== null);

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nh-e2e-"));
});

afterAll(() => {
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!ENABLED)("bridge · end to end over a real GitHub issue", () => {
  it("configuration is present", () => {
    expect(REPO, "NH_BRIDGE_REPO").toMatch(/^[\w.-]+\/[\w.-]+$/);
    expect(Number.isSafeInteger(ISSUE) && ISSUE > 0, "NH_BRIDGE_ISSUE").toBe(true);
  });

  it(
    "A publishes, B detects, acknowledges and answers, A acknowledges the answer",
    async () => {
      // TWO PROCESSES, SHARING NOTHING BUT THE ISSUE. Separate ledgers, separate cursors, separate pids.
      const bodyAtoB = `${SUBJECT} · from claude-code: obligation grain — sibling table first, field second.`;

      // B is the receiving service, running on ChatGPT's behalf. It is NOT a ChatGPT conversation.
      startEndpoint("chatgpt", ["--auto-respond", `${SUBJECT} · from the receiving service: acknowledged, table first.`]);
      // A publishes on startup and then keeps polling for the receipt and the answer.
      startEndpoint("claude-code", ["--send", bodyAtoB, "--to", "chatgpt"]);

      const expectedId = messageId("claude-code", bodyAtoB);

      // 1 · PUBLISHED and 2 · DETECTED and 3 · ACKNOWLEDGED
      let comments = await waitForChannel(
        (cs) => receiptsIn(cs).some((r) => r.message_id === expectedId && r.received_by === "chatgpt"),
        "B's receipt for A's message",
      );
      const published = messagesIn(comments).find((m) => m.id === expectedId)!;
      expect(published, "A's message is on the channel").toBeDefined();
      expect(published.from).toBe("claude-code");
      expect(published.to).toBe("chatgpt");

      const receipt = receiptsIn(comments).find((r) => r.message_id === expectedId)!;
      expect(receipt.received_by).toBe("chatgpt");
      expect(receipt.body_sha256).toBe(published.body_sha256);
      // THE SENDER DID NOT WITNESS ITS OWN DELIVERY: the receipt is from the addressee.
      expect(receipt.received_by).not.toBe(published.from);

      // 5 · RESPONSE RETURNED — a new message replying to the original, addressed back.
      comments = await waitForChannel(
        (cs) => messagesIn(cs).some((m) => m.in_reply_to === expectedId && m.to === "claude-code"),
        "B's response to A",
      );
      const response = messagesIn(comments).find((m) => m.in_reply_to === expectedId)!;
      expect(response.from).toBe("chatgpt");
      expect(response.to).toBe("claude-code");

      // 4 · DELIVERED and 6 · the answer acknowledged in turn, both read from GitHub.
      comments = await waitForChannel(
        (cs) => receiptsIn(cs).some((r) => r.message_id === response.id && r.received_by === "claude-code"),
        "A's receipt for B's response",
      );

      // AND THE LEDGERS AGREE, which is the part a channel read cannot show: each process recorded the
      // delivery in its own durable file, independently. BOTH directions must reach `delivered` — one
      // direction alone would prove half a bridge.
      const ledgerA = await waitForLedger(
        join(dir, "claude-code.ledger.json"),
        (l) => l[expectedId]?.state === "delivered" && l[response.id]?.state === "delivered",
        "A to record its message delivered and the response accepted",
      );
      expect(ledgerA[expectedId]?.state, "A sees its message delivered").toBe("delivered");
      expect(ledgerA[expectedId]?.receipt, "A holds B's receipt").not.toBeNull();

      const ledgerB = await waitForLedger(
        join(dir, "chatgpt.ledger.json"),
        (l) => l[expectedId]?.state === "delivered" && l[response.id]?.state === "delivered",
        "B to record the inbound message and its own response delivered",
      );
      expect(ledgerB[expectedId]?.state, "B sees the inbound message delivered").toBe("delivered");
      expect(ledgerB[response.id]?.state, "B sees its response delivered").toBe("delivered");
      expect(ledgerB[response.id]?.receipt, "B holds A's receipt for the response").not.toBeNull();
    },
    300_000,
  );

  it(
    "7 · a RE-POSTED message produces no second acknowledgement",
    async () => {
      // The duplicate-suppression proof, over the real channel: re-post byte-identical content and show the
      // receipt count does not move. A second receipt would mean one message looked delivered twice.
      const body = `${SUBJECT} · duplicate probe`;
      const transport: Transport = {
        post: (b) => postComment(ref, b),
        poll: (since, etag) => listCommentsSince(ref, since, etag),
      };
      const cfg: EndpointConfig = {
        me: "claude-code",
        ledgerPath: join(dir, "dup.ledger.json"),
        cursorPath: join(dir, "dup.cursor.json"),
        retry: { maxAttempts: 3, baseSeconds: 1, capSeconds: 2 },
        autoRespond: null,
      };
      const sent = await send(cfg, transport, "chatgpt", body, new Date());
      expect(sent.commentId).not.toBeNull();

      await waitForChannel(
        (cs) => receiptsIn(cs).filter((r) => r.message_id === sent.message.id).length === 1,
        "the first receipt for the duplicate probe",
      );

      // Re-post the identical comment, exactly as a retry would.
      await postComment(ref, formatMessageComment(sent.message, body));

      // Give B's poller several cycles to see it and decide. The assertion is that NOTHING new appears.
      await new Promise((r) => setTimeout(r, 25_000));
      const { comments } = await listCommentsSince(ref, null, null);
      expect(messagesIn(comments).filter((m) => m.id === sent.message.id).length).toBeGreaterThanOrEqual(2);
      expect(receiptsIn(comments).filter((r) => r.message_id === sent.message.id)).toHaveLength(1);
    },
    180_000,
  );

  it("8 · an unanswered message is retried and then FAILS visibly", async () => {
    // Addressed to `owner`, for whom no endpoint is running in this test. Nothing will ever acknowledge it,
    // so the bounded schedule must run out and record `failed` — a visible state, not silence.
    const body = `${SUBJECT} · nobody is listening for this one`;
    const transport: Transport = {
      post: (b) => postComment(ref, b),
      poll: (since, etag) => listCommentsSince(ref, since, etag),
    };
    const cfg: EndpointConfig = {
      me: "claude-code",
      ledgerPath: join(dir, "retry.ledger.json"),
      cursorPath: join(dir, "retry.cursor.json"),
      // A short schedule so the test does not take an hour. The SHAPE is what is being proved, and the
      // schedule is a parameter of `bridge.ts` rather than a constant of the bridge.
      retry: { maxAttempts: 3, baseSeconds: 1, capSeconds: 2 },
      autoRespond: null,
    };
    const t0 = new Date();
    const sent = await send(cfg, transport, "owner", body, t0);
    expect(sent.commentId).not.toBeNull();
    expect(loadLedger(cfg.ledgerPath, t0)[sent.message.id]!.attempts).toBe(1);

    const second = await resend(cfg, transport, sent.message, body, new Date(t0.getTime() + 5_000));
    expect(second.sent).toBe(true);
    expect(second.attempts).toBe(2);

    const third = await resend(cfg, transport, sent.message, body, new Date(t0.getTime() + 60_000));
    expect(third.sent).toBe(true);
    expect(third.attempts).toBe(3);
    expect(third.state).toBe("failed");

    // Nothing more is sent, and the failure is on disk where an operator can see it.
    const after = await resend(cfg, transport, sent.message, body, new Date(t0.getTime() + 600_000));
    expect(after.sent).toBe(false);
    expect(after.state).toBe("failed");
    expect(loadLedger(cfg.ledgerPath, new Date())[sent.message.id]!.state).toBe("failed");
  }, 120_000);

  it("a message addressed to a party with no endpoint is never acknowledged by anyone else", async () => {
    // The addressing rule over the real channel: B is running, and it must not acknowledge traffic
    // addressed to `owner`. Otherwise one endpoint could acknowledge on another party's behalf.
    const body = `${SUBJECT} · addressed to the owner only`;
    const msg = buildMessage("claude-code", "owner", body, new Date(), 3600, null, "owner-probe");
    await postComment(ref, formatMessageComment(msg, body));
    await new Promise((r) => setTimeout(r, 25_000));
    const { comments } = await listCommentsSince(ref, null, null);
    expect(receiptsIn(comments).filter((r) => r.message_id === msg.id)).toHaveLength(0);
  }, 120_000);
});

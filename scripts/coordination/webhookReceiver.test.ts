// Falsifiers for the inbound WEBHOOK receiver (not `receiver.ts`, which is the Actions one).
//
// These bind a REAL socket and send REAL signed HTTP requests, because the thing being tested is a
// receiver: a test that called `handleDelivery` directly would never catch a server that reads the body
// wrongly, and the raw bytes are exactly what the signature covers.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import {
  HANDLED_EVENT,
  MAX_DELIVERY_BYTES,
  handleDelivery,
  readInbox,
  startReceiver,
} from "./webhookReceiver.ts";
import { DELIVERY_HEADER, DeliveryWindow, EVENT_HEADER, SIGNATURE_HEADER, sign } from "./webhookAuth.ts";
import { buildMessage } from "./endpoint.ts";
import { formatMessageComment } from "./wire.ts";

const SECRET = "receiver-test-secret";
const T0 = new Date("2026-10-24T12:00:00.000Z");

let dir: string;
let inboxPath: string;
let server: Server;
let base: string;

/** A delivery shaped the way GitHub shapes an `issue_comment` event. */
function payload(commentBody: string, commentId = 555): string {
  return JSON.stringify({
    action: "created",
    issue: { number: 13 },
    comment: { id: commentId, body: commentBody },
  });
}

async function deliver(
  body: string,
  over: Record<string, string> = {},
  path = "/nh-bridge",
): Promise<{ status: number; json: { result?: string } }> {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [SIGNATURE_HEADER]: sign(SECRET, body),
      [DELIVERY_HEADER]: `d-${Math.random().toString(36).slice(2)}`,
      [EVENT_HEADER]: HANDLED_EVENT,
      ...over,
    },
    body,
  });
  return { status: res.status, json: (await res.json()) as { result?: string } };
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "nh-receiver-"));
  inboxPath = join(dir, "inbox.jsonl");
  server = startReceiver({ secret: SECRET, inboxPath, path: "/nh-bridge", now: () => T0 });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(dir, { recursive: true, force: true });
});

describe("receiver · a genuine delivery reaches the inbox", () => {
  it("accepts a signed issue_comment carrying a message and queues its records", async () => {
    const msg = buildMessage("chatgpt", "claude-code", "from the receiving service", T0, 3600);
    const body = payload(formatMessageComment(msg, "from the receiving service"));
    const { status, json } = await deliver(body);
    expect(status).toBe(202);
    expect(json.result).toBe("accepted");

    const { lines, skipped } = readInbox(inboxPath);
    expect(skipped).toBe(0);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.comment_id).toBe(555);
    expect(lines[0]!.issue).toBe(13);
    expect(lines[0]!.body).toBe("from the receiving service");
    expect((lines[0]!.message as { id: string }).id).toBe(msg.id);
  });

  it("ordinary prose is accepted and deliberately NOT queued", async () => {
    // An inbox full of human comments would bury the records an endpoint is looking for.
    const { status, json } = await deliver(payload("Owner: looks good, proceed."));
    expect(status).toBe(200);
    expect(json.result).toBe("no_records");
    expect(readInbox(inboxPath).lines).toHaveLength(0);
  });

  it("an event we do not handle is a 200, so GitHub does not retry it forever", async () => {
    const { status, json } = await deliver(payload("x"), { [EVENT_HEADER]: "push" });
    expect(status).toBe(200);
    expect(json.result).toBe("ignored_event");
  });
});

describe("receiver · forgery and replay are refused", () => {
  it("REFUSES AN UNSIGNED DELIVERY — the whole reason the receiver authenticates", async () => {
    const body = payload("```nh-msg\n{}\n```");
    const res = await fetch(`${base}/nh-bridge`, {
      method: "POST",
      headers: { "content-type": "application/json", [DELIVERY_HEADER]: "d-1", [EVENT_HEADER]: HANDLED_EVENT },
      body,
    });
    expect(res.status).toBe(401);
    expect((await res.json() as { result: string }).result).toBe("missing_signature");
    expect(readInbox(inboxPath).lines).toHaveLength(0);
  });

  it("refuses a signature computed over a DIFFERENT body", async () => {
    const real = payload("the real comment");
    const res = await fetch(`${base}/nh-bridge`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [SIGNATURE_HEADER]: sign(SECRET, payload("a different comment")),
        [DELIVERY_HEADER]: "d-2",
        [EVENT_HEADER]: HANDLED_EVENT,
      },
      body: real,
    });
    expect(res.status).toBe(401);
    expect((await res.json() as { result: string }).result).toBe("bad_signature");
    expect(readInbox(inboxPath).lines).toHaveLength(0);
  });

  it("refuses a signature made with another secret", async () => {
    const body = payload("x");
    const res = await fetch(`${base}/nh-bridge`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [SIGNATURE_HEADER]: sign("not-the-secret", body),
        [DELIVERY_HEADER]: "d-3",
        [EVENT_HEADER]: HANDLED_EVENT,
      },
      body,
    });
    expect(res.status).toBe(401);
  });

  it("A REPLAYED DELIVERY IS QUEUED ONCE, and answers 200 so GitHub stops retrying", async () => {
    const msg = buildMessage("chatgpt", "claude-code", "replay me", T0, 3600);
    const body = payload(formatMessageComment(msg, "replay me"));
    const id = "d-fixed-delivery-id";
    const first = await deliver(body, { [DELIVERY_HEADER]: id });
    expect(first.status).toBe(202);
    const second = await deliver(body, { [DELIVERY_HEADER]: id });
    expect(second.status).toBe(200);
    expect(second.json.result).toBe("replayed_delivery");
    // The decisive assertion: the inbox grew ONCE.
    expect(readInbox(inboxPath).lines).toHaveLength(1);
  });

  it("refuses the wrong path and the wrong method without reading a body", async () => {
    expect((await deliver(payload("x"), {}, "/somewhere-else")).status).toBe(404);
    const get = await fetch(`${base}/nh-bridge`, { method: "GET" });
    expect(get.status).toBe(404);
  });
});

describe("receiver · the secret never leaves the process", () => {
  it("no response body contains the secret, on any path", async () => {
    // Including the refusals, which are the responses an attacker can most easily enumerate.
    const bodies: string[] = [];
    const msg = buildMessage("chatgpt", "claude-code", "x", T0, 3600);
    bodies.push(JSON.stringify((await deliver(payload(formatMessageComment(msg, "x")))).json));
    bodies.push(JSON.stringify((await deliver(payload("prose"))).json));
    const unsigned = await fetch(`${base}/nh-bridge`, { method: "POST", headers: { [DELIVERY_HEADER]: "d" }, body: "{}" });
    bodies.push(await unsigned.text());
    bodies.push(await (await fetch(`${base}/nope`, { method: "POST", body: "{}" })).text());
    for (const b of bodies) {
      expect(b).not.toContain(SECRET);
      // Nor a prefix long enough to matter.
      expect(b).not.toContain(SECRET.slice(0, 8));
    }
  });

  it("an absent secret refuses every delivery with a 500 that blames the server", async () => {
    // The most likely misconfiguration. It must not become a receiver that accepts everything.
    const window = new DeliveryWindow();
    const body = payload("x");
    const outcome = handleDelivery("", body, { [SIGNATURE_HEADER]: sign(SECRET, body), [DELIVERY_HEADER]: "d", [EVENT_HEADER]: HANDLED_EVENT }, window, T0);
    expect(outcome.status).toBe(500);
    expect(outcome.result).toBe("no_secret_configured");
    expect(outcome.line).toBeNull();
  });

  it("the runnable entry point refuses to start without the environment secret", async () => {
    // Asserted against `bridge-webhook-receiver.ts`, which is where the secret enters now that the command was
    // split out of this module. The guard follows the code it guards: pointing it at `receiver.ts` would
    // pass vacuously once the environment read moved, which is a guard that cannot fire.
    const { readFileSync } = await import("node:fs");
    const cli = readFileSync("scripts/coordination/bridge-webhook-receiver.ts", "utf8");
    expect(cli).toMatch(/NH_BRIDGE_WEBHOOK_SECRET/);
    expect(cli).toMatch(/Refusing to start an unauthenticated receiver/);
    // Read in exactly ONE place, so there is one way it can enter the process.
    expect(cli.match(/process\.env\.NH_BRIDGE_WEBHOOK_SECRET/g)).toHaveLength(1);
    // And the importable module reads no environment at all, so a test cannot be fooled by an ambient one.
    const mod = readFileSync("scripts/coordination/webhookReceiver.ts", "utf8").replace(/\/\/.*$/gm, "");
    expect(mod).not.toMatch(/process\.env/);
  });
});

describe("receiver · bounds and recovery", () => {
  it("refuses an oversized delivery rather than buffering it", () => {
    const window = new DeliveryWindow();
    const huge = "x".repeat(MAX_DELIVERY_BYTES + 1);
    const outcome = handleDelivery(SECRET, huge, { [SIGNATURE_HEADER]: sign(SECRET, huge), [DELIVERY_HEADER]: "d", [EVENT_HEADER]: HANDLED_EVENT }, window, T0);
    expect(outcome.status).toBe(413);
    expect(outcome.result).toBe("too_large");
  });

  it("a TRUNCATED last inbox line is skipped, not fatal", async () => {
    // Append-only JSONL can only be damaged at the end, by a crash mid-append. Refusing the whole file
    // would discard every record before it — the opposite choice from the ledger, for the opposite reason.
    const msg = buildMessage("chatgpt", "claude-code", "ok", T0, 3600);
    await deliver(payload(formatMessageComment(msg, "ok")));
    const { appendFileSync } = await import("node:fs");
    appendFileSync(inboxPath, '{"received_at":"2026-10-24T12:00:00.000Z","delive');
    const { lines, skipped } = readInbox(inboxPath);
    expect(lines).toHaveLength(1);
    expect(skipped).toBe(1);
  });

  it("a signed delivery whose JSON is malformed is a 400, not a crash", async () => {
    const bad = "{not json";
    const res = await fetch(`${base}/nh-bridge`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [SIGNATURE_HEADER]: sign(SECRET, bad),
        [DELIVERY_HEADER]: "d-bad",
        [EVENT_HEADER]: HANDLED_EVENT,
      },
      body: bad,
    });
    expect(res.status).toBe(400);
    expect((await res.json() as { result: string }).result).toBe("unparsable");
  });
});

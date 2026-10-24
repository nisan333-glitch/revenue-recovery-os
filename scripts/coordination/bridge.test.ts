// Falsifiers for the delivery core. Each rule that keeps an exchange honest is paired with a case that tries to
// break it: swap content under a stable id, acknowledge your own message, resurrect a dead one, or fail silently.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_RETRY,
  MSG_SCHEMA,
  RECEIPT_SCHEMA,
  acknowledge,
  backoffSeconds,
  nextAction,
  receive,
  recordAttempt,
  settle,
  undelivered,
  validateMessage,
  validateReceipt,
  type Ledger,
} from "./bridge.ts";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const T0 = new Date("2026-10-24T21:00:00Z");
const at = (secs: number) => new Date(T0.getTime() + secs * 1000);

function msg(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: MSG_SCHEMA,
    id: "msg-001",
    from: "claude-code",
    to: "chatgpt",
    in_reply_to: null,
    body_sha256: sha("hello"),
    created_at: "2026-10-24T20:59:00Z",
    expires_at: "2026-10-25T20:59:00Z",
    ...over,
  };
}

function rcpt(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: RECEIPT_SCHEMA,
    message_id: "msg-001",
    body_sha256: sha("hello"),
    received_by: "chatgpt",
    received_at: "2026-10-24T21:00:00Z",
    ...over,
  };
}

const empty: Ledger = Object.freeze({});
const withMsg = (over: Record<string, unknown> = {}) => receive(empty, msg(over), T0).ledger;

describe("validateMessage", () => {
  it("accepts a well-formed message", () => expect(validateMessage(msg(), T0).ok).toBe(true));

  const bad: Array<[string, Record<string, unknown>, RegExp]> = [
    ["unknown schema", { schema: "nh-msg/v2" }, /schema/],
    ["bad id", { id: "A B" }, /id is malformed/],
    ["short id", { id: "ab" }, /id is malformed/],
    ["unknown sender", { from: "mallory" }, /from/],
    ["unknown addressee", { to: "mallory" }, /to is not/],
    ["self-addressed", { to: "claude-code" }, /itself/],
    ["bad reply id", { in_reply_to: "!!" }, /in_reply_to/],
    ["replies to itself", { in_reply_to: "msg-001" }, /reply to itself/],
    ["short hash", { body_sha256: "abc" }, /body_sha256/],
    ["uppercase hash", { body_sha256: sha("hello").toUpperCase() }, /body_sha256/],
    ["created in the future", { created_at: "2026-10-24T21:00:01Z" }, /future/],
    ["not a UTC time", { created_at: "2026-10-24 20:59:00" }, /created_at/],
    ["expires before created", { expires_at: "2026-10-24T20:00:00Z" }, /after created_at/],
    ["expires equal created", { expires_at: "2026-10-24T20:59:00Z" }, /after created_at/],
    ["lifetime over seven days", { expires_at: "2026-11-30T20:59:00Z" }, /7-day/],
  ];
  for (const [name, over, re] of bad) {
    it(`refuses ${name}`, () => {
      const r = validateMessage(msg(over), T0);
      expect(r.ok).toBe(false);
      expect(r.errors.join(" | ")).toMatch(re);
    });
  }

  it("refuses unknown and missing fields (closed schema)", () => {
    expect(validateMessage({ ...msg(), body: "the text itself" }, T0).errors.join()).toMatch(/unknown field 'body'/);
    const { to: _to, ...rest } = msg();
    expect(validateMessage(rest, T0).errors.join()).toMatch(/missing field 'to'/);
  });

  it("refuses non-objects", () => {
    for (const x of [null, "x", 5, [], undefined]) expect(validateMessage(x, T0).ok).toBe(false);
  });
});

describe("receive · idempotency", () => {
  it("accepts a new message as pending with no attempts", () => {
    const r = receive(empty, msg(), T0);
    expect(r.outcome).toBe("accepted");
    expect(r.ledger["msg-001"]).toMatchObject({ state: "pending", attempts: 0, receipt: null });
  });

  it("the same message again is a duplicate and changes nothing", () => {
    const a = receive(empty, msg(), T0);
    const b = receive(a.ledger, msg(), T0);
    expect(b.outcome).toBe("duplicate");
    expect(b.ledger).toBe(a.ledger);
  });

  it("the same id with different content is a CONFLICT and the original is untouched", () => {
    const a = receive(empty, msg(), T0);
    const b = receive(a.ledger, msg({ body_sha256: sha("something else") }), T0);
    expect(b.outcome).toBe("conflict");
    expect(b.ledger).toBe(a.ledger);
    expect(b.ledger["msg-001"]?.message.body_sha256).toBe(sha("hello"));
  });

  it("the same id re-addressed is also a conflict", () => {
    const a = receive(empty, msg(), T0);
    expect(receive(a.ledger, msg({ to: "owner" }), T0).outcome).toBe("conflict");
  });

  it("a message that is already expired is rejected, not stored", () => {
    const r = receive(empty, msg({ created_at: "2026-10-23T00:00:00Z", expires_at: "2026-10-24T00:00:00Z" }), T0);
    expect(r.outcome).toBe("rejected");
    expect(Object.keys(r.ledger)).toHaveLength(0);
  });

  it("a rejected message leaves the ledger as it was", () => {
    const a = receive(empty, msg(), T0);
    const b = receive(a.ledger, msg({ id: "x" }), T0);
    expect(b.outcome).toBe("rejected");
    expect(b.ledger).toBe(a.ledger);
  });

  it("ids named like prototype members cannot reach inherited properties", () => {
    // `__proto__` and `toString` fail the id pattern. `constructor` is a legal id: it must be treated as an
    // ordinary new key, never as an existing entry inherited from Object.prototype.
    for (const id of ["__proto__", "toString"]) expect(receive(empty, msg({ id }), T0).outcome).toBe("rejected");
    const r = receive(empty, msg({ id: "constructor" }), T0);
    expect(r.outcome).toBe("accepted");
    expect(Object.prototype.hasOwnProperty.call(r.ledger, "constructor")).toBe(true);
    expect(acknowledge(empty, rcpt({ message_id: "constructor" }), T0).outcome).toBe("refused");
    expect(recordAttempt(empty, "constructor", T0)).toBe(empty);
  });

  it("does not mutate its input ledger", () => {
    const a = receive(empty, msg(), T0).ledger;
    const before = JSON.stringify(a);
    receive(a, msg({ id: "msg-002" }), T0);
    expect(JSON.stringify(a)).toBe(before);
    expect(Object.isFrozen(a)).toBe(true);
  });
});

describe("validateReceipt", () => {
  it("accepts a well-formed receipt", () => expect(validateReceipt(rcpt(), T0).ok).toBe(true));
  it("refuses a receipt from the future", () => {
    expect(validateReceipt(rcpt({ received_at: "2026-10-24T21:00:01Z" }), T0).errors.join()).toMatch(/future/);
  });
  it("is a closed schema", () => {
    expect(validateReceipt({ ...rcpt(), note: "x" }, T0).errors.join()).toMatch(/unknown field/);
  });
});

describe("acknowledge · who may confirm delivery", () => {
  it("the addressee delivers the message and the receipt is kept", () => {
    const r = acknowledge(withMsg(), rcpt(), T0);
    expect(r.outcome).toBe("delivered");
    expect(r.ledger["msg-001"]?.state).toBe("delivered");
    expect(r.ledger["msg-001"]?.receipt?.received_by).toBe("chatgpt");
  });

  it("THE SENDER CANNOT ACKNOWLEDGE ITS OWN MESSAGE", () => {
    const r = acknowledge(withMsg(), rcpt({ received_by: "claude-code" }), T0);
    expect(r.outcome).toBe("refused");
    expect(r.errors.join()).toMatch(/sender cannot acknowledge/);
    expect(r.ledger["msg-001"]?.state).toBe("pending");
  });

  it("a third party cannot acknowledge it either", () => {
    const r = acknowledge(withMsg(), rcpt({ received_by: "owner" }), T0);
    expect(r.outcome).toBe("refused");
    expect(r.errors.join()).toMatch(/not from the addressee/);
  });

  it("a receipt for different content is refused", () => {
    const r = acknowledge(withMsg(), rcpt({ body_sha256: sha("other") }), T0);
    expect(r.outcome).toBe("refused");
    expect(r.errors.join()).toMatch(/hash/);
  });

  it("a receipt for an unknown message is refused", () => {
    expect(acknowledge(empty, rcpt(), T0).outcome).toBe("refused");
  });

  it("a receipt that predates the message is refused", () => {
    const r = acknowledge(withMsg(), rcpt({ received_at: "2026-10-24T20:00:00Z" }), T0);
    expect(r.outcome).toBe("refused");
    expect(r.errors.join()).toMatch(/predates/);
  });

  it("a second receipt is idempotent and does not replace the first", () => {
    const first = acknowledge(withMsg(), rcpt(), T0);
    const second = acknowledge(first.ledger, rcpt({ received_at: "2026-10-24T21:00:00Z" }), at(30));
    expect(second.outcome).toBe("already_delivered");
    expect(second.ledger).toBe(first.ledger);
  });

  it("a LATE receipt does not resurrect an expired message", () => {
    const ledger = withMsg({ expires_at: "2026-10-24T21:05:00Z" });
    const r = acknowledge(ledger, rcpt({ received_at: "2026-10-24T21:06:00Z" }), at(6 * 60));
    expect(r.outcome).toBe("refused");
    expect(r.errors.join()).toMatch(/expired/);
    expect(settle(r.ledger["msg-001"]!, at(6 * 60)).state).toBe("expired");
  });

  it("a receipt does not resurrect a failed message", () => {
    let ledger = withMsg();
    for (let i = 0; i < DEFAULT_RETRY.maxAttempts; i++) ledger = recordAttempt(ledger, "msg-001", at(i * 4000));
    expect(ledger["msg-001"]?.state).toBe("failed");
    const r = acknowledge(ledger, rcpt(), at(30000));
    expect(r.outcome).toBe("refused");
    expect(r.errors.join()).toMatch(/failed/);
  });
});

describe("retry · bounded, and failure is visible", () => {
  it("backs off exponentially and caps", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((n) => backoffSeconds(n))).toEqual([60, 120, 240, 480, 960, 1920, 3600]);
    expect(backoffSeconds(40)).toBe(3600);
  });

  it("first action is send; then wait until the backoff elapses; then send again", () => {
    let ledger = withMsg();
    expect(nextAction(ledger["msg-001"]!, T0)).toEqual({ action: "send", attempt: 1 });
    ledger = recordAttempt(ledger, "msg-001", T0);
    const w = nextAction(ledger["msg-001"]!, at(30));
    expect(w).toEqual({ action: "wait", until: at(60).toISOString() });
    expect(nextAction(ledger["msg-001"]!, at(60))).toEqual({ action: "send", attempt: 2 });
  });

  it("after the maximum attempts the message is FAILED, visibly, and nothing more is sent", () => {
    let ledger = withMsg();
    let t = 0;
    for (let i = 0; i < DEFAULT_RETRY.maxAttempts; i++) {
      expect(nextAction(ledger["msg-001"]!, at(t)).action).toBe("send");
      ledger = recordAttempt(ledger, "msg-001", at(t));
      t += 3600;
    }
    const e = ledger["msg-001"]!;
    expect(e.state).toBe("failed");
    expect(e.attempts).toBe(DEFAULT_RETRY.maxAttempts);
    expect(nextAction(e, at(t))).toEqual({ action: "none", reason: "failed" });
    expect(undelivered(ledger, at(t))).toEqual([{ id: "msg-001", state: "failed", attempts: 5 }]);
  });

  it("nextAction refuses to send past the maximum even for an entry stored as pending (defence in depth)", () => {
    const e = { ...withMsg()["msg-001"]!, attempts: DEFAULT_RETRY.maxAttempts, lastAttemptAt: T0.toISOString() };
    expect(nextAction(e, at(5000))).toEqual({ action: "none", reason: "failed" });
  });

  it("a delivered message is never sent again", () => {
    const l = acknowledge(withMsg(), rcpt(), T0).ledger;
    expect(nextAction(l["msg-001"]!, at(9999))).toEqual({ action: "none", reason: "delivered" });
    expect(recordAttempt(l, "msg-001", at(9999))).toBe(l);
  });

  it("an expired message is reported as expired even though its stored state says pending", () => {
    const l = withMsg({ expires_at: "2026-10-24T21:05:00Z" });
    expect(l["msg-001"]?.state).toBe("pending");
    expect(nextAction(l["msg-001"]!, at(10 * 60))).toEqual({ action: "none", reason: "expired" });
    expect(undelivered(l, at(10 * 60))).toEqual([{ id: "msg-001", state: "expired", attempts: 0 }]);
  });

  it("recording an attempt on an unknown id changes nothing", () => {
    expect(recordAttempt(empty, "nope-1", T0)).toBe(empty);
  });

  it("undelivered lists only what did not arrive, sorted, and omits delivered messages", () => {
    let l = receive(empty, msg({ id: "msg-b" }), T0).ledger;
    l = receive(l, msg({ id: "msg-a" }), T0).ledger;
    l = receive(l, msg({ id: "msg-c" }), T0).ledger;
    l = acknowledge(l, rcpt({ message_id: "msg-c" }), T0).ledger;
    expect(undelivered(l, T0).map((u) => u.id)).toEqual(["msg-a", "msg-b"]);
  });
});

describe("an end-to-end exchange on the pure core: message -> receipt -> response", () => {
  it("a message is delivered by the addressee's receipt, and the response is a new message that replies to it", () => {
    let ledger = receive(empty, msg(), T0).ledger;
    ledger = recordAttempt(ledger, "msg-001", T0);
    ledger = acknowledge(ledger, rcpt(), at(5)).ledger;
    expect(ledger["msg-001"]?.state).toBe("delivered");

    const reply = msg({
      id: "msg-002", from: "chatgpt", to: "claude-code", in_reply_to: "msg-001", body_sha256: sha("understood"),
      created_at: "2026-10-24T21:00:05Z", expires_at: "2026-10-25T21:00:05Z",
    });
    const r = receive(ledger, reply, at(5));
    expect(r.outcome).toBe("accepted");
    // The reply is its own message: it needs ITS addressee's receipt, and the original sender's does not count for it.
    expect(acknowledge(r.ledger, rcpt({ message_id: "msg-002", body_sha256: sha("understood"), received_by: "chatgpt" }), at(6)).outcome).toBe("refused");
    const done = acknowledge(r.ledger, rcpt({ message_id: "msg-002", body_sha256: sha("understood"), received_by: "claude-code", received_at: "2026-10-24T21:00:06Z" }), at(6));
    expect(done.outcome).toBe("delivered");
    expect(undelivered(done.ledger, at(6))).toEqual([]);
  });
});

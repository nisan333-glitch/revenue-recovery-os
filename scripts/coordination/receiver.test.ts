// Falsifiers for the receiver. The receiver reads untrusted comment text and writes to a public issue with a
// write permission, so most cases here are attempts to make it say something it should not: record twice,
// accept an edited history, let the sender acknowledge itself, echo an @-mention, or fail silently.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MAX_API_ATTEMPTS,
  decide,
  handle,
  marker,
  renderReply,
  sanitize,
  withRetry,
  type Comment,
  type Deps,
  MAX_COMMENT_CHARS,
} from "./receiver.ts";
import { formatMessageComment } from "./wire.ts";

const T = "`".repeat(3);
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

let nextId = 1000;
const iso = (min: number) => new Date(Date.UTC(2026, 9, 25, 10, min, 0)).toISOString();

function comment(over: Partial<Comment> & { body: string }, min = 0): Comment {
  const t = iso(min);
  return { id: nextId++, created_at: t, updated_at: t, author_association: "OWNER", user_type: "User", ...over };
}

/** The unified wire format: an nh-msg envelope and a separate nh-body block (plain text bodies only). */
const wireBody = (record: unknown, text: string) =>
  `${T}nh-msg\n${JSON.stringify(record, null, 2)}\n${T}\n\n${T}nh-body\n${text}\n${T}`;

/** A message comment: envelope + body block, with a correct hash unless overridden. */
function msgComment(id: string, text: string, over: Record<string, unknown> = {}, min = 0, c: Partial<Comment> = {}): Comment {
  const record = {
    schema: "nh-msg/v1", id, from: "claude-code", to: "chatgpt", in_reply_to: null, body_sha256: sha(text),
    created_at: iso(min - 1), expires_at: iso(min + 600), ...over,
  };
  return comment({ body: wireBody(record, text), ...c }, min);
}

function receiptComment(id: string, text: string, by = "chatgpt", over: Record<string, unknown> = {}, min = 1): Comment {
  const record = { schema: "nh-receipt/v1", message_id: id, body_sha256: sha(text), received_by: by, received_at: iso(min), ...over };
  return comment({ body: `${T}nh-receipt\n${JSON.stringify(record)}\n${T}` }, min);
}

const kindOf = (all: Comment[], trigger: Comment) => decide(all, trigger.id, sha).receipt?.kind ?? null;

describe("the one wire format · envelope + separate nh-body", () => {
  it("reads the body from the nh-body block, verbatim", () => {
    const m = msgComment("msg-001", "hello there");
    const r = decide([m], m.id, sha).receipt;
    expect(r?.kind).toBe("message_recorded");
    expect(r?.body_sha256).toBe(sha("hello there"));
  });

  it("accepts exactly what wire.ts formats, including a body with its own fence, edge whitespace and blank lines", () => {
    const awkward = `  leading space matters\n${T}json\n{"a":1}\n${T}\n\ntrailing  `;
    const msg = {
      schema: "nh-msg/v1", id: "msg-009", from: "claude-code", to: "chatgpt", in_reply_to: null,
      body_sha256: sha(awkward), created_at: iso(-1), expires_at: iso(600),
    };
    const c = comment({ body: formatMessageComment(msg as never, awkward) });
    const r = decide([c], c.id, sha).receipt;
    expect(r?.kind).toBe("message_recorded");
    expect(r?.body_sha256).toBe(sha(awkward));
  });

  it("normalises CRLF, so a comment re-saved with CRLF line endings still matches an LF hash", () => {
    const m = msgComment("msg-001", "line one\nline two");
    const crlf = { ...m, body: m.body.replace(/\n/g, "\r\n") };
    expect(decide([crlf], crlf.id, sha).receipt?.kind).toBe("message_recorded");
  });

  it("the receiver re-checks the hash with its own injected function, so the two can never silently disagree", () => {
    const m = msgComment("msg-001", "hello");
    const r = decide([m], m.id, () => "0".repeat(64)).receipt;
    expect(r?.kind).toBe("message_rejected");
    expect(r?.errors.join()).toMatch(/does not match/);
  });

  it("a body that differs by one character is rejected, not recorded", () => {
    const m = msgComment("msg-001", "hello", { body_sha256: sha("hellp") });
    expect(decide([m], m.id, sha).receipt?.kind).toBe("message_rejected");
  });

  it("THE RETIRED TEXT-AS-BODY FORM IS REJECTED WITH A HINT, never guessed at", () => {
    const record = {
      schema: "nh-msg/v1", id: "msg-001", from: "claude-code", to: "chatgpt", in_reply_to: null,
      body_sha256: sha("hello"), created_at: iso(-1), expires_at: iso(600),
    };
    const legacy = comment({ body: `hello\n\n${T}nh-msg\n${JSON.stringify(record)}\n${T}` });
    const r = decide([legacy], legacy.id, sha).receipt;
    expect(r?.kind).toBe("message_rejected");
    expect(r?.errors.join()).toMatch(/nh-body/);
    expect(r?.errors.join()).toMatch(/retired/);
    // and it did not become a message: the same id can be sent properly afterwards
    const good = msgComment("msg-001", "hello", {}, 3);
    expect(kindOf([legacy, good], good)).toBe("message_recorded");
  });

  it("two nh-body blocks are refused, never resolved by taking the first", () => {
    const m = msgComment("msg-001", "hello");
    const dup = { ...m, body: `${m.body}\n\n${T}nh-body\nsomething else\n${T}` };
    const r = decide([dup], dup.id, sha).receipt;
    expect(r?.kind).toBe("message_rejected");
    expect(r?.errors.join()).toMatch(/exactly one/);
  });

  it("an nh-body block with no envelope is rejected visibly; a comment with no protocol fence is not", () => {
    const orphan = comment({ body: `${T}nh-body\nhello\n${T}` });
    expect(decide([orphan], orphan.id, sha).receipt?.kind).toBe("message_rejected");
    const prose = comment({ body: "I mentioned nh-msg and nh-body in passing" });
    expect(decide([prose], prose.id, sha).receipt).toBeNull();
  });
});

describe("sanitize", () => {
  it("removes anything that could form a mention, link, fence or markup", () => {
    const s = sanitize("unknown field '@octocat' <script>[x](http://e.example)`");
    expect(s).not.toMatch(/[@<>\[\]`]/);
    expect(s).not.toContain("://");
    expect(sanitize("see www.evil.example now")).not.toMatch(/www\./);
  });
  it("caps the length", () => expect(sanitize("a".repeat(1000)).length).toBe(200));
});

describe("decide · what the ledger says about a comment", () => {
  it("records a valid message", () => {
    const m = msgComment("msg-001", "hello");
    const r = decide([m], m.id, sha).receipt;
    expect(r?.kind).toBe("message_recorded");
    expect(r?.message_id).toBe("msg-001");
    expect(r?.body_sha256).toBe(sha("hello"));
    expect(r?.generated_by).toBe("github-actions");
  });

  it("a comment that is not part of the protocol produces NOTHING to post", () => {
    const c = comment({ body: "good morning" });
    expect(decide([c], c.id, sha).receipt).toBeNull();
  });

  it("a non-owner comment is ignored even if it looks like a message", () => {
    const m = msgComment("msg-001", "hello", {}, 0, { author_association: "NONE" });
    expect(decide([m], m.id, sha).receipt).toBeNull();
  });

  it("the same message again is a DUPLICATE and the same id with other content is a CONFLICT", () => {
    const a = msgComment("msg-001", "hello", {}, 0);
    const b = msgComment("msg-001", "hello", {}, 2);
    const c = msgComment("msg-001", "different text", {}, 4);
    expect(kindOf([a, b], b)).toBe("message_duplicate");
    expect(kindOf([a, b, c], c)).toBe("message_conflict");
  });

  it("a hash that does not match the text is rejected, not recorded", () => {
    const m = msgComment("msg-001", "hello", { body_sha256: sha("something else") });
    const r = decide([m], m.id, sha).receipt;
    expect(r?.kind).toBe("message_rejected");
    expect(r?.errors.join()).toMatch(/does not hash/);
  });

  it("a rejected message does not count: the same id can be sent properly afterwards", () => {
    const bad = msgComment("msg-001", "hello", { body_sha256: sha("x") }, 0);
    const good = msgComment("msg-001", "hello", {}, 2);
    expect(kindOf([bad, good], good)).toBe("message_recorded");
  });

  it("invalid JSON, two blocks and an oversized block are rejected", () => {
    const badJson = comment({ body: `${T}nh-msg\n{not json\n${T}\n${T}nh-body\ntext\n${T}` });
    expect(kindOf([badJson], badJson)).toBe("message_rejected");
    const two = comment({ body: `${T}nh-msg\n{}\n${T}\n${T}nh-receipt\n{}\n${T}` });
    expect(decide([two], two.id, sha).receipt?.errors.join()).toMatch(/separate comments/);
    const big = msgComment("msg-001", "text", { pad: "x".repeat(5000) });
    expect(kindOf([big], big)).toBe("message_rejected");
    expect(decide([big], big.id, sha).receipt?.errors.join()).toMatch(/size cap/);
  });

  it("an oversized comment that opens a protocol fence is REJECTED VISIBLY, not silently ignored", () => {
    const huge = comment({ body: `${T}nh-msg\n{}\n${T}\n${"x".repeat(MAX_COMMENT_CHARS + 5_000)}` });
    const r = decide([huge], huge.id, sha).receipt;
    expect(r?.kind).toBe("message_rejected");
    expect(r?.errors.join()).toMatch(/exceeds/);
  });

  it("an oversized comment with no protocol fence stays silent, and an oversized HISTORY comment is not replayed", () => {
    const prose = comment({ body: "x".repeat(MAX_COMMENT_CHARS + 5_000) });
    expect(decide([prose], prose.id, sha).receipt).toBeNull();
    const m = msgComment("msg-001", "x".repeat(MAX_COMMENT_CHARS + 1), {}, 0);
    const again = msgComment("msg-001", "hello", {}, 2);
    expect(kindOf([m, again], again)).toBe("message_recorded");
  });

  it("an expired message is rejected, judged at the comment's own time", () => {
    const m = msgComment("msg-001", "hello", { created_at: iso(-600), expires_at: iso(-300) });
    expect(kindOf([m], m)).toBe("message_rejected");
  });

  it("a message claiming a creation time after the comment is rejected", () => {
    const m = msgComment("msg-001", "hello", { created_at: iso(30), expires_at: iso(900) });
    expect(kindOf([m], m)).toBe("message_rejected");
  });
});

describe("decide · receipts", () => {
  it("the addressee's receipt delivers the message", () => {
    const m = msgComment("msg-001", "hello", {}, 0);
    const r = receiptComment("msg-001", "hello", "chatgpt", {}, 1);
    expect(kindOf([m, r], r)).toBe("delivered");
  });

  it("THE SENDER CANNOT ACKNOWLEDGE ITS OWN MESSAGE", () => {
    const m = msgComment("msg-001", "hello", {}, 0);
    const r = receiptComment("msg-001", "hello", "claude-code", {}, 1);
    const d = decide([m, r], r.id, sha).receipt;
    expect(d?.kind).toBe("receipt_refused");
    expect(d?.errors.join()).toMatch(/sender cannot acknowledge/);
  });

  it("a second receipt is already_delivered; a receipt for an unknown message or wrong hash is refused", () => {
    const m = msgComment("msg-001", "hello", {}, 0);
    const r1 = receiptComment("msg-001", "hello", "chatgpt", {}, 1);
    const r2 = receiptComment("msg-001", "hello", "chatgpt", {}, 2);
    expect(kindOf([m, r1, r2], r2)).toBe("already_delivered");
    const unknown = receiptComment("msg-999", "hello");
    expect(kindOf([m, unknown], unknown)).toBe("receipt_refused");
    const wrong = receiptComment("msg-001", "other text");
    expect(kindOf([m, wrong], wrong)).toBe("receipt_refused");
  });

  it("a receipt after the message expired does not revive it", () => {
    const m = msgComment("msg-001", "hello", { expires_at: iso(5) }, 0);
    const late = receiptComment("msg-001", "hello", "chatgpt", {}, 10);
    const d = decide([m, late], late.id, sha).receipt;
    expect(d?.kind).toBe("receipt_refused");
    expect(d?.errors.join()).toMatch(/expired/);
  });
});

describe("decide · history cannot be rewritten or forged", () => {
  it("an EDITED earlier message is not part of the ledger, so a receipt for it is refused", () => {
    const edited = msgComment("msg-001", "hello", {}, 0);
    edited.updated_at = iso(3); // edited after creation
    const r = receiptComment("msg-001", "hello", "chatgpt", {}, 5);
    expect(kindOf([edited, r], r)).toBe("receipt_refused");
  });

  it("an edited TRIGGERING comment is rejected", () => {
    const m = msgComment("msg-001", "hello", {}, 0);
    m.updated_at = iso(2);
    expect(decide([m], m.id, sha).receipt?.errors.join()).toMatch(/edited/);
  });

  it("comments from a non-owner are not replayed, so they cannot pre-register an id or a receipt", () => {
    const squat = msgComment("msg-001", "attacker text", {}, 0, { author_association: "NONE" });
    const real = msgComment("msg-001", "hello", {}, 2);
    expect(kindOf([squat, real], real)).toBe("message_recorded");
    const m = msgComment("msg-002", "hello", {}, 0);
    const forged = receiptComment("msg-002", "hello", "chatgpt", {}, 1);
    forged.author_association = "CONTRIBUTOR";
    const later = receiptComment("msg-002", "hello", "chatgpt", {}, 3);
    expect(kindOf([m, forged, later], later)).toBe("delivered");
  });

  it("only EARLIER comments shape a decision: a later duplicate never changes an earlier answer", () => {
    const a = msgComment("msg-001", "hello", {}, 0);
    const b = msgComment("msg-001", "hello", {}, 2);
    expect(kindOf([a, b], a)).toBe("message_recorded");
  });

  it("is deterministic: the same history gives byte-identical answers", () => {
    const m = msgComment("msg-001", "hello", {}, 0);
    const r = receiptComment("msg-001", "hello", "chatgpt", {}, 1);
    expect(JSON.stringify(decide([m, r], r.id, sha))).toBe(JSON.stringify(decide([r, m], r.id, sha)));
  });

  it("an unknown trigger id is an error, not a silent pass", () => {
    expect(() => decide([], 1, sha)).toThrow(/not among/);
  });
});

describe("the reply cannot be turned against its readers", () => {
  it("attacker-chosen field names and ids never reach the reply as mentions, links or fences", () => {
    const text = "hello";
    const record = {
      schema: "nh-msg/v1", id: "@octocat-and-[x](http://e.example)", from: "claude-code", to: "chatgpt", in_reply_to: null,
      body_sha256: sha(text), created_at: iso(-1), expires_at: iso(600), "@evil <b>": 1,
    };
    const c = comment({ body: wireBody(record, text) });
    const r = decide([c], c.id, sha).receipt!;
    const out = renderReply(r);
    expect(r.message_id).toBeNull();
    expect(out).not.toContain("@evil");
    expect(out).not.toContain("@octocat");
    expect(out).not.toContain("e.example");
    // exactly one fenced block in the reply, and it is the ledger receipt
    expect([...out.matchAll(/`{3}/g)]).toHaveLength(2);
    expect(out).toContain(`${T}nh-ledger-receipt`);
    expect(out).not.toContain(`${T}nh-msg`);
    expect(out).not.toContain(`${T}nh-receipt\n`);
  });

  it("the reply carries a marker for its own comment id", () => {
    const m = msgComment("msg-001", "hello");
    expect(renderReply(decide([m], m.id, sha).receipt!)).toContain(marker(m.id));
  });
});

function fakeDeps(over: Partial<Deps> = {}, comments: Comment[] = []) {
  const posted: string[] = [];
  const logs: string[] = [];
  const sleeps: number[] = [];
  const deps: Deps = {
    sha256: sha,
    sleep: async (ms) => { sleeps.push(ms); },
    log: (l) => { logs.push(l); },
    listComments: async () => [...comments, ...posted.map((body) => comment({ body, user_type: "Bot", author_association: "NONE" }))],
    postComment: async (body) => { posted.push(body); },
    ...over,
  };
  return { deps, posted, logs, sleeps };
}

describe("handle · idempotency, retry and visible failure", () => {
  it("posts exactly one reply; running the same job again posts nothing", async () => {
    const m = msgComment("msg-001", "hello");
    const f = fakeDeps({}, [m]);
    expect(await handle(m.id, f.deps)).toBe("posted");
    expect(f.posted).toHaveLength(1);
    expect(await handle(m.id, f.deps)).toBe("already_answered");
    expect(f.posted).toHaveLength(1);
  });

  it("a third party quoting the marker cannot suppress the reply", async () => {
    const m = msgComment("msg-001", "hello");
    const squat = comment({ body: marker(m.id), user_type: "User", author_association: "NONE" });
    const f = fakeDeps({}, [m, squat]);
    expect(await handle(m.id, f.deps)).toBe("posted");
  });

  it("a comment that is not a protocol message posts nothing", async () => {
    const c = comment({ body: "hi" });
    const f = fakeDeps({}, [c]);
    expect(await handle(c.id, f.deps)).toBe("ignored");
    expect(f.posted).toHaveLength(0);
  });

  it("retries a flaky API with doubling backoff and then succeeds", async () => {
    const m = msgComment("msg-001", "hello");
    let calls = 0;
    const f = fakeDeps({
      postComment: async (b) => { calls++; if (calls < 3) throw new Error("503"); f.posted.push(b); },
    }, [m]);
    expect(await handle(m.id, f.deps)).toBe("posted");
    expect(calls).toBe(3);
    expect(f.sleeps).toEqual([1000, 2000]);
    expect(f.logs.filter((l) => /attempt \d of 3 failed/.test(l))).toHaveLength(2);
  });

  it("when the API stays down the step FAILS (the job goes red) after a bounded number of attempts", async () => {
    const m = msgComment("msg-001", "hello");
    let calls = 0;
    const f = fakeDeps({ postComment: async () => { calls++; throw new Error("503 unavailable"); } }, [m]);
    await expect(handle(m.id, f.deps)).rejects.toThrow(/503/);
    expect(calls).toBe(MAX_API_ATTEMPTS);
    expect(f.posted).toHaveLength(0);
  });

  it("a listing failure is also surfaced, never treated as an empty issue", async () => {
    const f = fakeDeps({ listComments: async () => { throw new Error("500"); } });
    await expect(handle(1, f.deps)).rejects.toThrow(/500/);
  });

  it("withRetry returns the first success without sleeping", async () => {
    const f = fakeDeps();
    expect(await withRetry(async () => 7, f.deps, "x")).toBe(7);
    expect(f.sleeps).toEqual([]);
  });
});

describe("an exchange end to end on the receiver: message -> receipt -> response", () => {
  it("records a message, delivers it on the addressee's receipt, then records the reply as its own message", async () => {
    const m = msgComment("msg-001", "ping", {}, 0);
    const f = fakeDeps({}, [m]);
    expect(await handle(m.id, f.deps)).toBe("posted");
    expect(f.posted[0]).toContain("message_recorded");

    const r = receiptComment("msg-001", "ping", "chatgpt", {}, 2);
    const g = fakeDeps({}, [m, r]);
    await handle(r.id, g.deps);
    expect(g.posted[0]).toContain("delivered");

    const reply = msgComment("msg-002", "pong", { from: "chatgpt", to: "claude-code", in_reply_to: "msg-001" }, 4);
    const h = fakeDeps({}, [m, r, reply]);
    await handle(reply.id, h.deps);
    expect(h.posted[0]).toContain("message_recorded");
  });
});

// The workflow is configuration, and configuration is silently outgrown. Read with comments stripped so prose
// cannot satisfy a check.
describe("workflow wiring · .github/workflows/nh-receiver.yml", () => {
  const raw = readFileSync(".github/workflows/nh-receiver.yml", "utf8");
  const yml = raw.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");

  it("triggers only on issue_comment created, never on pull requests or pull_request_target", () => {
    expect(yml).toMatch(/\non:\n  issue_comment:\n    types: \[created\]/);
    expect(yml).not.toMatch(/\n  pull_request(_target)?:/);
    expect(yml).not.toMatch(/pull_request_target/);
    expect(yml).not.toMatch(/workflow_run|workflow_dispatch|\n  push:/);
  });

  it("the workflow token is empty and the job grants exactly contents: read and issues: write", () => {
    expect(yml).toMatch(/\npermissions: \{\}\n/);
    const jobPerms = yml.match(/\n    permissions:\n((?:      .+\n)+)/);
    expect(jobPerms).not.toBeNull();
    const lines = jobPerms![1]!.split("\n").filter(Boolean).map((l) => l.trim()).sort();
    expect(lines).toEqual(["contents: read", "issues: write"]);
    expect(yml).not.toMatch(/write-all|pull-requests:|actions:|packages:|id-token/);
  });

  it("is filtered to the owner's non-bot comments on issues, carrying a protocol block", () => {
    expect(yml).toContain("github.event.issue.pull_request == null");
    expect(yml).toContain("github.event.comment.author_association == 'OWNER'");
    expect(yml).toContain("github.event.comment.user.type != 'Bot'");
    expect(yml).toContain("nh-msg");
    expect(yml).toContain("nh-receipt");
  });

  it("never interpolates comment or issue text into a command, and checks out no event-supplied ref", () => {
    const run = yml.match(/run: (.+)/g) ?? [];
    for (const r of run) expect(r).not.toContain("${{");
    expect(yml).not.toMatch(/github\.event\.comment\.body\s*\}\}\s*$/m);
    expect(yml).not.toMatch(/github\.event\.issue\.(title|body)/);
    expect(yml).not.toMatch(/ref:\s*\$\{\{/);
    expect(yml).not.toMatch(/head_ref|head\.sha|pull_request\.head/);
  });

  it("serialises per issue without cancelling, pins every action to a SHA, swallows no exit and has a timeout", () => {
    expect(yml).toMatch(/concurrency:\n  group: nh-receiver-\$\{\{ github\.event\.issue\.number \}\}\n  cancel-in-progress: false/);
    for (const m of yml.matchAll(/uses:\s*(\S+)/g)) expect(m[1], m[1]).toMatch(/@[0-9a-f]{40}$/);
    expect(yml).not.toMatch(/continue-on-error|\|\|\s*true/);
    expect(yml).toMatch(/timeout-minutes: \d+/);
    expect(yml).toContain("persist-credentials: false");
  });

  it("carries an explicit, narrow allow-list of issues", () => {
    const m = yml.match(/NH_ALLOWED_ISSUES: "([0-9, ]+)"/);
    expect(m).not.toBeNull();
    expect(m![1]!.split(",").length).toBeLessThanOrEqual(3);
  });

  it("the entry point makes only GitHub API calls on the repository's own issue and holds no other secret", () => {
    const code = readFileSync("scripts/coordination/receive-comment.ts", "utf8").replace(/^\s*\/\/.*$/gm, "");
    expect(code).toContain("https://api.github.com");
    expect(code).not.toMatch(/child_process|eval\(|new Function|exec\(/);
    expect(code).not.toMatch(/process\.env\.(?!NH_|GH_TOKEN)/);
    expect([...code.matchAll(/\/repos\/\$\{repo\}\/issues\/\$\{issue\}\/comments/g)].length).toBe(2);
  });
});

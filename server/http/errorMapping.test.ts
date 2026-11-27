// THE ERROR MAPPER · the first test this module has ever had, and it exists because of a misreport.
//
// WHAT WENT WRONG. `registerErrorHandler` mapped ANY error whose message matched `/append-only/i` to a
// 409 `immutable_record` reading "Historical records are immutable; create a linked revision instead".
// The settlement ledger's digest-key refusal explains that the table "is append-only, so existing rows
// cannot be re-derived" — so the route refused correctly and then named the WRONG REMEDY: that
// condition needs a governed rebuild, and no linked revision can address it. Found by a Phase 5 test
// asserting the production route reports the fingerprint guard, not by reading this file.
//
// THE GENERAL LESSON, for the thirteenth recorded time: *a guard must read the construct it is asking
// about.* Every real database trigger raises with the PREFIX `append-only: ` — that is a construct. The
// bare word is prose, and several of our own messages legitimately contain it.
//
// WHY A UNIT TEST AND NOT ONLY THE ROUTE TEST. Measured: with the typed branch in place, restoring the
// loose regex leaves all 47 settlement tests GREEN, because the typed branch is matched FIRST. So the
// route test does not guard the tightening at all — it guards the typed branch. These cases are the
// only thing that can fail on the regex itself.
import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ConflictError, ForbiddenError, NotFoundError, registerErrorHandler, UnauthorizedError } from "./errors";
import { SettlementDigestKeyChangedError } from "../persistence/settlementLedgerStore";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;

beforeAll(async () => {
  app = Fastify();
  registerErrorHandler(app);
  app.get("/throw", async (req: { query: { kind?: string; msg?: string } }) => {
    const { kind, msg = "" } = req.query;
    switch (kind) {
      case "digest": throw new SettlementDigestKeyChangedError(msg);
      case "plain": throw new Error(msg);
      case "conflict": throw new ConflictError(msg);
      case "forbidden": throw new ForbiddenError(msg);
      case "notfound": throw new NotFoundError(msg);
      case "unauthorized": throw new UnauthorizedError(msg);
      default: return { ok: true };
    }
  });
  await app.ready();
});
afterAll(async () => { await app?.close(); });

const hit = async (kind: string, msg: string) => {
  const res = await app.inject({
    method: "GET", url: `/throw?kind=${kind}&msg=${encodeURIComponent(msg)}`,
  });
  return { code: res.statusCode, body: JSON.parse(res.body) as { error: string; message: string } };
};

// The exact text a real trigger raises — `nh_reject_mutation()` and its siblings all carry this prefix.
const TRIGGER = "append-only: UPDATE on Proof is rejected (historical records are immutable; create a linked revision instead)";
// Our own prose, which merely MENTIONS the property. This is the shape that was being misreported.
const PROSE = "no succeeded detection observation carrying this case's identity was found in the append-only task log";

describe("append-only mapping · the colon is the construct", () => {
  it("maps a real TRIGGER message to 409 immutable_record", async () => {
    const r = await hit("plain", TRIGGER);
    expect(r.code).toBe(409);
    expect(r.body.error).toBe("immutable_record");
  });

  it("does NOT map prose that merely mentions append-only — this is what the tightening buys", async () => {
    // THE CASE THAT CAN FAIL ON THE REGEX. Under the old `/append-only/i` this returned 409
    // `immutable_record`, telling a caller to create a linked revision for an error that has nothing
    // to do with immutability. It is now an honest 500: *reporting our own bug as something the caller
    // can fix is the NH-AX-1009 mistake* — and a wrong remedy is worse than a generic one.
    const r = await hit("plain", PROSE);
    expect(r.body.error).not.toBe("immutable_record");
    expect(r.code).toBe(500);
    // AND IT LEAKS NOTHING. The generic branch must not echo the message back.
    expect(r.body.message).toBe("An internal error occurred.");
    expect(JSON.stringify(r.body)).not.toContain("append-only");
  });

  it("the mention is not a near-miss of the prefix — asserted, so the two fixtures cannot converge", () => {
    // Without this, a later edit could make PROSE accidentally contain `append-only:` and the test
    // above would then be asserting nothing. *A test that cannot fail is not a control.*
    expect(TRIGGER).toContain("append-only:");
    expect(PROSE).toContain("append-only");
    expect(PROSE).not.toContain("append-only:");
  });
});

describe("the rotated settlement digest key is reported as ITSELF", () => {
  const MSG = "settlement ledger: the settlement digest key has changed for this boundary. "
    + "Refusing the claim; rotating this key requires a governed rebuild, not a deploy.";

  it("maps to 409 settlement_digest_key_changed and keeps the remedy", async () => {
    const r = await hit("digest", MSG);
    expect(r.code).toBe(409);
    expect(r.body.error).toBe("settlement_digest_key_changed");
    expect(r.body.error).not.toBe("immutable_record");
    expect(r.body.message).toMatch(/governed rebuild, not a deploy/);
  });

  it("is recognised by the class's own name, which is therefore part of the contract", () => {
    // The mapper keys on `name` so `errors.ts` imports nothing but Fastify types. That makes the name
    // load-bearing, so it is pinned here rather than left to be renamed silently.
    expect(new SettlementDigestKeyChangedError("x").name).toBe("SettlementDigestKeyChangedError");
    expect(new SettlementDigestKeyChangedError("x")).toBeInstanceOf(Error);
  });

  it("takes precedence over the append-only branch even when its message contains the trigger prefix", async () => {
    // ORDERING, asserted. The real message contains the bare word; this proves the typed branch wins
    // regardless, so the two branches cannot fight over a message that satisfies both.
    const r = await hit("digest", `${MSG} append-only: and a trigger-shaped tail`);
    expect(r.body.error).toBe("settlement_digest_key_changed");
  });
});

describe("the typed errors still map as they did — the control", () => {
  // Without these, a build that mapped EVERYTHING to 409 would satisfy the assertions above.
  it.each([
    ["unauthorized", 401, "unauthorized"],
    ["forbidden", 403, "forbidden"],
    ["notfound", 404, "not_found"],
    ["conflict", 409, "conflict"],
  ])("%s → %i", async (kind, code, error) => {
    const r = await hit(kind, "because");
    expect(r.code).toBe(code);
    expect(r.body.error).toBe(error);
    expect(r.body.message).toBe("because");
  });
});

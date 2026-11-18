// B3 · THE DERIVATION, EXERCISED STATE BY STATE.
//
// This is the function that replaced a boolean the proposing party supplied. Its whole value is that
// it is TOTAL and FAIL-CLOSED: every lifecycle state has an answer, every negative answer has its own
// code, and the state before any event is a refusal rather than a pass.
import { describe, expect, it } from "vitest";
import {
  SENDER_AUTHORITY_VERSION,
  senderAuthorityFromState,
  unregisteredSenderRefusal,
  type SenderAuthorityRefusal,
} from "./senderAuthority";
import {
  INSTITUTION_AUTHORITY_STATES,
  type InstitutionAuthorityState,
} from "./institutionAuthority";

const ID = "inst-under-test";

describe("exactly one state authorises, and it is VERIFIED", () => {
  it("VERIFIED authorises and names which institution did so", () => {
    const v = senderAuthorityFromState("VERIFIED", ID);
    expect(v).toEqual({ authorised: true, institutionId: ID });
  });

  it("EVERY other state refuses — derived from the state list, not hand-enumerated", () => {
    // A FIFTH STATE ADDED TO THE LIFECYCLE IS COVERED HERE ON THE DAY IT LANDS. Hand-listing the
    // refusing states would leave a new one untested and, worse, make the exhaustiveness claim false
    // while this file still passed.
    for (const state of INSTITUTION_AUTHORITY_STATES) {
      const v = senderAuthorityFromState(state, ID);
      if (state === "VERIFIED") {
        expect(v.authorised).toBe(true);
        continue;
      }
      expect(v.authorised, `${state} authorised a key`).toBe(false);
    }
  });

  it("the state BEFORE any event refuses — absence is not a pass", () => {
    // `institutionStateAt` answers `null` for an instant earlier than the institution existed. A
    // function that treated that as permissive would open every key in the register.
    const v = senderAuthorityFromState(null, ID);
    expect(v.authorised).toBe(false);
    if (v.authorised) throw new Error("unreachable");
    expect(v.code).toBe("KEY_INSTITUTION_NOT_REGISTERED");
  });
});

describe("the negative answers stay DISTINGUISHABLE", () => {
  it("each refusing state has its OWN code, with no two sharing one", () => {
    // THE POINT OF THE SLICE, measured rather than asserted. *No institution registered*, *registered
    // but unverified*, *authority withdrawn* and *identity in doubt* are four different positions with
    // four different remedies, and one code for all four would hide the only half of the answer that
    // says what to go and get.
    const codes = new Map<InstitutionAuthorityState | "null", SenderAuthorityRefusal>();
    for (const state of [...INSTITUTION_AUTHORITY_STATES, null]) {
      const v = senderAuthorityFromState(state, ID);
      if (v.authorised) continue;
      codes.set(state ?? "null", v.code);
    }
    expect(codes.size).toBe(4);
    expect(new Set(codes.values()).size).toBe(4);
    expect(codes.get("PROPOSED")).toBe("KEY_INSTITUTION_NOT_VERIFIED");
    expect(codes.get("WITHDRAWN")).toBe("KEY_INSTITUTION_AUTHORITY_WITHDRAWN");
    expect(codes.get("REVOKED_IDENTITY_DOUBTED")).toBe("KEY_INSTITUTION_IDENTITY_DOUBTED");
    expect(codes.get("null")).toBe("KEY_INSTITUTION_NOT_REGISTERED");
  });

  it("a doubted identity is NEVER reported as a withdrawal", () => {
    // THE HEAVIER FACT MUST NOT READ AS THE LIGHTER ONE. A withdrawal says we no longer rely on this
    // institution; a doubted identity says we are not sure who we were talking to, which raises a
    // question about everything it ever signed.
    const doubted = senderAuthorityFromState("REVOKED_IDENTITY_DOUBTED", ID);
    const withdrawn = senderAuthorityFromState("WITHDRAWN", ID);
    if (doubted.authorised || withdrawn.authorised) throw new Error("unreachable");
    expect(doubted.code).not.toBe(withdrawn.code);
    expect(doubted.detail).toMatch(/heavier than a withdrawal/);
    expect(doubted.detail).toMatch(/everything signed under its keys/);
  });

  it("every refusal explains itself, and none of them blames the data", () => {
    for (const state of [...INSTITUTION_AUTHORITY_STATES, null]) {
      const v = senderAuthorityFromState(state, ID);
      if (v.authorised) continue;
      expect(v.detail.length, `${state} refuses with no explanation`).toBeGreaterThan(60);
      // The institution is named, so an operator knows which record to go and look at.
      expect(v.detail).toContain(ID);
    }
  });
});

describe("the refusal that fires today", () => {
  it("is NOT_REGISTERED, because the institution register is empty", () => {
    // A PROPERTY OF THE EVIDENCE, NOT OF THIS CODE, and derived rather than written as prose: the
    // helper calls the real function with the real input a sender with no institution produces.
    expect(unregisteredSenderRefusal()).toBe("KEY_INSTITUTION_NOT_REGISTERED");
  });
});

describe("the module is pure and pinned", () => {
  it("imports nothing but a type", () => {
    const src = readSource();
    const imports = [...src.matchAll(/^import\s+(?:type\s+)?\{[^}]*\}\s+from\s+"([^"]+)";/gm)]
      .map((m) => m[1]!);
    expect(imports).toEqual(["./institutionAuthority"]);
    // A TYPE-ONLY IMPORT, so this file cannot reach a register, a clock or a database.
    expect(src).toMatch(/^import type \{ InstitutionAuthorityState \} from "\.\/institutionAuthority";$/m);
  });

  it("consults no clock and reads no environment", () => {
    const src = readSource();
    expect(src).not.toMatch(/new Date\(|Date\.now\(|process\.env/);
  });

  it("the version is pinned, because a change in what it permits is a new id", () => {
    expect(SENDER_AUTHORITY_VERSION).toBe("sender-auth-2026.1");
  });
});

function readSource(): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const { resolve } = require("node:path") as typeof import("node:path");
  return readFileSync(resolve(__dirname, "senderAuthority.ts"), "utf8");
}

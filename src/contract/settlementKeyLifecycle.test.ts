import { describe, expect, it } from "vitest";
import {
  SETTLEMENT_KEY_LIFECYCLE_VERSION,
  SETTLEMENT_KEY_STATES,
  SETTLEMENT_KEY_TRANSITIONS,
  compromiseAssessment,
  keyDeclaredConditionsComplete,
  keyRegistrationRefusals,
  stateAt,
  validAt,
  type KeyRegistrationEvidence,
  type SettlementKeyEvent,
  type SettlementKeyFacts,
} from "./settlementKeyLifecycle";

const FACTS: SettlementKeyFacts = Object.freeze({
  keyId: "k-bank-01",
  boundaryId: "b-alpha",
  sourceSystem: "acme-bank",
  sourceKind: "bank",
  publicKey: "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA\n-----END PUBLIC KEY-----\n",
  validFrom: "2026-01-01T00:00:00.000Z",
  validUntil: "2027-01-01T00:00:00.000Z",
});

const ev = (
  transition: SettlementKeyEvent["transition"],
  at: string,
  over: Partial<SettlementKeyEvent> = {},
): SettlementKeyEvent => ({
  transition, at, actorId: "a-1", actorRole: "steward", rationale: "because", ...over,
});

const PROPOSED = ev("PROPOSED", "2026-02-01T00:00:00.000Z", { actorId: "op-1", actorRole: "operator" });
const ACTIVATED = ev("ACTIVATED", "2026-02-02T00:00:00.000Z");
const LIVE = [PROPOSED, ACTIVATED];

describe("G1 · the state is DERIVED from the log, as of an instant", () => {
  it("is the positive control: an activated key reads ACTIVE after activation", () => {
    const v = stateAt(LIVE, "2026-03-01T00:00:00.000Z");
    expect(v).toEqual({ ok: true, state: "ACTIVE" });
  });

  it("reads DRAFT between proposal and activation — the state is a function of WHEN you ask", () => {
    expect(stateAt(LIVE, "2026-02-01T12:00:00.000Z")).toEqual({ ok: true, state: "DRAFT" });
  });

  it("reads null before the key existed, and null is not DRAFT", () => {
    expect(stateAt(LIVE, "2026-01-15T00:00:00.000Z")).toEqual({ ok: true, state: null });
  });

  it("refuses an empty log rather than assuming the best", () => {
    expect(stateAt([], "2026-03-01T00:00:00.000Z"))
      .toMatchObject({ ok: false, problem: "KEY_NEVER_PROPOSED" });
  });

  it("refuses a log that does not begin with a birth", () => {
    expect(stateAt([ACTIVATED], "2026-03-01T00:00:00.000Z"))
      .toMatchObject({ ok: false, problem: "KEY_ILLEGAL_TRANSITION" });
  });

  it("refuses a second PROPOSED: a key is born once and a change is a new key", () => {
    const twice = [PROPOSED, ev("PROPOSED", "2026-02-03T00:00:00.000Z")];
    expect(stateAt(twice, "2026-03-01T00:00:00.000Z"))
      .toMatchObject({ ok: false, problem: "KEY_PROPOSED_TWICE" });
  });

  it("refuses a second ACTIVATED: there is no resume", () => {
    const twice = [PROPOSED, ACTIVATED, ev("ACTIVATED", "2026-02-04T00:00:00.000Z")];
    expect(stateAt(twice, "2026-03-01T00:00:00.000Z"))
      .toMatchObject({ ok: false, problem: "KEY_ILLEGAL_TRANSITION" });
  });

  // THE LOG'S ORDER IS THE APPEND ORDER AND IS NOT REPAIRED. Sorting by `at` would be total and not
  // chronological, which is the defect the execution-event log already had.
  it("refuses an out-of-order log rather than silently sorting it", () => {
    const backwards = [PROPOSED, ev("ACTIVATED", "2026-01-15T00:00:00.000Z")];
    expect(stateAt(backwards, "2026-03-01T00:00:00.000Z"))
      .toMatchObject({ ok: false, problem: "KEY_LOG_OUT_OF_ORDER" });
  });

  it("refuses an unparseable event timestamp, and an unparseable question", () => {
    expect(stateAt([PROPOSED, ev("ACTIVATED", "whenever")], "2026-03-01T00:00:00.000Z"))
      .toMatchObject({ ok: false, problem: "KEY_EVENT_TIME_MALFORMED" });
    expect(stateAt(LIVE, "soon")).toMatchObject({ ok: false, problem: "KEY_EVENT_TIME_MALFORMED" });
  });

  // A LOG THAT BECOMES ILLEGAL LATER IS A BROKEN LOG NOW. Answering from its earlier prefix would
  // report a state derived from a record we have just established cannot be trusted.
  it("refuses the whole log even when the illegality is AFTER the instant asked about", () => {
    const broken = [PROPOSED, ACTIVATED, ev("ACTIVATED", "2026-06-01T00:00:00.000Z")];
    expect(stateAt(broken, "2026-03-01T00:00:00.000Z")).toMatchObject({ ok: false });
  });

  it("lets governance revoke a key that was already retired", () => {
    const log = [PROPOSED, ACTIVATED, ev("RETIRED", "2026-04-01T00:00:00.000Z"),
      ev("REVOKED_COMPROMISED", "2026-05-01T00:00:00.000Z", { exposureFrom: null })];
    expect(stateAt(log, "2026-06-01T00:00:00.000Z"))
      .toEqual({ ok: true, state: "REVOKED_COMPROMISED" });
  });

  it("keeps four states and four transitions, with no FROZEN and no INACTIVE", () => {
    expect([...SETTLEMENT_KEY_STATES]).toEqual(["DRAFT", "ACTIVE", "RETIRED", "REVOKED_COMPROMISED"]);
    expect([...SETTLEMENT_KEY_TRANSITIONS]).toEqual(["PROPOSED", "ACTIVATED", "RETIRED", "REVOKED_COMPROMISED"]);
    // RETIRED and REVOKED_COMPROMISED must never collapse: one says this key's work stands, the
    // other says its work is in question.
    expect(SETTLEMENT_KEY_STATES).not.toContain("INACTIVE");
    expect(SETTLEMENT_KEY_STATES).not.toContain("FROZEN");
    expect(SETTLEMENT_KEY_LIFECYCLE_VERSION).toBe("skl-2026.1");
  });
});

describe("G1 · validAt(issuedAt), never 'is it valid now'", () => {
  it("is the positive control: an attestation signed while ACTIVE and in-window is valid", () => {
    expect(validAt(FACTS, LIVE, "2026-03-01T00:00:00.000Z"))
      .toEqual({ valid: true, stateAtSigning: "ACTIVE" });
  });

  // THE PROPERTY THAT PROTECTS RULE 5. A key retired today must still verify what it signed while in
  // force, or re-verifying a frozen proof would answer differently from the day it was approved.
  it("still validates a signature from when the key was ACTIVE, after the key is RETIRED", () => {
    const retired = [...LIVE, ev("RETIRED", "2026-06-01T00:00:00.000Z")];
    expect(validAt(FACTS, retired, "2026-03-01T00:00:00.000Z").valid).toBe(true);
    // And refuses one signed after the retirement, by the same function.
    expect(validAt(FACTS, retired, "2026-07-01T00:00:00.000Z"))
      .toMatchObject({ valid: false, code: "SETTLEMENT_KEY_NOT_ACTIVE_AT_SIGNING" });
  });

  it("refuses a signature from before activation", () => {
    expect(validAt(FACTS, LIVE, "2026-02-01T12:00:00.000Z"))
      .toMatchObject({ valid: false, code: "SETTLEMENT_KEY_NOT_ACTIVE_AT_SIGNING" });
  });

  it("refuses a signature from before the key existed, with its own code", () => {
    expect(validAt(FACTS, LIVE, "2026-01-15T00:00:00.000Z"))
      .toMatchObject({ valid: false, code: "SETTLEMENT_KEY_NOT_YET_ACTIVE" });
  });

  // THE WINDOW AND THE STATE ARE INDEPENDENT FACTS, and the refusal must say which one failed.
  it("refuses a signature after validUntil as EXPIRED, distinct from unregistered", () => {
    const long = [...LIVE, ev("RETIRED", "2028-01-01T00:00:00.000Z")];
    const v = validAt(FACTS, long, "2027-06-01T00:00:00.000Z");
    expect(v).toMatchObject({ valid: false, code: "SETTLEMENT_KEY_EXPIRED" });
    if (v.valid) throw new Error("unreachable");
    expect(v.detail).toContain("validity window closed");
  });

  it("refuses a signature before validFrom, even with the key ACTIVE", () => {
    const early: SettlementKeyFacts = { ...FACTS, validFrom: "2026-05-01T00:00:00.000Z" };
    expect(validAt(early, LIVE, "2026-03-01T00:00:00.000Z"))
      .toMatchObject({ valid: false, code: "SETTLEMENT_KEY_BEFORE_VALID_FROM" });
  });

  it.each([
    ["validFrom unparseable", { validFrom: "whenever" }],
    ["validUntil unparseable", { validUntil: "later" }],
    ["window inverted", { validFrom: "2027-01-01T00:00:00.000Z", validUntil: "2026-01-01T00:00:00.000Z" }],
    ["window zero-length", { validFrom: "2026-01-01T00:00:00.000Z", validUntil: "2026-01-01T00:00:00.000Z" }],
  ])("refuses a malformed window (%s)", (_name, over) => {
    expect(validAt({ ...FACTS, ...over }, LIVE, "2026-03-01T00:00:00.000Z"))
      .toMatchObject({ valid: false, code: "SETTLEMENT_KEY_WINDOW_MALFORMED" });
  });

  it("refuses an unparseable signing instant", () => {
    expect(validAt(FACTS, LIVE, "yesterday"))
      .toMatchObject({ valid: false, code: "SETTLEMENT_KEY_WINDOW_MALFORMED" });
  });

  it("propagates a lifecycle problem rather than inventing a validity reason", () => {
    expect(validAt(FACTS, [], "2026-03-01T00:00:00.000Z"))
      .toMatchObject({ valid: false, code: "KEY_NEVER_PROPOSED" });
  });

  it("refuses a signature made while the key was REVOKED_COMPROMISED", () => {
    const revoked = [...LIVE, ev("REVOKED_COMPROMISED", "2026-04-01T00:00:00.000Z", { exposureFrom: null })];
    expect(validAt(FACTS, revoked, "2026-05-01T00:00:00.000Z"))
      .toMatchObject({ valid: false, code: "SETTLEMENT_KEY_NOT_ACTIVE_AT_SIGNING" });
  });
});

describe("G1 · retroactive compromise · unknown is NOT the revocation date", () => {
  const revokedKnown = [...LIVE,
    ev("REVOKED_COMPROMISED", "2026-08-01T00:00:00.000Z", { exposureFrom: "2026-05-01T00:00:00.000Z" })];
  const revokedUnknown = [...LIVE,
    ev("REVOKED_COMPROMISED", "2026-08-01T00:00:00.000Z", { exposureFrom: null })];

  it("is NOT_APPLICABLE when the key was never revoked as compromised", () => {
    expect(compromiseAssessment(LIVE, "2026-03-01T00:00:00.000Z"))
      .toMatchObject({ status: "NOT_APPLICABLE", exposureStartUnknown: false });
  });

  it("leaves an attestation signed before the exposure window UNAFFECTED", () => {
    expect(compromiseAssessment(revokedKnown, "2026-03-01T00:00:00.000Z"))
      .toMatchObject({ status: "UNAFFECTED", exposureFrom: "2026-05-01T00:00:00.000Z" });
  });

  it("flags an attestation at or after the exposure window", () => {
    expect(compromiseAssessment(revokedKnown, "2026-06-01T00:00:00.000Z").status)
      .toBe("FLAGGED_COMPROMISED_WINDOW");
    // AT the boundary, not merely after it.
    expect(compromiseAssessment(revokedKnown, "2026-05-01T00:00:00.000Z").status)
      .toBe("FLAGGED_COMPROMISED_WINDOW");
  });

  // THE RULE THAT MATTERS MOST. Defaulting an unknown start to the revocation date would clear every
  // attestation signed before 2026-08-01 — the flattering direction.
  it("flags EVERY attestation when the exposure start is UNKNOWN, including the earliest", () => {
    for (const at of ["2026-02-02T00:00:00.000Z", "2026-03-01T00:00:00.000Z", "2026-07-31T00:00:00.000Z"]) {
      const a = compromiseAssessment(revokedUnknown, at);
      expect(a.status).toBe("FLAGGED_COMPROMISED_WINDOW");
      expect(a.exposureStartUnknown).toBe(true);
      expect(a.exposureFrom).toBeNull();
    }
  });

  it("says in the detail why an unknown start is not the revocation date", () => {
    const a = compromiseAssessment(revokedUnknown, "2026-03-01T00:00:00.000Z");
    expect(a.detail).toContain("whole lifetime");
    expect(a.detail).toContain("defaulting to that date");
  });

  it("marks a measured flag apart from a conservative one", () => {
    expect(compromiseAssessment(revokedKnown, "2026-06-01T00:00:00.000Z").exposureStartUnknown).toBe(false);
    expect(compromiseAssessment(revokedUnknown, "2026-06-01T00:00:00.000Z").exposureStartUnknown).toBe(true);
  });

  it("fails CLOSED on an unparseable date: unparseable is not evidence of being outside the window", () => {
    expect(compromiseAssessment(revokedKnown, "sometime"))
      .toMatchObject({ status: "FLAGGED_COMPROMISED_WINDOW", exposureStartUnknown: true });
    const badStart = [...LIVE, ev("REVOKED_COMPROMISED", "2026-08-01T00:00:00.000Z", { exposureFrom: "nope" })];
    expect(compromiseAssessment(badStart, "2026-03-01T00:00:00.000Z").status)
      .toBe("FLAGGED_COMPROMISED_WINDOW");
  });

  it("an omitted exposureFrom is treated as UNKNOWN, not as absent-and-fine", () => {
    const omitted = [...LIVE, ev("REVOKED_COMPROMISED", "2026-08-01T00:00:00.000Z")];
    expect(compromiseAssessment(omitted, "2026-03-01T00:00:00.000Z"))
      .toMatchObject({ status: "FLAGGED_COMPROMISED_WINDOW", exposureStartUnknown: true });
  });
});

describe("G1 · K5 · control of a key is not the identity of its holder", () => {
  const ALL: KeyRegistrationEvidence = Object.freeze({
    channelIndependentlyVerified: true,
    keyControlDemonstrated: true,
    ceremonyRecorded: true,
  });

  it("is the positive control: every DECLARED condition is complete", () => {
    expect(keyRegistrationRefusals(ALL)).toEqual([]);
    expect(keyDeclaredConditionsComplete(ALL)).toBe(true);
  });

  // B3 · THE SHARPEST ASSERTION IN THIS FILE, AND IT IS NOW ABOUT WHAT THIS FUNCTION DOES NOT ANSWER.
  //
  // It used to read: all four declared conditions true ⇒ `keyMayBeActivated` is `true`. That sentence
  // was the defect in miniature — the institution's identity was one of the four booleans, so a
  // complete-looking tick list was the whole gate. The identity condition has left this type; what
  // these three establish is that the OPERATOR-DECLARED half is complete, and an activation needs the
  // institution register as well. A caller treating this as the whole answer would put a key in force
  // for a sender nobody has verified.
  it("complete DECLARED conditions do NOT mean a key may be activated", () => {
    expect(keyDeclaredConditionsComplete(ALL)).toBe(true);
    // Asserted on the union itself: there is no longer any institution refusal this function can
    // return, so no amount of reading it answers the institution question.
    expect(keyRegistrationRefusals(ALL).join(" ")).not.toMatch(/INSTITUTION/);
    const everyPossible: readonly string[] = [
      "KEY_CHANNEL_NOT_AUTHORITATIVE", "KEY_OWNERSHIP_NOT_DEMONSTRATED", "KEY_CEREMONY_RECORD_MISSING",
    ];
    const none: KeyRegistrationEvidence = {
      channelIndependentlyVerified: false, keyControlDemonstrated: false, ceremonyRecorded: false,
    };
    expect([...keyRegistrationRefusals(none)]).toEqual(everyPossible);
  });

  // THE OWNER'S CORRECTION, STILL STRUCTURAL. Anyone can generate a keypair and answer a nonce
  // challenge perfectly, so control may NEVER stand in for identity — and that is now enforced by the
  // identity living in a different governed object entirely rather than beside it as a peer boolean.
  it("refuses challenge-response ALONE, with the other declared conditions absent", () => {
    const alone: KeyRegistrationEvidence = {
      channelIndependentlyVerified: false,
      keyControlDemonstrated: true,
      ceremonyRecorded: false,
    };
    expect(keyDeclaredConditionsComplete(alone)).toBe(false);
    expect(keyRegistrationRefusals(alone)).toEqual([
      "KEY_CHANNEL_NOT_AUTHORITATIVE", "KEY_CEREMONY_RECORD_MISSING",
    ]);
  });

  it.each([
    ["channelIndependentlyVerified", "KEY_CHANNEL_NOT_AUTHORITATIVE"],
    ["keyControlDemonstrated", "KEY_OWNERSHIP_NOT_DEMONSTRATED"],
    ["ceremonyRecorded", "KEY_CEREMONY_RECORD_MISSING"],
  ])("refuses when %s is missing, each by its own code", (field, code) => {
    const one = { ...ALL, [field]: false } as KeyRegistrationEvidence;
    expect(keyRegistrationRefusals(one)).toEqual([code]);
  });

  // EVERY DECLARED FIELD IS COVERED, DERIVED FROM THE TYPE rather than counted by hand, so a fourth
  // declared condition added to `KeyRegistrationEvidence` and forgotten above fails here.
  it("the per-field cases cover every field of the evidence type", () => {
    expect(Object.keys(ALL).sort()).toEqual([
      "ceremonyRecorded", "channelIndependentlyVerified", "keyControlDemonstrated",
    ]);
  });

  // ALL OF THEM, NEVER A SUBSET: a registration blocked on two grounds must say so, or closing one
  // would look like closing both.
  it("reports every unmet condition rather than only the first", () => {
    const none: KeyRegistrationEvidence = {
      channelIndependentlyVerified: false,
      keyControlDemonstrated: false, ceremonyRecorded: false,
    };
    expect(keyRegistrationRefusals(none)).toHaveLength(3);
  });

  // B3 · THE RETIRED FIELD IS GONE FROM THE TYPE AND FROM THE REFUSAL UNION, asserted on the source
  // rather than inferred from a passing compile — a reader of this suite should be able to see that
  // the boolean is not merely unused but absent, and that no code in the union names it.
  it("neither the evidence type nor the refusal union mentions the retired boolean", () => {
    const src = readLifecycleSource();
    const typeBlock = src.slice(
      src.indexOf("export interface KeyRegistrationEvidence {"),
      src.indexOf("export type KeyRegistrationRefusal ="),
    );
    expect(typeBlock).not.toMatch(/readonly institutionIdentityVerified/);
    const unionBlock = src.slice(
      src.indexOf("export type KeyRegistrationRefusal ="),
      src.indexOf("export function keyRegistrationRefusals"),
    );
    expect(unionBlock).not.toMatch(/KEY_INSTITUTION_NOT_VERIFIED/);
  });
});

function readLifecycleSource(): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const { resolve } = require("node:path") as typeof import("node:path");
  return readFileSync(resolve(__dirname, "settlementKeyLifecycle.ts"), "utf8");
}

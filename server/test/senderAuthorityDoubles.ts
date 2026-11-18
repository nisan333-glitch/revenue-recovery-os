// B3 · TEST DOUBLES FOR THE SENDER-AUTHORITY PORT, and the rule about using them.
//
// `activateSettlementKey` now requires a `SenderAuthoritySource`. Most suites that activate a key are
// about something else — the key's own lifecycle, a settlement claim, a proof — and standing up two
// governed registers in each of them would test the wiring over and over while testing those subjects
// less well.
//
// SO THE DOUBLES EXIST, AND THE RULE THEY COME WITH IS NOT OPTIONAL:
//
//   A PERMISSIVE DOUBLE MAKES A GATE VACUOUS IN THAT SUITE. Any suite that uses `senderVerified()`
//   must also exercise `senderUnregistered()` or another refusing double, so the suite demonstrates
//   the gate exists rather than merely tolerating it. A suite in which every activation is authorised
//   proves nothing about activation at all — *a test that cannot fail is not a control.*
//
//   AND THE REAL COMPOSITION IS TESTED SOMEWHERE WITH NO DOUBLE AT ALL. `institutionSenderAuthority`
//   over the real Postgres institution register, with a real PROPOSE/VERIFY ceremony, is exercised in
//   `server/persistence/institutionRegister.postgres.test.ts`. If that ever stops being true, these
//   doubles are the only thing standing behind the gate, which is the situation they must never
//   create.
//
// THEY ARE DELIBERATELY DUMB. No boundary logic, no source-system matching, no state machine: a double
// that reimplemented the adapter would be a second implementation of the rule, and the one that
// disagreed would be the one the test believed.

import type { SenderAuthoritySource } from "../services/settlementKeyGovernance";
import type { SenderAuthorityRefusal } from "../../src/contract/senderAuthority";

/** A sender whose institution is VERIFIED. Use only alongside a refusing case in the same suite. */
export function senderVerified(institutionId = "inst-double-verified"): SenderAuthoritySource {
  return {
    async senderAuthority() {
      return Object.freeze({ authorised: true as const, institutionId });
    },
  };
}

/** The refusal that fires in production today, because the institution register is empty. */
export function senderUnregistered(): SenderAuthoritySource {
  return senderRefusing(
    "KEY_INSTITUTION_NOT_REGISTERED",
    "no institution is registered for this sender",
  );
}

/** Any named refusal, so a suite can assert the code reaches the caller verbatim. */
export function senderRefusing(
  code: SenderAuthorityRefusal,
  detail = "refused by a test double",
): SenderAuthoritySource {
  return {
    async senderAuthority() {
      return Object.freeze({ authorised: false as const, code, detail });
    },
  };
}

/**
 * Records what the gate asked, so a suite can assert the question is about the KEY'S OWN sender.
 *
 * THIS IS THE PROPERTY A PERMISSIVE DOUBLE WOULD OTHERWISE HIDE: the point of deriving the institution
 * is that the sender comes from the stored, witness-verified key row rather than from anything a
 * caller names. A double that answers `true` without recording the question cannot show that.
 */
export function senderVerifiedRecording(): SenderAuthoritySource & {
  readonly asked: { boundaryId: string; sourceSystem: string; at: string }[];
} {
  const asked: { boundaryId: string; sourceSystem: string; at: string }[] = [];
  return {
    asked,
    async senderAuthority(input) {
      asked.push({ ...input });
      return Object.freeze({ authorised: true as const, institutionId: "inst-double-recording" });
    },
  };
}

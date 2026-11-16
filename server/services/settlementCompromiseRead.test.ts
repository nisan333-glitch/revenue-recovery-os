// G6 · the governed read: the three gates, their ORDER, and the two statuses it must not collapse.
//
// NO DATABASE. Both halves of the join are ports, so the gates can be exercised without one — and
// what is being asserted here is authorization and composition, not storage. The storage half has its
// own Postgres suite.
import { describe, expect, it } from "vitest";
import {
  readSettlementCompromise,
  type SettlementArrivalReader,
} from "./settlementCompromiseRead";
import type { RegisteredSettlementKey, SettlementKeyRegister } from "./settlementKeyGovernance";
import { hashSettlementKey } from "../../src/contract/settlementKeyWitness";
import type { SettlementKeyEvent, SettlementKeyFacts } from "../../src/contract/settlementKeyLifecycle";
import type { ArrivalRestingOnKey } from "../../src/contract/settlementCompromiseReport";
import type { ActorContext } from "../auth/identity";

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
  exposureFrom?: string | null,
): SettlementKeyEvent =>
  Object.freeze({
    transition, actorId: "steward-1", actorRole: "steward", rationale: "r", at,
    ...(exposureFrom === undefined ? {} : { exposureFrom }),
  });

const LIVE = [ev("PROPOSED", "2026-01-01T00:00:00.000Z"), ev("ACTIVATED", "2026-01-02T00:00:00.000Z")];
const REVOKED = [...LIVE, ev("REVOKED_COMPROMISED", "2026-07-01T00:00:00.000Z", "2026-05-01T00:00:00.000Z")];

async function registerOf(
  events: readonly SettlementKeyEvent[],
  over: Partial<RegisteredSettlementKey> = {},
): Promise<SettlementKeyRegister> {
  const row: RegisteredSettlementKey = {
    facts: FACTS,
    witness: await hashSettlementKey(FACTS),
    evidence: {
      channelIndependentlyVerified: true, institutionIdentityVerified: true,
      keyControlDemonstrated: true, ceremonyRecorded: true,
    },
    registeredByActorId: "author-1",
    events,
    ...over,
  };
  return {
    read: async (keyId) => (keyId === FACTS.keyId ? row : null),
    insertKey: async () => { throw new Error("the compromise read must not write"); },
    appendEvent: async () => { throw new Error("the compromise read must not write"); },
  };
}

const arrivals = (...a: readonly ArrivalRestingOnKey[]): SettlementArrivalReader => ({
  enumerate: async () => Object.freeze({ available: true as const, arrivals: Object.freeze(a) }),
});

/** A ledger that is not there at all — the state a healthy deployment can legitimately be in. */
const noLedger: SettlementArrivalReader = {
  enumerate: async () => Object.freeze({
    available: false as const, reason: "ledger_not_provisioned" as const, detail: "not applied here",
  }),
};

const arrival = (ref: string, issuedAt: string | null): ArrivalRestingOnKey => Object.freeze({
  boundaryId: "b-alpha", claimRef: ref, settlementDigest: `sha256:${"a".repeat(64)}`,
  consumedAt: "2026-08-01T00:00:00.000Z", attestationIssuedAt: issuedAt,
});

const AUDITOR: ActorContext = { actorId: "verifier-1", role: "verifier", boundaryIds: ["b-alpha"] };
const NOW = "2026-09-01T00:00:00.000Z";

describe("G6 · readSettlementCompromise · the gates", () => {
  it("is the positive control: an AuditRead holder in the right boundary gets the report", async () => {
    const view = await readSettlementCompromise(
      await registerOf(REVOKED), arrivals(arrival("c1", "2026-06-01T00:00:00.000Z")),
      AUDITOR, "k-bank-01", NOW,
    );
    expect(view.report?.flagged).toBe(1);
    expect(view.arrivalsUnavailable).toBeNull();
    expect(view.stateNow).toBe("REVOKED_COMPROMISED");
    expect(view.recordIntegrity).toBe("WITNESS_VERIFIED");
  });

  it("refuses an actor without AuditRead — and the beneficiary roles are exactly the refused ones", async () => {
    // An `author`/`operator` is the party whose claim an arrival substantiates. They do not hold
    // AuditRead, so they cannot pull this report for themselves. Stated as a test rather than prose.
    for (const role of ["author", "operator"] as const) {
      await expect(
        readSettlementCompromise(
          await registerOf(REVOKED), arrivals(), { actorId: "x", role, boundaryIds: ["b-alpha"] },
          "k-bank-01", NOW,
        ),
      ).rejects.toThrow(/may not perform 'AuditRead'/);
    }
  });

  it("checks AuditRead BEFORE the register, so an unauthorized actor cannot probe which key ids exist", async () => {
    let reads = 0;
    const spying: SettlementKeyRegister = {
      read: async () => { reads += 1; return null; },
      insertKey: async () => undefined,
      appendEvent: async () => undefined,
    };
    await expect(
      readSettlementCompromise(spying, arrivals(), { actorId: "x", role: "author" }, "k-anything", NOW),
    ).rejects.toThrow(/AuditRead/);
    // THE ORDER IS THE ASSERTION. If the register were consulted first, the difference between a 404
    // and a 403 would answer "does this key exist" for someone entitled to neither answer.
    expect(reads).toBe(0);
  });

  it("404s an unknown key, and only after authorization has already passed", async () => {
    await expect(
      readSettlementCompromise(await registerOf(REVOKED), arrivals(), AUDITOR, "k-not-registered", NOW),
    ).rejects.toThrow(/is not registered/);
  });

  it("boundary-checks against the KEY'S OWN boundary, which no parameter can name", async () => {
    const otherTenant: ActorContext = { actorId: "v", role: "verifier", boundaryIds: ["b-beta"] };
    await expect(
      readSettlementCompromise(await registerOf(REVOKED), arrivals(), otherTenant, "k-bank-01", NOW),
    ).rejects.toThrow(/not authorized for this boundary/);
  });

  it("an actor with no boundaries at all is refused, not treated as unrestricted", async () => {
    await expect(
      readSettlementCompromise(
        await registerOf(REVOKED), arrivals(), { actorId: "v", role: "verifier" }, "k-bank-01", NOW,
      ),
    ).rejects.toThrow(/not authorized for this boundary/);
  });

  it("never writes: the register's write methods throw if touched", async () => {
    // The fake register's `insertKey`/`appendEvent` throw. A passing read proves neither was called.
    const view = await readSettlementCompromise(
      await registerOf(LIVE), arrivals(arrival("c1", "2026-03-01T00:00:00.000Z")), AUDITOR, "k-bank-01", NOW,
    );
    expect(view.report?.coverage).toBe("NO_COMPROMISE_DECLARED");
  });
});

describe("G6 · readSettlementCompromise · what it reports rather than refuses", () => {
  it("STILL ANSWERS when the witness fails, and says so — the read an incident needs most", async () => {
    // `resolveForUse` would refuse this row outright, correctly, because it must JUDGE nothing. This
    // read does not judge; refusing here would blind an investigator to the exposure of the very key
    // they have just found tampered with.
    const register = await registerOf(REVOKED, { witness: `sha256:${"f".repeat(64)}` });
    const view = await readSettlementCompromise(
      register, arrivals(arrival("c1", "2026-06-01T00:00:00.000Z")), AUDITOR, "k-bank-01", NOW,
    );
    expect(view.recordIntegrity).toBe("WITNESS_MISMATCH");
    expect(view.report?.flagged).toBe(1);
  });

  it("keeps WITNESS_VERIFIED and WITNESS_MISMATCH distinguishable on otherwise identical reads", async () => {
    const good = await readSettlementCompromise(
      await registerOf(REVOKED), arrivals(arrival("c1", "2026-06-01T00:00:00.000Z")), AUDITOR, "k-bank-01", NOW,
    );
    const bad = await readSettlementCompromise(
      await registerOf(REVOKED, { witness: `sha256:${"0".repeat(64)}` }),
      arrivals(arrival("c1", "2026-06-01T00:00:00.000Z")), AUDITOR, "k-bank-01", NOW,
    );
    expect(good.recordIntegrity).not.toBe(bad.recordIntegrity);
    // And the report itself is identical, because the arrivals live in a different append-only table
    // that this failure says nothing about.
    expect(bad.report).toEqual(good.report);
  });

  it("reports a malformed lifecycle log as a named problem AND still places the arrivals", async () => {
    // Two questions, answered separately and in that order — the shape G4 established. A log whose
    // ORDER cannot be trusted still carries a REVOKED_COMPROMISED event, and the arrivals must be
    // placed against it rather than lost behind a state derivation that failed.
    const outOfOrder = [
      ev("PROPOSED", "2026-01-01T00:00:00.000Z"),
      ev("ACTIVATED", "2026-01-02T00:00:00.000Z"),
      ev("REVOKED_COMPROMISED", "2026-07-01T00:00:00.000Z", "2026-05-01T00:00:00.000Z"),
      ev("RETIRED", "2026-02-01T00:00:00.000Z"),
    ];
    const view = await readSettlementCompromise(
      await registerOf(outOfOrder), arrivals(arrival("c1", "2026-06-01T00:00:00.000Z")),
      AUDITOR, "k-bank-01", NOW,
    );
    expect(view.stateNow).toBeNull();
    expect(view.stateProblem).toMatch(/KEY_LOG_OUT_OF_ORDER/);
    expect(view.report?.flagged).toBe(1);
  });

  it("carries the key's own boundary and source on the view, taken from the record", async () => {
    const view = await readSettlementCompromise(
      await registerOf(REVOKED), arrivals(), AUDITOR, "k-bank-01", NOW,
    );
    expect(view).toMatchObject({ boundaryId: "b-alpha", sourceSystem: "acme-bank", sourceKind: "bank" });
  });

  it("an unplaceable arrival reaches the view as NOT_ESTABLISHABLE, not as unaffected", async () => {
    const view = await readSettlementCompromise(
      await registerOf(REVOKED), arrivals(arrival("c1", null)), AUDITOR, "k-bank-01", NOW,
    );
    expect(view.report?.notEstablishable).toBe(1);
    expect(view.report?.unaffected).toBe(0);
    expect(view.report?.coverage).toBe("PARTIAL_SIGNING_INSTANT_MISSING");
  });

  it("an UNREACHABLE ledger yields report NULL and a named reason — never a zero-arrival report", async () => {
    // The failure this shape exists to prevent: "0 arrivals, 0 flagged" is success reported having
    // examined nothing, which is the one outcome worse than the tool not existing.
    const view = await readSettlementCompromise(
      await registerOf(REVOKED), noLedger, AUDITOR, "k-bank-01", NOW,
    );
    expect(view.report).toBeNull();
    expect(view.arrivalsUnavailable).toMatchObject({ reason: "ledger_not_provisioned" });
    // AND THE DECLARATION SURVIVES. An operator who cannot enumerate arrivals must still learn that
    // this key is revoked and what the window is.
    expect(view.compromise).toMatchObject({
      declared: true, revokedAt: "2026-07-01T00:00:00.000Z", exposureFrom: "2026-05-01T00:00:00.000Z",
    });
  });

  it("the declaration is reported identically whether or not the ledger is reachable", async () => {
    const withLedger = await readSettlementCompromise(
      await registerOf(REVOKED), arrivals(arrival("c1", "2026-06-01T00:00:00.000Z")), AUDITOR, "k-bank-01", NOW,
    );
    const without = await readSettlementCompromise(
      await registerOf(REVOKED), noLedger, AUDITOR, "k-bank-01", NOW,
    );
    expect(without.compromise).toEqual(withLedger.compromise);
  });
});

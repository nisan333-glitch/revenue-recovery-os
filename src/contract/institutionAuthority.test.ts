// K5 · falsifiers for institution authority, and for the one claim the whole module exists to refuse.
import { describe, expect, it } from "vitest";
import {
  CRYPTOGRAPHIC_CONDITIONS,
  INSTITUTION_AUTHORITY_CONDITIONS,
  INSTITUTION_AUTHORITY_STATES,
  INSTITUTION_AUTHORITY_VERSION,
  cryptographicEvidenceOnly,
  institutionAuthorityCeiling,
  institutionAuthorityRefusals,
  institutionMayBeVerified,
  institutionStateAt,
  signatureAloneLeavesRefusals,
  type InstitutionAuthorityEvent,
  type InstitutionAuthorityEvidence,
} from "./institutionAuthority";

const ALL_TRUE: InstitutionAuthorityEvidence = Object.freeze({
  legalEntityVerifiedIndependently: true,
  regulatoryStandingVerified: true,
  authorisedSignatoriesEstablished: true,
  channelIndependentlyVerified: true,
  keyControlDemonstrated: true,
  keyFingerprintConfirmedOutOfBand: true,
  ceremonyRecorded: true,
  secondPersonApproval: true,
});

const ev = (
  transition: InstitutionAuthorityEvent["transition"],
  at: string,
): InstitutionAuthorityEvent =>
  Object.freeze({ transition, actorId: `a-${transition}`, actorRole: "steward", rationale: "r", at });

const PROPOSED = [ev("PROPOSE", "2026-01-01T00:00:00.000Z")];
const VERIFIED = [...PROPOSED, ev("VERIFY", "2026-01-02T00:00:00.000Z")];
const NOW = "2026-06-01T00:00:00.000Z";

describe("K5 · a signature cannot verify an institution", () => {
  it("pins the version, because a change in what admission means is a new id", () => {
    expect(INSTITUTION_AUTHORITY_VERSION).toBe("inst-2026.1");
  });

  it("THE STRUCTURAL GUARANTEE: every cryptographic condition met still leaves refusals", () => {
    // THE CLAIM THIS MODULE EXISTS TO REFUSE, as a derivation rather than a sentence. If someone
    // promoted the cryptographic subset to cover the required set, this list would be empty.
    const outstanding = signatureAloneLeavesRefusals();
    expect(outstanding.length).toBeGreaterThan(0);
    expect(institutionMayBeVerified(cryptographicEvidenceOnly())).toBe(false);
  });

  it("the cryptographic subset is a STRICT subset — at least one condition no signature can reach", () => {
    expect(CRYPTOGRAPHIC_CONDITIONS.length).toBeGreaterThan(0);
    expect(CRYPTOGRAPHIC_CONDITIONS.length).toBeLessThan(INSTITUTION_AUTHORITY_CONDITIONS.length);
    for (const c of CRYPTOGRAPHIC_CONDITIONS) expect(INSTITUTION_AUTHORITY_CONDITIONS).toContain(c);
  });

  it("key control is the ONLY cryptographic condition, and the fingerprint check is NOT one", () => {
    // Confirming a fingerprint needs a SECOND CHANNEL, and a second channel is not a cryptographic
    // operation. Filing it as one would be the quiet way to make a signature nearly sufficient.
    expect([...CRYPTOGRAPHIC_CONDITIONS]).toEqual(["keyControlDemonstrated"]);
    expect(CRYPTOGRAPHIC_CONDITIONS).not.toContain("keyFingerprintConfirmedOutOfBand");
  });

  it("the outstanding refusals name the real-world checks, not more cryptography", () => {
    const outstanding = signatureAloneLeavesRefusals();
    expect(outstanding).toContain("INSTITUTION_LEGAL_ENTITY_NOT_VERIFIED");
    expect(outstanding).toContain("INSTITUTION_REGULATORY_STANDING_NOT_VERIFIED");
    expect(outstanding).toContain("INSTITUTION_SECOND_PERSON_APPROVAL_MISSING");
    expect(outstanding).not.toContain("INSTITUTION_KEY_CONTROL_NOT_DEMONSTRATED");
  });
});

describe("K5 · the admission bar", () => {
  it("the positive control: all eight conditions met may be verified", () => {
    expect(institutionAuthorityRefusals(ALL_TRUE)).toEqual([]);
    expect(institutionMayBeVerified(ALL_TRUE)).toBe(true);
  });

  it("reports EVERY unmet condition, never the first", () => {
    const none = Object.fromEntries(
      INSTITUTION_AUTHORITY_CONDITIONS.map((c) => [c, false]),
    ) as unknown as InstitutionAuthorityEvidence;
    expect(institutionAuthorityRefusals(none)).toHaveLength(INSTITUTION_AUTHORITY_CONDITIONS.length);
  });

  it("each condition on its own blocks admission — no condition is decorative", () => {
    for (const c of INSTITUTION_AUTHORITY_CONDITIONS) {
      const missing = { ...ALL_TRUE, [c]: false } as InstitutionAuthorityEvidence;
      expect(institutionMayBeVerified(missing), `${c} does not block admission`).toBe(false);
      expect(institutionAuthorityRefusals(missing)).toHaveLength(1);
    }
  });

  it("every condition has a distinct refusal code", () => {
    const codes = INSTITUTION_AUTHORITY_CONDITIONS.map(
      (c) => institutionAuthorityRefusals({ ...ALL_TRUE, [c]: false } as InstitutionAuthorityEvidence)[0]!,
    );
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe("K5 · the lifecycle", () => {
  it("four states, and WITHDRAWN never collapses into REVOKED_IDENTITY_DOUBTED", () => {
    // A relationship that ended raises no question about past attestations. An identity found to be in
    // doubt raises one about every attestation ever made. Different facts, different states.
    expect([...INSTITUTION_AUTHORITY_STATES])
      .toEqual(["PROPOSED", "VERIFIED", "WITHDRAWN", "REVOKED_IDENTITY_DOUBTED"]);
  });

  it("an empty log is NEVER_PROPOSED, not an optimistic default", () => {
    const v = institutionStateAt([], NOW);
    expect(v).toMatchObject({ ok: false, problem: "INSTITUTION_NEVER_PROPOSED" });
  });

  it("a log that does not begin with PROPOSE is refused", () => {
    expect(institutionStateAt([ev("VERIFY", "2026-01-02T00:00:00.000Z")], NOW))
      .toMatchObject({ ok: false, problem: "INSTITUTION_ILLEGAL_TRANSITION" });
  });

  it("a second PROPOSE is refused — an institution is admitted once", () => {
    expect(institutionStateAt([...PROPOSED, ev("PROPOSE", "2026-01-03T00:00:00.000Z")], NOW))
      .toMatchObject({ ok: false, problem: "INSTITUTION_PROPOSED_TWICE" });
  });

  it("an out-of-order log is REFUSED, never silently repaired", () => {
    const out = [...VERIFIED, ev("WITHDRAW", "2025-12-01T00:00:00.000Z")];
    expect(institutionStateAt(out, NOW))
      .toMatchObject({ ok: false, problem: "INSTITUTION_LOG_OUT_OF_ORDER" });
  });

  it("VERIFY may not be applied twice — there is no re-verify", () => {
    const twice = [...VERIFIED, ev("VERIFY", "2026-01-03T00:00:00.000Z")];
    expect(institutionStateAt(twice, NOW))
      .toMatchObject({ ok: false, problem: "INSTITUTION_ILLEGAL_TRANSITION" });
  });

  it("asking BEFORE verification reads PROPOSED, and the whole log is still validated", () => {
    // The two-walk property `stateAt` learned the hard way: legality belongs to the LOG, the derived
    // state to the QUESTION. A single variable reported an illegal transition on a well-formed log.
    expect(institutionStateAt(VERIFIED, "2026-01-01T12:00:00.000Z"))
      .toEqual({ ok: true, state: "PROPOSED" });
  });

  it("asking before the record existed reads null, not PROPOSED", () => {
    expect(institutionStateAt(VERIFIED, "2025-01-01T00:00:00.000Z")).toEqual({ ok: true, state: null });
  });

  it("governance may REVOKE an already-withdrawn institution — it must be able to say what it learned", () => {
    const log = [...VERIFIED, ev("WITHDRAW", "2026-03-01T00:00:00.000Z"),
      ev("REVOKE_IDENTITY_DOUBTED", "2026-04-01T00:00:00.000Z")];
    expect(institutionStateAt(log, NOW)).toEqual({ ok: true, state: "REVOKED_IDENTITY_DOUBTED" });
  });
});

describe("K5 · what authority an institution's attestation can carry", () => {
  it("AUTHORITY_VERIFIED only from a VERIFIED institution", () => {
    expect(institutionAuthorityCeiling(VERIFIED, NOW)).toMatchObject({
      ceiling: "AUTHORITY_VERIFIED", state: "VERIFIED",
    });
  });

  it("a PROPOSED institution carries NO authority, and the detail says why", () => {
    const v = institutionAuthorityCeiling(PROPOSED, NOW);
    expect(v.ceiling).toBe("AUTHORITY_UNVERIFIED");
    expect(v.detail).toMatch(/establishes control of a key and never the identity of its holder/);
  });

  it("WITHDRAWN and REVOKED both carry no authority, and stay distinguishable in the verdict", () => {
    const withdrawn = institutionAuthorityCeiling(
      [...VERIFIED, ev("WITHDRAW", "2026-03-01T00:00:00.000Z")], NOW,
    );
    const revoked = institutionAuthorityCeiling(
      [...VERIFIED, ev("REVOKE_IDENTITY_DOUBTED", "2026-03-01T00:00:00.000Z")], NOW,
    );
    expect(withdrawn.ceiling).toBe("AUTHORITY_UNVERIFIED");
    expect(revoked.ceiling).toBe("AUTHORITY_UNVERIFIED");
    expect(withdrawn.state).not.toBe(revoked.state);
  });

  it("AUTHORITY_VERIFIED IS HISTORICAL: an institution revoked later still carried it at the time", () => {
    // A frozen proof must reproduce forever. If this asked "is it verified NOW", re-reading a proof
    // after a revocation would answer differently from the day it was approved — rule 5.
    const log = [...VERIFIED, ev("REVOKE_IDENTITY_DOUBTED", "2026-05-01T00:00:00.000Z")];
    expect(institutionAuthorityCeiling(log, "2026-02-01T00:00:00.000Z").ceiling).toBe("AUTHORITY_VERIFIED");
    expect(institutionAuthorityCeiling(log, NOW).ceiling).toBe("AUTHORITY_UNVERIFIED");
  });

  it("a malformed log carries no authority and names the problem", () => {
    const v = institutionAuthorityCeiling([], NOW);
    expect(v.ceiling).toBe("AUTHORITY_UNVERIFIED");
    expect(v.detail).toMatch(/INSTITUTION_NEVER_PROPOSED/);
  });

  it("every verdict carries a detail, including at the top rung", () => {
    for (const log of [[], PROPOSED, VERIFIED]) {
      expect(institutionAuthorityCeiling(log, NOW).detail.length).toBeGreaterThan(30);
    }
  });
});

// ── The ladder's position, asserted so prose cannot drift from the flag ──────────────────────────

describe("K5 · THIRD_PARTY_RECONCILIATION stays unimplemented, and for the stated reason", () => {
  it("the channel that the settlement chain serves is NOT declared implemented", async () => {
    // The flag is what `availableNow` reads. Turning it true while no institution is verified would
    // announce a capability from a subset of the facts it needs — the `coverage.event` error, on the
    // one field where it would mean a bank's name standing behind a number nobody checked.
    const { PROVENANCE_CHANNELS } = await import("./sourceFactAuthority");
    const spec = PROVENANCE_CHANNELS.find((c) => c.channel === "THIRD_PARTY_RECONCILIATION")!;
    expect(spec.implemented).toBe(false);
    expect(spec.reaches).toBe("AUTHORITY_VERIFIED");
    expect(spec.submitterStillControls).toEqual([]);
  });

  it("no channel reaching AUTHORITY_VERIFIED is implemented — the top rung is unreachable today", async () => {
    const { PROVENANCE_CHANNELS } = await import("./sourceFactAuthority");
    const top = PROVENANCE_CHANNELS.filter((c) => c.reaches === "AUTHORITY_VERIFIED");
    expect(top.length).toBeGreaterThan(0);
    for (const c of top) expect(c.implemented, `${c.channel} claims the top rung`).toBe(false);
  });
});

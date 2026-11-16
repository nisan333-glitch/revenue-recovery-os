// G6 · the compromise report, and the four outcomes that must never collapse into each other.
import { describe, expect, it } from "vitest";
import {
  settlementCompromiseReport,
  SETTLEMENT_COMPROMISE_REPORT_VERSION,
  type ArrivalRestingOnKey,
} from "./settlementCompromiseReport";
import {
  SETTLEMENT_KEY_LIFECYCLE_VERSION,
  type SettlementKeyEvent,
} from "./settlementKeyLifecycle";

const gov = (
  transition: SettlementKeyEvent["transition"],
  at: string,
  exposureFrom?: string | null,
): SettlementKeyEvent =>
  Object.freeze({
    transition,
    actorId: `actor-${transition}`,
    actorRole: "steward",
    rationale: `because ${transition}`,
    at,
    ...(exposureFrom === undefined ? {} : { exposureFrom }),
  });

const LIVE: readonly SettlementKeyEvent[] = Object.freeze([
  gov("PROPOSED", "2026-01-01T00:00:00.000Z"),
  gov("ACTIVATED", "2026-01-02T00:00:00.000Z"),
]);

const arrival = (
  ref: string,
  issuedAt: string | null,
  consumedAt = "2026-06-01T00:00:00.000Z",
): ArrivalRestingOnKey =>
  Object.freeze({
    boundaryId: "b-1",
    claimRef: `claim-${ref}`,
    settlementDigest: `sha256:${ref.padEnd(64, "0").slice(0, 64)}`,
    consumedAt,
    attestationIssuedAt: issuedAt,
  });

describe("settlementCompromiseReport", () => {
  it("stamps both version ids, so a reader can tell which semantics produced the answer", () => {
    const r = settlementCompromiseReport("k-1", LIVE, []);
    expect(r.reportVersion).toBe(SETTLEMENT_COMPROMISE_REPORT_VERSION);
    expect(r.lifecycleVersion).toBe(SETTLEMENT_KEY_LIFECYCLE_VERSION);
  });

  // ── The four outcomes, each on its own ─────────────────────────────────────────────────────────

  it("an unrevoked key yields NOT_APPLICABLE and is explicitly NOT a finding of cleanliness", () => {
    const r = settlementCompromiseReport("k-1", LIVE, [arrival("a", "2026-03-01T00:00:00.000Z")]);
    expect(r.coverage).toBe("NO_COMPROMISE_DECLARED");
    expect(r.compromise.declared).toBe(false);
    expect(r.notApplicable).toBe(1);
    expect(r.flagged).toBe(0);
    expect(r.unaffected).toBe(0);
    expect(r.findings[0]!.status).toBe("NOT_APPLICABLE");
    // The sentence is the control: a reader must not take "0 flagged" for "checked and clean".
    expect(r.compromise.detail).toMatch(/ABSENCE of a declaration/);
    expect(r.compromise.detail).toMatch(/not a finding that the key's attestations are sound/);
  });

  it("an attestation signed before a stated exposure start is UNAFFECTED", () => {
    const events = [...LIVE, gov("REVOKED_COMPROMISED", "2026-07-01T00:00:00.000Z", "2026-05-01T00:00:00.000Z")];
    const r = settlementCompromiseReport("k-1", events, [arrival("a", "2026-03-01T00:00:00.000Z")]);
    expect(r.unaffected).toBe(1);
    expect(r.flagged).toBe(0);
    expect(r.coverage).toBe("COMPLETE");
    expect(r.findings[0]!.exposureStartUnknown).toBe(false);
  });

  it("an attestation signed at or after the exposure start is FLAGGED", () => {
    const events = [...LIVE, gov("REVOKED_COMPROMISED", "2026-07-01T00:00:00.000Z", "2026-05-01T00:00:00.000Z")];
    const exactlyAtTheBoundary = arrival("a", "2026-05-01T00:00:00.000Z");
    const r = settlementCompromiseReport("k-1", events, [exactlyAtTheBoundary, arrival("b", "2026-06-15T00:00:00.000Z")]);
    expect(r.flagged).toBe(2);
    expect(r.unaffected).toBe(0);
  });

  it("an UNKNOWN exposure start flags every placeable arrival, including ones long predating the revocation", () => {
    const events = [...LIVE, gov("REVOKED_COMPROMISED", "2026-07-01T00:00:00.000Z", null)];
    const r = settlementCompromiseReport("k-1", events, [arrival("a", "2026-01-03T00:00:00.000Z")]);
    expect(r.flagged).toBe(1);
    expect(r.unaffected).toBe(0);
    expect(r.findings[0]!.exposureStartUnknown).toBe(true);
    // THE RULE THAT MATTERS MOST: unknown is not the revocation date. Defaulting to it would have
    // cleared this arrival, which is the flattering direction.
    expect(r.compromise).toMatchObject({ declared: true, exposureFrom: null, exposureStartUnknown: true });
  });

  it("an omitted exposureFrom key is treated exactly as an explicit null, not as 'no window'", () => {
    const omitted = [...LIVE, gov("REVOKED_COMPROMISED", "2026-07-01T00:00:00.000Z")];
    const explicit = [...LIVE, gov("REVOKED_COMPROMISED", "2026-07-01T00:00:00.000Z", null)];
    const a = [arrival("a", "2026-02-01T00:00:00.000Z")];
    expect(settlementCompromiseReport("k", omitted, a).flagged)
      .toBe(settlementCompromiseReport("k", explicit, a).flagged);
    expect(settlementCompromiseReport("k", omitted, a).flagged).toBe(1);
  });

  // ── The fail-closed case, which is the whole reason the column exists ──────────────────────────

  it("a missing signing instant is NOT_ESTABLISHABLE — counted, never read as unaffected", () => {
    const events = [...LIVE, gov("REVOKED_COMPROMISED", "2026-07-01T00:00:00.000Z", "2026-05-01T00:00:00.000Z")];
    const r = settlementCompromiseReport("k-1", events, [arrival("a", null)]);
    expect(r.notEstablishable).toBe(1);
    expect(r.unaffected).toBe(0);
    expect(r.flagged).toBe(0);
    expect(r.coverage).toBe("PARTIAL_SIGNING_INSTANT_MISSING");
    expect(r.findings[0]!.status).toBe("NOT_ESTABLISHABLE");
  });

  it("consumedAt is NEVER used as a stand-in for the signing instant", () => {
    // The arrival was CONSUMED well inside the window, and has no recorded signing instant. If
    // `consumedAt` were substituted this would read FLAGGED — a conservative answer, and still the
    // wrong question answered. The honest answer is that it cannot be placed.
    const events = [...LIVE, gov("REVOKED_COMPROMISED", "2026-07-01T00:00:00.000Z", "2026-05-01T00:00:00.000Z")];
    const r = settlementCompromiseReport("k-1", events, [arrival("a", null, "2026-06-01T00:00:00.000Z")]);
    expect(r.findings[0]!.status).toBe("NOT_ESTABLISHABLE");
    expect(r.findings[0]!.status).not.toBe("FLAGGED_COMPROMISED_WINDOW");
  });

  it("a missing signing instant on an UNREVOKED key is NOT_APPLICABLE, not a reported gap", () => {
    // The absence only becomes a defect once a window exists to place the arrival in. Reporting it as
    // unplaceable here would report a gap in an answer nobody asked for.
    const r = settlementCompromiseReport("k-1", LIVE, [arrival("a", null)]);
    expect(r.notApplicable).toBe(1);
    expect(r.notEstablishable).toBe(0);
    expect(r.coverage).toBe("NO_COMPROMISE_DECLARED");
  });

  it("partial coverage survives even when most arrivals are placeable", () => {
    const events = [...LIVE, gov("REVOKED_COMPROMISED", "2026-07-01T00:00:00.000Z", "2026-05-01T00:00:00.000Z")];
    const r = settlementCompromiseReport("k-1", events, [
      arrival("a", "2026-01-05T00:00:00.000Z"),
      arrival("b", "2026-06-01T00:00:00.000Z"),
      arrival("c", null),
    ]);
    expect([r.unaffected, r.flagged, r.notEstablishable]).toEqual([1, 1, 1]);
    expect(r.coverage).toBe("PARTIAL_SIGNING_INSTANT_MISSING");
    expect(r.detail).toMatch(/PARTIAL/);
    expect(r.detail).toMatch(/must be resolved rather than read as unaffected/);
  });

  it("an unparseable signing instant FAILS CLOSED to flagged rather than slipping out of the window", () => {
    const events = [...LIVE, gov("REVOKED_COMPROMISED", "2026-07-01T00:00:00.000Z", "2026-05-01T00:00:00.000Z")];
    const r = settlementCompromiseReport("k-1", events, [arrival("a", "not-a-date")]);
    expect(r.flagged).toBe(1);
    expect(r.unaffected).toBe(0);
  });

  // ── Counts, totals and the empty case ─────────────────────────────────────────────────────────

  it("the four counts always sum to the number examined — nothing is dropped", () => {
    const events = [...LIVE, gov("REVOKED_COMPROMISED", "2026-07-01T00:00:00.000Z", "2026-05-01T00:00:00.000Z")];
    const arrivals = [
      arrival("a", "2026-01-05T00:00:00.000Z"),
      arrival("b", "2026-06-01T00:00:00.000Z"),
      arrival("c", null),
      arrival("d", "2026-05-01T00:00:00.000Z"),
    ];
    const r = settlementCompromiseReport("k-1", events, arrivals);
    expect(r.arrivalsExamined).toBe(4);
    expect(r.notApplicable + r.unaffected + r.flagged + r.notEstablishable).toBe(r.arrivalsExamined);
    expect(r.findings).toHaveLength(4);
  });

  it("zero arrivals is a statement about the LEDGER and says so — never an all-clear", () => {
    const events = [...LIVE, gov("REVOKED_COMPROMISED", "2026-07-01T00:00:00.000Z", "2026-05-01T00:00:00.000Z")];
    const r = settlementCompromiseReport("k-1", events, []);
    expect(r.arrivalsExamined).toBe(0);
    expect(r.flagged).toBe(0);
    expect(r.detail).toMatch(/statement about the ledger and not about the money/);
    expect(r.detail).toMatch(/unwired caller, a different database and a key that genuinely signed nothing/);
  });

  it("preserves the caller's order and does not re-sort by any timestamp", () => {
    // The ledger's append order (`seq`) is the only order anything recorded. Re-sorting by `at` would
    // be total rather than chronological — the execution-event log's defect.
    const events = [...LIVE, gov("REVOKED_COMPROMISED", "2026-07-01T00:00:00.000Z", "2026-05-01T00:00:00.000Z")];
    const out = settlementCompromiseReport("k-1", events, [
      arrival("late", "2026-06-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z"),
      arrival("early", "2026-01-05T00:00:00.000Z", "2026-02-01T00:00:00.000Z"),
    ]);
    expect(out.findings.map((f) => f.claimRef)).toEqual(["claim-late", "claim-early"]);
  });

  // ── What the report must never carry ──────────────────────────────────────────────────────────

  it("carries NO money anywhere in the returned object", () => {
    const events = [...LIVE, gov("REVOKED_COMPROMISED", "2026-07-01T00:00:00.000Z", "2026-05-01T00:00:00.000Z")];
    const r = settlementCompromiseReport("k-1", events, [arrival("a", "2026-06-01T00:00:00.000Z")]);
    const walk = (node: unknown, path: string): void => {
      if (typeof node === "string") {
        expect(node, `${path} contains a currency figure`).not.toMatch(/[$£€]\s?\d/);
        return;
      }
      if (Array.isArray(node)) {
        node.forEach((v, i) => walk(v, `${path}[${i}]`));
        return;
      }
      if (node !== null && typeof node === "object") {
        for (const [k, v] of Object.entries(node)) {
          expect(k, `${path}.${k} is a monetary key`).not.toMatch(
            /amount|minor|money|currency|collected|returned|recovered/i,
          );
          walk(v, `${path}.${k}`);
        }
      }
    };
    walk(r, "report");
  });

  it("states on the payload that flagging alters no proof", () => {
    const r = settlementCompromiseReport("k-1", LIVE, []);
    expect(r.flaggingDoesNotAlterProof).toMatch(/does not reverse, recompute or reduce any frozen proof/);
    expect(r.flaggingDoesNotAlterProof).toMatch(/no Revenue Returned figure changes/);
  });

  it("the report and every finding are frozen, so a caller cannot edit the answer it was given", () => {
    const events = [...LIVE, gov("REVOKED_COMPROMISED", "2026-07-01T00:00:00.000Z", null)];
    const r = settlementCompromiseReport("k-1", events, [arrival("a", "2026-02-01T00:00:00.000Z")]);
    expect(Object.isFrozen(r)).toBe(true);
    expect(Object.isFrozen(r.findings)).toBe(true);
    expect(Object.isFrozen(r.findings[0])).toBe(true);
    expect(Object.isFrozen(r.compromise)).toBe(true);
  });

  // ── A revocation applied to an already-retired key still reports ──────────────────────────────

  it("a key retired and LATER found compromised still reports its arrivals against the window", () => {
    // Governance may always still withdraw: a retired key can be discovered compromised afterwards,
    // and that discovery must reach the arrivals it signed while it was in force.
    const events = [
      ...LIVE,
      gov("RETIRED", "2026-04-01T00:00:00.000Z"),
      gov("REVOKED_COMPROMISED", "2026-08-01T00:00:00.000Z", "2026-02-01T00:00:00.000Z"),
    ];
    const r = settlementCompromiseReport("k-1", events, [
      arrival("before", "2026-01-10T00:00:00.000Z"),
      arrival("inside", "2026-03-01T00:00:00.000Z"),
    ]);
    expect([r.unaffected, r.flagged]).toEqual([1, 1]);
    expect(r.compromise).toMatchObject({ declared: true, revokedAt: "2026-08-01T00:00:00.000Z" });
  });
});

// The case lifecycle is DERIVED, and these tests attack the two things a derivation can get wrong:
// reporting a status the history does not support, and letting exposure be presented as recovered money.
import { describe, expect, it } from "vitest";
import {
  AUTHORITY_ACTIONS,
  CASE_PROGRESS_ORDER,
  deriveCaseLifecycle,
  observedExposure,
  provenRevenueReturned,
  unknownAuthorityActions,
  type AuthorityEntry,
  type CaseLifecycleInput,
  type ObservedExposure,
  type ProvenRevenueReturned,
} from "./caseLifecycle";
import { money } from "./money";

const ROOT = Object.freeze({
  recoveryCaseId: "RC-1",
  boundaryId: "b-1",
  sourceCandidateId: "ACT-abc",
  recoveryType: "ActivationMissed",
  sourceRef: "hmac-sha256:" + "a".repeat(64),
  detectorVersion: "activation-deadline-v1",
  openedByActorId: "op-1",
  openedByRole: "operator",
  openedAt: "2026-10-20T10:00:00.000Z",
  amountAtRiskMinor: 10_000,
  currency: "USD",
});

const at = (n: number) => `2026-10-20T10:0${n}:00.000Z`;
const ev = (action: string, n: number, actorId = "op-1", role = "operator"): AuthorityEntry =>
  Object.freeze({ action, actorId, role, at: at(n) });

const input = (over: Partial<CaseLifecycleInput> = {}): CaseLifecycleInput =>
  Object.freeze({
    root: ROOT,
    authority: [],
    baselineCount: 0,
    evidenceCount: 0,
    provenRevenueReturned: null,
    ...over,
  });

describe("case lifecycle · progress follows the history, nothing else", () => {
  it("1 · a promoted case with no history is OPENED, not OWNED and not PROVEN", () => {
    const l = deriveCaseLifecycle(input());
    expect(l.progress).toBe("OPENED");
    expect(l.responsible).toBeNull();
    expect(l.governance).toEqual([]);
    expect(l.trail).toEqual([]);
  });

  it("2 · each stage is reached only by its OWN evidence, across all four sources", () => {
    // The correction this module exists for: `EstablishBaseline`, `IngestEvidence` and `Approve` are NOT
    // in the authority ledger. A derivation reading only that ledger would call a fully proven case
    // OWNED, so each stage is driven by the table that actually records it.
    expect(deriveCaseLifecycle(input({ authority: [ev("Author", 1)] })).progress).toBe("OWNED");
    expect(deriveCaseLifecycle(input({ authority: [ev("Author", 1)], baselineCount: 1 })).progress).toBe("BASELINED");
    expect(
      deriveCaseLifecycle(input({ authority: [ev("Author", 1), ev("Intervene", 2)], baselineCount: 1 })).progress,
    ).toBe("INTERVENED");
    expect(
      deriveCaseLifecycle(input({ authority: [ev("Author", 1)], baselineCount: 1, evidenceCount: 2 })).progress,
    ).toBe("EVIDENCED");
    expect(
      deriveCaseLifecycle(
        input({
          authority: [ev("Author", 1)],
          baselineCount: 1,
          evidenceCount: 2,
          provenRevenueReturned: { amount: money(7_000, "USD"), proofIds: ["P-1"] },
        }),
      ).progress,
    ).toBe("PROVEN");
  });

  it("3 · an authority ledger ALONE never reaches BASELINED, EVIDENCED or PROVEN", () => {
    // The falsifier for the bug this module was written to avoid. Every authority action at once must
    // still leave progress at INTERVENED, because baseline, evidence and proof live elsewhere.
    const all = AUTHORITY_ACTIONS.map((a, i) => ev(a, i));
    expect(deriveCaseLifecycle(input({ authority: all })).progress).toBe("INTERVENED");
  });

  it("4 · governance markers are reported ALONGSIDE progress, never instead of it", () => {
    // A halt must make a case more inspectable, not less — `caseGuard.ts` says so. Collapsing a halted
    // proven case to "HALTED" would hide that it was proven.
    const l = deriveCaseLifecycle(
      input({
        authority: [ev("Author", 1), ev("Flag", 2), ev("Halt", 3), ev("Exclude", 4)],
        baselineCount: 1,
        evidenceCount: 1,
        provenRevenueReturned: { amount: money(7_000, "USD"), proofIds: ["P-1"] },
      }),
    );
    expect(l.progress).toBe("PROVEN");
    expect(l.governance).toEqual(["FLAGGED", "HALTED", "EXCLUDED"]);
  });

  it("5 · the responsible actor is the Author, and only the Author", () => {
    const l = deriveCaseLifecycle(input({ authority: [ev("Flag", 1, "steward-9", "steward"), ev("Author", 2, "op-7")] }));
    expect(l.responsible).toEqual({ actorId: "op-7", role: "operator" });
  });

  it("6 · an UNKNOWN action is kept in the trail, ignored for status, and reportable", () => {
    // The ledger is append-only and may carry an action a later build does not know. Refusing to render
    // the case would make the audit surface less available exactly where it matters; promoting on it
    // would be worse.
    const l = deriveCaseLifecycle(input({ authority: [ev("Author", 1), ev("Teleport", 2)] }));
    expect(l.progress).toBe("OWNED");
    expect(l.trail.map((t) => t.action)).toEqual(["Author", "Teleport"]);
    expect(unknownAuthorityActions([ev("Author", 1), ev("Teleport", 2)])).toEqual(["Teleport"]);
  });

  it("7 · tied timestamps make the TRAIL order uncertain and never change the status", () => {
    // `AuthorityEvent.at` is `@default(now())` with no append-sequence column — the shape the
    // execution-event slice measured at 4 ties in 40 trials. The status reads set membership, so it is
    // tie-proof; the trail's order is not, and says so instead of being silently resolved.
    const tied = [ev("Author", 1), ev("Intervene", 1)];
    const l = deriveCaseLifecycle(input({ authority: tied }));
    expect(l.trailOrderCertain).toBe(false);
    expect(l.progress).toBe("INTERVENED");
    expect(deriveCaseLifecycle(input({ authority: [...tied].reverse() })).progress).toBe("INTERVENED");
  });

  it("8 · it is PURE — same input, same answer, no clock", () => {
    const i = input({ authority: [ev("Author", 1)], baselineCount: 1 });
    expect(JSON.stringify(deriveCaseLifecycle(i))).toBe(JSON.stringify(deriveCaseLifecycle(i)));
    expect(CASE_PROGRESS_ORDER).toEqual(["OPENED", "OWNED", "BASELINED", "INTERVENED", "EVIDENCED", "PROVEN"]);
  });
});

describe("case lifecycle · the monetary separation is a MECHANISM, not a convention", () => {
  it("9 · exposure is always present; Revenue Returned is NULL when nothing is proven", () => {
    const l = deriveCaseLifecycle(input({ authority: [ev("Author", 1)], baselineCount: 1, evidenceCount: 3 }));
    expect(l.exposure).toEqual({ minor: 10_000, currency: "USD" });
    // NOT zero. A zero would assert a proof was found and established nothing.
    expect(l.revenueReturned).toBeNull();
    expect(l.exposureIsNotRecoveredRevenue).toBe(true);
  });

  it("10 · THE COMPILER REFUSES THE SWAP — checked by tsc, not by review", () => {
    const exposure: ObservedExposure = observedExposure(money(10_000, "USD"));
    const returned: ProvenRevenueReturned = provenRevenueReturned(money(7_000, "USD"), ["P-1"]);
    // @ts-expect-error exposure may never be presented as proven Revenue Returned
    const bad1: ProvenRevenueReturned = exposure;
    // @ts-expect-error proven Revenue Returned is not an at-risk figure either; the brands are not aliases
    const bad2: ObservedExposure = returned;
    // @ts-expect-error a bare Money cannot be laundered into the proven ledger without naming a proof
    const bad3: ProvenRevenueReturned = money(7_000, "USD");
    expect([bad1, bad2, bad3].length).toBe(3);
    expect(exposure.minor).toBe(10_000);
    expect(returned.minor).toBe(7_000);
  });

  it("11 · minting proven revenue REQUIRES naming a proof", () => {
    expect(() => provenRevenueReturned(money(7_000, "USD"), [])).toThrow(/requires every proof/);
    expect(() => provenRevenueReturned(money(7_000, "USD"), ["   "])).toThrow(/requires every proof/);
    // ...and the refusal is not a zero. "No proof found" and "a proof found nothing" are different claims.
    expect(() => provenRevenueReturned(money(0, "USD"), [])).toThrow();
  });

  it("12 · a proven case carries BOTH figures, separately, and they are not equal by construction", () => {
    const l = deriveCaseLifecycle(
      input({
        authority: [ev("Author", 1)],
        baselineCount: 1,
        evidenceCount: 1,
        provenRevenueReturned: { amount: money(7_000, "USD"), proofIds: ["P-1"] },
      }),
    );
    expect(l.exposure.minor).toBe(10_000);
    expect(l.revenueReturned?.minor).toBe(7_000);
    // The headline the constitution forbids blending: they are two fields, never one.
    expect(l.exposure.minor).not.toBe(l.revenueReturned?.minor);
  });
});

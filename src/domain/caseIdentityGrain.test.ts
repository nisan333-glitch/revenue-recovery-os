// What the grain disclosure must say, and the one value it must never be able to say.
import { describe, it, expect } from "vitest";
import {
  deriveCaseIdentityGrain,
  refusesObligationLevelGuarantee,
  ACCOUNT_GRAINED_HEADLINE,
  ABSORBED_HEADLINE,
  type CaseIdentityGrainInput,
} from "./caseIdentityGrain";
import {
  leakInstanceIdentityStatus,
  LEAK_INSTANCE_IDENTITY_UNAVAILABLE_DETAIL,
  OBLIGATION_IDENTITY_FIELDS,
} from "../contract/leakInstanceIdentity";

/** The real production inputs, not values this test chose. */
const live = (over: Partial<CaseIdentityGrainInput> = {}): CaseIdentityGrainInput => ({
  obligationIdentityEstablishable: leakInstanceIdentityStatus().establishable,
  identityRefusalDetail: LEAK_INSTANCE_IDENTITY_UNAVAILABLE_DETAIL,
  absorbedObservations: { checked: false },
  ...over,
});

describe("case identity grain · the disclosure", () => {
  it("1 · on the REAL contract the answer is account-grained and may cover several obligations", () => {
    // Driven by `leakInstanceIdentityStatus()` itself, so this is the product's answer and not a fixture's.
    expect(OBLIGATION_IDENTITY_FIELDS).toHaveLength(0);
    const d = deriveCaseIdentityGrain(live());
    expect(d.grain).toBe("ACCOUNT_GRAINED_POTENTIAL");
    expect(d.mayCoverMultipleObligations).toBe(true);
    expect(d.obligationUniquenessGuaranteed).toBe(false);
    expect(d.headline).toBe(ACCOUNT_GRAINED_HEADLINE);
  });

  it("2 · the reason is the CONTRACT's sentence, not one authored here", () => {
    // `LEAK_INSTANCE_IDENTITY_UNAVAILABLE_DETAIL` exists "so callers do not invent wording of their own".
    expect(deriveCaseIdentityGrain(live()).reason).toBe(LEAK_INSTANCE_IDENTITY_UNAVAILABLE_DETAIL);
  });

  it("3 · NOT CHECKED is not NONE — the two are different facts and stay apart", () => {
    const notChecked = deriveCaseIdentityGrain(live({ absorbedObservations: { checked: false } }));
    const checkedNone = deriveCaseIdentityGrain(live({ absorbedObservations: { checked: true, count: 0 } }));
    // Both are POTENTIAL — finding nothing does not promote the state — but a reader can tell which is
    // which, because reporting "none found" when nobody looked asserts work that never happened.
    expect(notChecked.grain).toBe("ACCOUNT_GRAINED_POTENTIAL");
    expect(checkedNone.grain).toBe("ACCOUNT_GRAINED_POTENTIAL");
    expect(notChecked.absorbedObservations).toEqual({ checked: false });
    expect(checkedNone.absorbedObservations).toEqual({ checked: true, count: 0 });
    expect(notChecked.absorbedObservations).not.toEqual(checkedNone.absorbedObservations);
  });

  it("4 · RECORDED absorption is a different state from POTENTIAL, on different evidence", () => {
    const d = deriveCaseIdentityGrain(live({ absorbedObservations: { checked: true, count: 2 } }));
    expect(d.grain).toBe("ABSORBED_OBSERVATIONS_RECORDED");
    expect(d.headline).toBe(ABSORBED_HEADLINE);
    // It still refuses the obligation claim: an absorbed OBSERVATION is not a proven second OBLIGATION.
    expect(d.obligationUniquenessGuaranteed).toBe(false);
    expect(d.headline).toMatch(/cannot be established from the recorded data/);
  });

  it("5 · THE GUARANTEED STATE IS UNREACHABLE on this build", () => {
    // The negative control for the whole slice. The only way in is obligation identity being establishable,
    // and the contract makes that false everywhere — so no production input can produce it.
    expect(leakInstanceIdentityStatus().establishable).toBe(false);
    for (const absorbed of [
      { checked: false } as const,
      { checked: true, count: 0 } as const,
      { checked: true, count: 9 } as const,
    ]) {
      expect(deriveCaseIdentityGrain(live({ absorbedObservations: absorbed })).grain).not.toBe(
        "OBLIGATION_UNIQUENESS_GUARANTEED",
      );
    }
  });

  it("6 · and it is reachable ONLY by the contract changing — proved by forcing the input", () => {
    // Not a way around the guard: this asserts WHICH fact controls the branch, so a future reader knows
    // the state is withheld because of the contract and not because of a hardcoded `false`.
    const forced = deriveCaseIdentityGrain(live({ obligationIdentityEstablishable: true }));
    expect(forced.grain).toBe("OBLIGATION_UNIQUENESS_GUARANTEED");
    expect(forced.mayCoverMultipleObligations).toBe(false);
  });

  it("7 · FAILS CLOSED · any action needing a per-obligation guarantee is refused today", () => {
    const refused = refusesObligationLevelGuarantee(deriveCaseIdentityGrain(live()));
    expect(refused.permitted).toBe(false);
    expect(refused.refusal).toMatch(/requires a guarantee that one case is one obligation/);
    // The refusal carries the contract's reason, so the caller is told what to go and change.
    expect(refused.refusal).toContain(LEAK_INSTANCE_IDENTITY_UNAVAILABLE_DETAIL);
  });

  it("8 · the refusal asks about the GUARANTEE, not about a list of known actions", () => {
    // A list would have to be remembered; a predicate over the guarantee refuses a future action by
    // default. Permitted only in the state this build cannot reach.
    expect(refusesObligationLevelGuarantee(
      deriveCaseIdentityGrain(live({ obligationIdentityEstablishable: true })),
    ).permitted).toBe(true);
    expect(refusesObligationLevelGuarantee(
      deriveCaseIdentityGrain(live({ absorbedObservations: { checked: true, count: 5 } })),
    ).permitted).toBe(false);
  });

  it("9 · no headline claims recovered revenue, and none renders a zero figure", () => {
    for (const d of [
      deriveCaseIdentityGrain(live()),
      deriveCaseIdentityGrain(live({ absorbedObservations: { checked: true, count: 3 } })),
    ]) {
      expect(d.headline).not.toMatch(/\$/);
      expect(d.headline).not.toMatch(/recovered|returned|proven/i);
    }
  });
});

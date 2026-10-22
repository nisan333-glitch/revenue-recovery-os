// EP-20 · A governance verdict is only ever shown beside the identity it was read for.
//
// The screen reports what the server decided about ONE exact (boundary, policyId, policyVersion).
// Before this rule existed, editing any of those three left the previous verdict on screen — ACTIVE,
// "may judge a dataset", and a policy hash — apparently describing a policy nobody had read. That is
// not cosmetic: ACTIVE is what the assessment flow waits for before it will judge a dataset, so a
// stale one invites a reader to believe a bar is in force when it is not.
//
// These are the pure halves of that rule. The browser journey proves the screen is actually wired to
// them; this file proves the rule itself is right, and fails in milliseconds when it is not.
import { describe, it, expect } from "vitest";
import { forSelection, mayApplyRead, selectedPolicyKey } from "./pilotPolicyClient";

const key = selectedPolicyKey;

describe("EP-20 · the selected-policy key identifies one exact policy", () => {
  it("changes when any one of the three fields changes", () => {
    const base = key("b", "p", "1.0.0");
    expect(key("b2", "p", "1.0.0")).not.toBe(base);
    expect(key("b", "p2", "1.0.0")).not.toBe(base);
    expect(key("b", "p", "1.0.1")).not.toBe(base);
    expect(key("b", "p", "1.0.0")).toBe(base); // and is stable for the same identity
  });

  it("trims each field, so whitespace is not a different policy", () => {
    expect(key("  b  ", " p ", " 1.0.0 ")).toBe(key("b", "p", "1.0.0"));
  });

  it("NEVER collides two different identities into one key", () => {
    // The reason this is JSON and not a joined string: every separator character can also appear
    // inside the field values, so a joined key can be forged. If these collided, a verdict read for
    // one policy could be displayed for another — the exact defect the rule exists to prevent.
    const collisionAttempts: [readonly [string, string, string], readonly [string, string, string]][] = [
      [["a", "b", "c"], ["a", "bc", ""]],
      [["a", "b", "c"], ["", "ab", "c"]],
      [["a|b", "c", "d"], ["a", "b|c", "d"]],
      [["a", "", ""], ["", "a", ""]],
      [['a","b', "c", "d"], ["a", "b", 'c","d']],
    ];
    for (const [left, right] of collisionAttempts) {
      expect(key(...left), `${JSON.stringify(left)} vs ${JSON.stringify(right)}`).not.toBe(key(...right));
    }
  });
});

describe("EP-20 · nothing is shown unless it was read for what is selected", () => {
  const view = { state: "ACTIVE" } as const;

  it("withholds a value when nothing has been read", () => {
    expect(forSelection(view, null, key("b", "p", "1.0.0"))).toBeNull();
  });

  it("withholds a value read for a DIFFERENT identity", () => {
    expect(forSelection(view, key("b", "p", "1.0.0"), key("b", "p-other", "1.0.0"))).toBeNull();
  });

  it("shows a value read for the identity now selected", () => {
    const k = key("b", "p", "1.0.0");
    expect(forSelection(view, k, k)).toBe(view);
  });

  it("withholds a falsy-but-present value on the same terms, rather than leaking it", () => {
    // An empty-string hash must still obey the rule; `forSelection` must not lean on truthiness.
    const k = key("b", "p", "1.0.0");
    expect(forSelection("", k, k)).toBe("");
    expect(forSelection("", k, key("b", "p2", "1.0.0"))).toBeNull();
  });

  it("holds the lifecycle view and the hash to ONE decision, never showing them apart", () => {
    // They are read together, and the pairing is what makes the panel coherent: a hash beside a
    // lifecycle that was withheld would assert something the screen cannot back up.
    const loaded = key("b", "p", "1.0.0");
    for (const current of [loaded, key("b", "p-other", "1.0.0"), key("b2", "p", "1.0.0")]) {
      for (const held of [loaded, null]) {
        const shownView = forSelection(view, held, current);
        const shownHash = forSelection("hash-abc", held, current);
        expect(shownView === null, `view/hash disagreed for ${current}`).toBe(shownHash === null);
      }
    }
  });
});

describe("EP-20 · a read that finishes late is discarded, not painted", () => {
  it("refuses to apply a read whose selection has since moved", () => {
    const requested = key("b", "p", "1.0.0");
    expect(mayApplyRead(requested, key("b", "p-other", "1.0.0"))).toBe(false);
    expect(mayApplyRead(requested, key("b2", "p", "1.0.0"))).toBe(false);
    expect(mayApplyRead(requested, key("b", "p", "1.0.1"))).toBe(false);
  });

  it("applies a read whose selection is unchanged", () => {
    const requested = key("b", "p", "1.0.0");
    expect(mayApplyRead(requested, requested)).toBe(true);
    expect(mayApplyRead(requested, key(" b ", " p ", " 1.0.0 "))).toBe(true); // trimming agrees
  });
});

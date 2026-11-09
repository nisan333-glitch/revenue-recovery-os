// Falsifiers for the correction-type mapping: every declared reason, both outcomes, the enforcement split,
// and the two things this file must be honest about — which code is reachable through the real path, and
// what enforcing the third one would cost.
import { describe, expect, it } from "vitest";

import { RECOVERY_REASONS } from "./reasons";
import {
  BLOCKING_MAPPING_CODES, CORRECTION_CHANNELS, DECLARED_CORRECTION_TYPES, DECLARED_REASONS,
  correctionMapping, mappingBlocksApproval,
} from "./correctionMapping";

describe("the inventory is the codebase's own, not invented", () => {
  it("covers exactly the declared recovery reasons — no more, no fewer", () => {
    // THE GUARD AGAINST INVENTION, in both directions. A reason added to the vocabulary with no channel
    // decision fails here rather than silently defaulting, and a channel for a reason that does not
    // exist fails too.
    expect([...DECLARED_REASONS].sort()).toEqual([...RECOVERY_REASONS.map((r) => r.key)].sort());
  });

  it("declares exactly the correction evidence types that exist, which are billing only", () => {
    expect([...DECLARED_CORRECTION_TYPES]).toEqual(["corrective_invoice_issued", "billing_corrected"]);
  });

  it("every channel states WHY its permitted list is what it is", () => {
    for (const c of CORRECTION_CHANNELS) {
      expect(c.why.length, c.reason).toBeGreaterThan(40);
      // An empty list must say the channel does not exist, so a reader is never left to infer that
      // somebody simply forgot to fill it in.
      if (c.permitted.length === 0) expect(c.why, c.reason).toContain("no source-attested correction channel exists");
    }
  });
});

describe("the one supported mapping · positive and negative", () => {
  it("BillingCorrection is evidenced by either declared billing correction type", () => {
    for (const t of DECLARED_CORRECTION_TYPES) {
      const v = correctionMapping("BillingCorrection", t);
      expect(v.ok, t).toBe(true);
      expect(v.ok && v.correctionType).toBe(t);
    }
  });

  it("BillingCorrection with NO correction type established is refused", () => {
    const v = correctionMapping("BillingCorrection", null);
    expect(!v.ok && v.code).toBe("CORRECTION_TYPE_INCOMPATIBLE_WITH_REASON");
  });

  it("BillingCorrection with a type outside its channel is INCOMPATIBLE", () => {
    const v = correctionMapping("BillingCorrection", "usage_activated");
    expect(!v.ok && v.code).toBe("CORRECTION_TYPE_INCOMPATIBLE_WITH_REASON");
    expect(!v.ok && v.detail).toContain("attests a different mechanism");
  });
});

describe("unsupported combinations · all seven, each explicitly", () => {
  const withoutChannel = CORRECTION_CHANNELS.filter((c) => c.permitted.length === 0).map((c) => c.reason);

  it("there are exactly seven, and they are the relationship and activation mechanisms", () => {
    expect([...withoutChannel].sort()).toEqual([
      "CSMOutreach", "EnablementSession", "ExecBusinessReview", "MilestoneNudge",
      "OnboardingReboot", "RenewalOutreach", "UsageActivation",
    ]);
  });

  it("each is refused CORRECTION_CHANNEL_NOT_DECLARED, whatever correction is supplied", () => {
    for (const reason of withoutChannel) {
      for (const t of [...DECLARED_CORRECTION_TYPES, null, "anything"]) {
        const v = correctionMapping(reason, t);
        expect(!v.ok && v.code, `${reason}/${String(t)}`).toBe("CORRECTION_CHANNEL_NOT_DECLARED");
      }
    }
  });

  it("an UNKNOWN reason is refused before anything else is considered", () => {
    for (const bogus of ["", "billing_correction", "BillingCorrection ", "Whatever"]) {
      const v = correctionMapping(bogus, "corrective_invoice_issued");
      expect(!v.ok && v.code, bogus).toBe("RECOVERY_REASON_UNKNOWN");
    }
  });
});

describe("the enforcement split, and what it costs", () => {
  it("blocks exactly the two decidable codes and NOT the governance one", () => {
    expect([...BLOCKING_MAPPING_CODES].sort()).toEqual([
      "CORRECTION_TYPE_INCOMPATIBLE_WITH_REASON", "RECOVERY_REASON_UNKNOWN",
    ]);
    expect(mappingBlocksApproval(correctionMapping("Whatever", "corrective_invoice_issued"))).toBe(true);
    expect(mappingBlocksApproval(correctionMapping("BillingCorrection", "usage_activated"))).toBe(true);
    // NOT blocking: seven of eight reasons have no channel, and enforcing that is a governance decision.
    expect(mappingBlocksApproval(correctionMapping("UsageActivation", "corrective_invoice_issued"))).toBe(false);
    // And a passing verdict never blocks.
    expect(mappingBlocksApproval(correctionMapping("BillingCorrection", "billing_corrected"))).toBe(false);
  });

  it("MEASURES what enforcing the governance code would make unreachable", () => {
    // Not an estimate: the count comes from the declaration itself, and the empirical half is recorded in
    // the module comment — enforcing it gives 41 failed / 905 passed where 946 pass without it, and
    // 905 + 41 = 946, so the mutation's whole effect is those 41. What the 41 bodies individually
    // evidence is stated at its real strength there and in the decision record, not overclaimed here.
    const blocked = CORRECTION_CHANNELS.filter((c) => c.permitted.length === 0);
    expect(blocked).toHaveLength(7);
    expect(CORRECTION_CHANNELS).toHaveLength(8);
    // So PROVEN would be reachable for exactly one mechanism.
    expect(CORRECTION_CHANNELS.filter((c) => c.permitted.length > 0).map((c) => c.reason)).toEqual(["BillingCorrection"]);
  });

  it("STRUCTURAL · the approval path actually consults the mapping", () => {
    // WHY A STRUCTURAL GUARD HERE, stated because structural guards are usually the weaker choice. A
    // mutation that deleted the wiring from `approve()` SURVIVED the whole suite, and that is consistent
    // rather than surprising: no behavioural test can reach a blocking case, because the only reason with
    // a channel permits both declared correction types and an unknown reason is rejected by the request
    // schema before the service runs. So the wiring had no behavioural guard at all, and the honest
    // instrument is one that reads the construct — the CALL — rather than prose about it.
    const src = require("node:fs").readFileSync(
      require("node:path").resolve(__dirname, "../../server/services/proofService.ts"), "utf8",
    ) as string;
    const code = src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).toContain("correctionMapping(req.recoveryReason");
    expect(code).toContain("mappingBlocksApproval(mapping)");
    // And it must refuse, not merely compute: a call whose result is discarded is not a gate.
    expect(code).toMatch(/if \(mappingBlocksApproval\(mapping\)\) \{[\s\S]{0,400}?throw new ForbiddenError/);
    // The type comes from the RECORD, never the request.
    expect(code).toContain("chosenCorrection?.evidenceType");
    expect(code).not.toContain("req.correctionType");
  });

  it("HONEST LIMIT · the incompatible-type code is not reachable through the real path today", () => {
    // Stated rather than implied. `BillingCorrection` is the only reason with a channel and it permits
    // BOTH declared correction types, and a correction-role record can only carry one of those two — so
    // no real ingestion can produce an incompatible pair. The code is correct, enforced, and currently
    // provable at this level only. It becomes reachable the day a third correction type is declared.
    const permittedByTheOnlyChannel = CORRECTION_CHANNELS.find((c) => c.permitted.length > 0)!.permitted;
    expect([...permittedByTheOnlyChannel].sort()).toEqual([...DECLARED_CORRECTION_TYPES].sort());
  });
});

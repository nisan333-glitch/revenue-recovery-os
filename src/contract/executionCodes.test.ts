import { describe, it, expect } from "vitest";
import {
  EXECUTION_REFUSAL_CODES,
  RETENTION_CODES,
  allExecutionCodes,
  allRetentionCodes,
  executionCode,
  retentionCodeFor,
} from "./executionCodes";

describe("EP-17 · the retention catalogue is total, banded and self-consistent", () => {
  it("gives every retention decision a unique 4xxx code with a remediation", () => {
    const codes = allRetentionCodes();
    expect(codes.length).toBe(Object.keys(RETENTION_CODES).length);
    expect(new Set(codes.map((c) => c.code)).size).toBe(codes.length);
    for (const spec of codes) {
      expect(spec.code).toMatch(/^NH-AX-4\d{3}$/);
      expect(spec.title.trim().length).toBeGreaterThan(0);
      expect(spec.remediation.trim().length).toBeGreaterThan(0);
    }
  });

  it("agrees between the decision's name and its outcome", () => {
    // `purged_*` must report `purged` and `retained_*` must report `retained`. The service branches on
    // the outcome, so a mismatched pair would delete something a reader was told was kept.
    for (const [decision, spec] of Object.entries(RETENTION_CODES)) {
      expect(spec.outcome, decision).toBe(decision.startsWith("purged_") ? "purged" : "retained");
    }
  });

  it("resolves every decision — the map is total by construction", () => {
    for (const decision of Object.keys(RETENTION_CODES)) {
      expect(retentionCodeFor(decision as keyof typeof RETENTION_CODES).code).toMatch(/^NH-AX-4/);
    }
  });

  it("covers all three purge reasons and all four retain reasons", () => {
    const purged = allRetentionCodes().filter((c) => c.outcome === "purged");
    const retained = allRetentionCodes().filter((c) => c.outcome === "retained");
    expect(purged).toHaveLength(3); // completed, blocked, abandoned
    expect(retained).toHaveLength(4); // no policy, in flight, grace unelapsed, retention unelapsed
  });
});

describe("EP-17 · a purged input is a distinct refusal from a missing one", () => {
  it("adds NH-AX-2005 in the blocked band, separate from NH-AX-2002", () => {
    const purged = executionCode("execution_input_purged");
    const missing = executionCode("execution_input_missing");
    expect(purged.code).toBe("NH-AX-2005");
    expect(missing.code).toBe("NH-AX-2002");
    expect(purged.severity).toBe("blocked");
    // The remediation must say no action is needed: a purge on schedule is not a fault, and telling
    // someone to investigate it would send them after a non-problem.
    expect(purged.remediation).toMatch(/none, and none is needed/i);
    expect(missing.remediation).not.toMatch(/none, and none is needed/i);
  });

  it("keeps the refusal and retention vocabularies disjoint", () => {
    const refusals = new Set(allExecutionCodes().map((c) => c.code));
    for (const spec of allRetentionCodes()) expect(refusals.has(spec.code)).toBe(false);
    expect(refusals.size).toBe(Object.keys(EXECUTION_REFUSAL_CODES).length);
  });

  it("still puts every refusal code in the band its severity implies", () => {
    const band: Record<string, string> = { refused: "1", blocked: "2", failed: "3" };
    for (const spec of allExecutionCodes()) {
      expect(spec.code.slice("NH-AX-".length, "NH-AX-".length + 1), spec.code).toBe(band[spec.severity]);
    }
  });
});

// STRUCTURAL guard for the proof service's reason-scope check. The rule itself is pure and tested in
// src/domain/reasonScope.test.ts; this pins that the service actually CALLS it, reads the case's type from
// its governed root rather than the request, and does so before anything is written.
//
// It reads CODE, not prose: comments are stripped first, so a sentence in a comment cannot satisfy a check.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const raw = readFileSync(new URL("./proofService.ts", import.meta.url), "utf8");
const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const approveBody = code.slice(code.indexOf("export async function approve("));

describe("proofService.approve · reason scope", () => {
  it("imports the pure rule from the domain, not a private copy", () => {
    expect(code).toMatch(/import\s*\{[^}]*reasonScopeViolation[^}]*\}\s*from\s*"\.\.\/\.\.\/src\/domain\/reasons"/);
  });

  it("reads the recovery type from the case's own governed root, keyed by the case id", () => {
    expect(approveBody).toMatch(/prisma\.recoveryCaseRecord\.findUnique\(\s*\{\s*where:\s*\{\s*recoveryCaseId:\s*req\.recoveryCaseId\s*\}/);
  });

  it("never takes the type from the request body", () => {
    expect(approveBody).not.toMatch(/req\.recoveryType|req\.leakageType|req\.caseType/);
  });

  it("refuses with a 403-mapped error and fails closed on a missing root", () => {
    expect(approveBody).toMatch(/reasonScopeViolation\(\s*req\.recoveryReason,\s*root\?\.recoveryType\s*\?\?\s*null\s*\)/);
    expect(approveBody).toMatch(/throw new ForbiddenError\(violation\)/);
  });

  it("runs before the proof is written", () => {
    const check = approveBody.indexOf("reasonScopeViolation(");
    const write = approveBody.indexOf("withGovernedCaseMutation(");
    expect(check).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(check);
  });

  it("runs after authorization and separation of duties, so it never reveals case type to an unauthorised caller", () => {
    const check = approveBody.indexOf("reasonScopeViolation(");
    expect(approveBody.indexOf('requireCan(actor, "Approve")')).toBeLessThan(check);
    expect(approveBody.indexOf("enforceSeparation(")).toBeLessThan(check);
  });
});

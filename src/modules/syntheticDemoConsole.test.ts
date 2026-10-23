// What the Synthetic Demo console must never become.
//
// This is a STRUCTURAL guard, deliberately: the properties below are about what the module is ALLOWED TO
// DEPEND ON and CALL, which no amount of rendering a happy path can show. The behavioural claims (the
// server refuses a shortcut, the proof reaches PROVEN) are proven against the real routes in
// `server/demo/syntheticDemo.postgres.test.ts` and the browser journey.
//
// It reads IMPORT SPECIFIERS and CALL SITES, not prose — the module's header comments name things it does
// not do, and a token scan would flag the very explanations that make it safe.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { ALL_REASON_KEYS } from "../domain/reasons";

const root = process.cwd();
const code = readFileSync(`${root}/src/modules/SyntheticDemoConsole.tsx`, "utf8");
const client = readFileSync(`${root}/src/data/syntheticDemoClient.ts`, "utf8");

/** Strip comments so assertions are about code, not about the prose that explains it. */
const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const body = strip(code);
const clientBody = strip(client);
const importsOf = (s: string): string[] =>
  [...s.matchAll(/(?:^|\n)\s*import\s[^;]*?from\s+["']([^"']+)["']/g)].map((m) => m[1]!);

describe("Synthetic Demo console · structure", () => {
  it("reads only the governed API clients — never the seed-backed context, never fetch", () => {
    const imports = importsOf(code);
    expect(imports.some((i) => i.includes("state/RecoveryContext"))).toBe(false);
    expect(body).not.toMatch(/\bfetch\(/);
    expect(imports).toContain("../data/governedTrustClient");
    expect(imports).toContain("../data/candidateReviewClient");
    expect(imports).toContain("../data/syntheticDemoClient");
  });

  it("says SYNTHETIC in a banner that is not conditional on any state", () => {
    expect(code).toContain('data-testid="synthetic-banner"');
    expect(code).toMatch(/SYNTHETIC DEMONSTRATION/);
    expect(code).toMatch(/No customer data, no\s+payment rail, no real money/);
  });

  it("keeps the two ledgers in separate, separately-labelled panels", () => {
    expect(code).toMatch(/Revenue Opportunity · identified · SYNTHETIC · not money returned/);
    expect(code).toMatch(/Revenue Returned · proven · SYNTHETIC/);
    expect(code).toContain('data-testid="demo-exposure"');
    expect(code).toContain('data-testid="demo-returned"');
  });

  it("renders an absent proof as NOT COMPUTED, never as a zero", () => {
    expect(code).toContain("NOT COMPUTED");
    expect(body).not.toMatch(/\$0\.00/);
    // the proven figure is only ever read from the governed view, with null handled before formatting
    expect(body).toMatch(/provenRevenueReturnedMinor !== null/);
    expect(body).not.toMatch(/provenRevenueReturnedMinor\s*\?\?\s*0/);
  });

  it("the operator never approves: approval is the approver identity's, and uses a closed-vocabulary reason", () => {
    expect(body).toMatch(/approveProof\(APPROVER,/);
    expect(body).not.toMatch(/approveProof\(OPERATOR/);
    expect(body).not.toMatch(/getRecoveryCase\([^)]*OPERATOR/);
    expect(ALL_REASON_KEYS).toContain("BillingCorrection");
    expect(body).toMatch(/const REASON = "BillingCorrection"/);
  });

  it("the collected figure is READ from signed outcome evidence, not typed by anyone", () => {
    expect(body).toMatch(/evidenceRole === "outcome"/);
    expect(body).toMatch(/collectedMinor: collected/);
    // the only amount the operator types is the BASELINE, and it is parsed and bounded by the exposure
    const inputs = [...body.matchAll(/aria-label="([^"]+)"/g)].map((m) => m[1]);
    expect(inputs.sort()).toEqual(["Baseline amount", "Review reason"]);
  });

  it("the synthetic-source client has no parameter that could carry an amount, currency or date", () => {
    expect(clientBody).toMatch(/settleSyntheticCase\(caseId: string, actor: DevActor\)/);
    expect(clientBody).toMatch(/launchSyntheticDemo\(actor: DevActor\)/);
    expect(clientBody).not.toMatch(/amountMinor|collectedMinor|observedAt|evidenceId/);
    // and both POSTs send no body at all
    expect([...clientBody.matchAll(/apiRequest\("POST".*undefined\)/g)]).toHaveLength(2);
  });

  it("is reachable from the app shell, next to — not in place of — the existing client-side simulation", () => {
    const app = readFileSync(`${root}/src/App.tsx`, "utf8");
    expect(app).toMatch(/key: "synthetic-demo", label: "Synthetic Demo \(live API\)"/);
    expect(app).toMatch(/key: "synthetic-pilot", label: "Synthetic Pilot v2"/);
    expect(app).toMatch(/active === "synthetic-demo" && <SyntheticDemoConsole \/>/);
  });
});

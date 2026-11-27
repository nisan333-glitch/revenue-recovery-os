// FEASIBILITY PROBE · can the production contracts READ the frozen synthetic company at all?
//
// Measured BEFORE any scoring apparatus is built, because the answer decides the design: if the pair
// is inadmissible there is nothing to score, and if it admits at a grain the proof gate refuses then
// the exercise measures detection and not proof. Guessing either would waste the build.
import { projectFrozenPackage } from "./project";
import { assessPairFromCsv } from "../../src/contract/pairAssessment";

const PACKAGES = [
  ["V3 (no obligation reference)", "e2e/fixtures/reconciliation-synthetic"],
  ["obligation-ref variant", "e2e/fixtures/reconciliation-obligation-ref"],
] as const;

for (const [label, dir] of PACKAGES) {
  console.log(`\n═══ ${label} ═══`);
  let pair;
  try { pair = projectFrozenPackage(dir); }
  catch (e) { console.log(`  PROJECTION FAILED · ${(e as Error).message}`); continue; }
  console.log(`  projected: ${pair.expectationRows} expectation rows, ${pair.billingRows} billing rows`);
  console.log(`  frozen columns NOT read · expectation: ${pair.unreadExpectation.join(" ") || "(none)"}`);
  console.log(`  frozen columns NOT read · billing    : ${pair.unreadBilling.join(" ") || "(none)"}`);
  const { report, exitCode } = assessPairFromCsv(pair.expectationCsv, pair.billingCsv, { currency: "USD" });
  console.log(`  readiness level : ${report.level}`);
  console.log(`  exit code       : ${exitCode}`);
  const any = report as unknown as Record<string, { usable?: boolean; acceptedRows?: number; rejectedRows?: number; extractFaultCodes?: string[] }>;
  for (const side of ["expectation", "billing"]) {
    const s = any[side];
    if (s) console.log(`  ${side.padEnd(11)} : usable=${s.usable} accepted=${s.acceptedRows} rejected=${s.rejectedRows} faults=${(s.extractFaultCodes ?? []).join(",") || "-"}`);
  }
  const blocked = (report as unknown as { blockedCapabilities?: { capability: string; code: string }[] }).blockedCapabilities ?? [];
  console.log(`  blocked caps    : ${blocked.map((b) => `${b.capability}(${b.code})`).join(" ") || "(none)"}`);
}
console.log("\nSYNTHETIC · read-only · the frozen packages were not written to.");

// The artefact's own guards: the tier vocabulary, the A-F answers, and prose held to behaviour.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  EXPECTATION_CAPABILITIES, EXPECTATION_EXTRACT_CLAIM_BOUNDARY, EXPECTATION_EXTRACT_COLUMNS,
  EXPECTATION_EXTRACT_FIELDS, EXPECTATION_EXTRACT_REF, EXPECTATION_EXTRACT_SCHEME,
  EXPECTATION_EXTRACT_VERSION, EXPECTATION_REQUIRED_COLUMNS, EXPECTATION_ROW_GRAIN,
  EXPECTATION_VALIDATION_METHOD_VERSION, EXPECTATION_EXTRACT_VERSION_HISTORY, STOPPED_FIELDS,
} from "./expectationExtract";
import { ALL_EXPECTATION_CODES } from "./expectationExtractCodes";
import { PILOT_DATA_CONTRACT_VERSION } from "./pilotDataContract";
import { OBLIGATION_IDENTITY_FIELDS } from "./leakInstanceIdentity";

describe("expectation extract · identity, separate from everything it must not disturb", () => {
  it("owns its scheme, version and method version, colliding with none in use", () => {
    expect(EXPECTATION_EXTRACT_SCHEME).toBe("nh-expectation-extract-v1");
    expect(EXPECTATION_VALIDATION_METHOD_VERSION).toBe("exv-2026.1");
    expect(EXPECTATION_EXTRACT_REF).toBe("nh.expectation-extract@1.1.0");
    for (const foreign of ["nh-expectation-reconciliation-v1", "nh-non-stalled-exposure-v1",
      "nh-pilot-assessment-execution-v1", "nh-admission-policy-v1", "nh-analysis-terms-v2",
      "nh-leak-instance-v1", "nh-source-namespace-v1", "nh-validation-evidence-v1"]) {
      expect(EXPECTATION_EXTRACT_SCHEME).not.toBe(foreign);
    }
    for (const foreign of ["assess-2026.1-thin", "admission-gate-2026.1", "nse-2026.1", "recon-2026.1"]) {
      expect(EXPECTATION_VALIDATION_METHOD_VERSION).not.toBe(foreign);
    }
  });

  it("does NOT ride the observation contract's version line", () => {
    // The two describe different files from different systems. Tying them would mean an
    // expectation-side clarification forced a bump on every observation extract in the field.
    expect(EXPECTATION_EXTRACT_VERSION).not.toBe(PILOT_DATA_CONTRACT_VERSION);
    expect(PILOT_DATA_CONTRACT_VERSION).toBe("2.0.0"); // ...and 2.0.0 is exactly where it was
  });

  it("declares no candidate identity — OBLIGATION_IDENTITY_FIELDS stays empty", () => {
    // `schedule_line_ref` is per-obligation identity WITHIN this extract. It is deliberately not
    // candidate identity, and declaring it here must not look like closing that gap.
    expect(OBLIGATION_IDENTITY_FIELDS).toEqual([]);
  });

  it("claims nothing: observation only, no proof, no revenue, no case, no candidate", () => {
    expect(EXPECTATION_EXTRACT_CLAIM_BOUNDARY).toEqual({
      observationOnly: true, constitutesProof: false, constitutesRevenue: false,
      createsRecoveryCase: false, enablesCandidate: false,
    });
  });
});

describe("expectation extract · its consumer has shipped, and the guard moved with it", () => {
  // THE GUARD'S HISTORY, because deleting it would be the wrong move and weakening it silently would
  // be worse. It was written when this extract was deliberately unwired, asserting NO production
  // importer at all — the `obligation_ref` revert rule: *the slice that wires a field must ship its
  // consumer with it*, after a declared-but-unconsumed field collected no evidence and left false
  // customer-facing prose behind.
  //
  // That consumer has now shipped: the CUSTOMER DATA READINESS path. So the guard is not retired, it is
  // NARROWED to the thing it was actually protecting — that wiring this extract did not disturb the
  // single-dataset money path. The importers must be exactly the readiness path and nothing else, and
  // in particular **no monetary, reconciliation or assessment module may reach it**.
  const importers = (): string[] => {
    const roots = ["src", "server", "e2e", "scripts"];
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!/\.(ts|tsx|mjs|js)$/.test(entry.name)) continue;
        if (/^expectationExtract(Codes|Validator|Corrections)?(\.test)?\.ts$/.test(entry.name)) continue;
        // IMPORT SPECIFIERS ONLY. The guard's question is "does this module IMPORT the extract", and the
        // first two forms answered a different one. It began by matching the bare token in raw text, so a
        // prose mention counted — `billingExtract.ts` names the erratum file in a comment. Stripping
        // comments fixed that and the replacement comment then CLAIMED string literals were stripped
        // while the code stripped only comments, so a file naming the module in a `resolve(...)` path
        // still read as a dependency: that is exactly how `assessPairCore.test.ts` — which reads the
        // validator's SOURCE to check its declared terms and imports nothing from it — appeared here.
        // Eleventh instance of the one lesson: a structural guard must read code, and specifically the
        // construct it is actually asking about. A string literal is not a dependency. The import-
        // specifier form below is the one the historical-record guard already settled on.
        const code = readFileSync(full, "utf8");
        const specifiers = [...code.matchAll(/(?:from|import|require)\s*\(?\s*["']([^"']+)["']/g)]
          .map((m) => m[1]!);
        if (specifiers.some((x) => /expectationExtract/.test(x))) {
          hits.push(full.replace(/.*\/(src|server|e2e|scripts)\//, "$1/"));
        }
      }
    };
    for (const r of roots) walk(resolve(__dirname, "..", "..", r));
    return hits.sort();
  };

  it("is imported ONLY by the readiness path — named, so a new importer must be justified here", () => {
    expect(importers()).toEqual([
      // The LOCAL PILOT-PAIR CLI and its core: they read two independently sourced CSV exports through
      // the real validators and the real readiness evaluator so a real pair can be checked before any
      // pilot customer exists. Read-only, persist nothing, compute no money.
      "scripts/data-readiness/assessPairCore.ts",
      "scripts/data-readiness/control.ts",
      // The customer-facing intake package: its emitter renders the request and the dictionary FROM these
      // specs, and its verifier re-derives them to prove the committed documents have not drifted. Both
      // are readiness-path consumers; neither computes money.
      // The dependency PROBE: it runs minimal fixtures through the validators and the readiness evaluator
      // so the customer-facing document can state a MEASURED consequence of omitting a field rather than
      // an authored one. Read-only, and it computes no money.
      "scripts/pilot-intake/dependency.ts",
      "scripts/pilot-intake/emit-package.ts",
      "scripts/pilot-intake/verify-package.ts",
      "src/contract/dataReadiness.test.ts",
      "src/contract/dataReadiness.ts",
      // The provenance attestation's corroborator and its falsifiers: they read the two VALIDATIONS to
      // check a declared row count, coverage window and join against what the files actually contain.
      // Readiness path, pure, and they compute no money.
      "src/contract/provenanceAttestation.test.ts",
      "src/contract/provenanceAttestation.ts",
    ]);
  });

  it("counts an IMPORT and not a mention — both directions, on a committed pair", () => {
    // THE FALSIFIER FOR THE GUARD ITSELF, and it needs no synthetic fixture because the repository holds
    // one of each. `assessPairCore.ts` imports the validator; `assessPairCore.test.ts` names it only
    // inside a `resolve(...)` path, to read its source and check which reading terms it declares. The
    // negative half is the one that was broken, so it is the one worth pinning.
    const read = (f: string): string =>
      readFileSync(resolve(__dirname, "..", "..", "scripts", "data-readiness", f), "utf8");
    expect(read("assessPairCore.test.ts")).toContain('"expectationExtractValidator.ts"'); // the premise
    expect(read("assessPairCore.ts")).toMatch(/from "\.\.\/\.\.\/src\/contract\/expectationExtractValidator"/);
    expect(importers()).toContain("scripts/data-readiness/assessPairCore.ts");
    expect(importers()).not.toContain("scripts/data-readiness/assessPairCore.test.ts");
  });

  it("NO monetary, reconciliation or assessment module reaches it — the money path is undisturbed", () => {
    const forbidden = /(reconciliationCore|obligationAwareReconciliation|assessmentExecution|exposureFinding|provenLedger|domain\/(money|outcomes|invariants))/;
    for (const f of importers()) {
      expect(f, `${f} imports the expectation extract`).not.toMatch(forbidden);
    }
    // ...and the readiness evaluator itself imports none of them either, so the wiring cannot leak.
    const readiness = readFileSync(resolve(__dirname, "dataReadiness.ts"), "utf8");
    expect(readiness).not.toMatch(forbidden);
  });
});

describe("expectation extract · the tier vocabulary", () => {
  it("has NO `recommended` tier — the trap is absent, not merely unused", () => {
    // In 2.0.0 `recommended` feeds `missingRecommendedColumns` against a governed threshold of zero,
    // so a recommended addition refuses files that previously passed. The word does not appear.
    const tiers = new Set(EXPECTATION_EXTRACT_FIELDS.map((f) => f.tier));
    expect([...tiers].sort()).toEqual(["conditional", "optional", "required"]);
    const src = readFileSync(resolve(__dirname, "expectationExtract.ts"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(code).not.toMatch(/"recommended"/);
  });

  it("requires only the five facts without which no unit exists", () => {
    expect([...EXPECTATION_REQUIRED_COLUMNS]).toEqual([
      "entitlement_ref", "period_start", "period_end", "expected_amount", "currency",
    ]);
    // Everything else is a named capability, so no dataset is refused for a fact another detector
    // never needed. That is the rule the obligation-identity audit settled.
    expect(EXPECTATION_EXTRACT_FIELDS.filter((f) => f.tier !== "required").map((f) => f.name)).toEqual([
      "payer_ref", "terminated_at", "pause_start", "pause_end", "supersedes_ref", "amended_at",
      "schedule_line_ref",
    ]);
  });

  it("answers A-F for every field, with no field claiming a new identity or grain duty", () => {
    for (const f of EXPECTATION_EXTRACT_FIELDS) {
      expect(f.establishes.length).toBeGreaterThan(20);
      expect(f.withoutIt.length).toBeGreaterThan(20);
      expect(f.whenAbsent.length).toBeGreaterThan(20);
      expect(f.sourceObservable).toBe(true);
      expect(f.createsIdentityObligation).toBe(false);
      // A non-required field names the capability it gates; a required one is needed by every unit.
      if (f.tier === "required") expect(f.neededBy).toBe("every_unit");
      else expect(EXPECTATION_CAPABILITIES.some((c) => c.capability === f.neededBy)).toBe(true);
    }
  });
});

describe("expectation extract · row grain, stated as a value so a test can hold it", () => {
  it("is one expected obligation, enumerated by the source and never by NH", () => {
    expect(EXPECTATION_ROW_GRAIN.rule).toContain("ONE ROW IS ONE EXPECTED BILLING OBLIGATION");
    expect(EXPECTATION_ROW_GRAIN.whoEnumerates).toBe("the source system, never NH");
    expect(EXPECTATION_ROW_GRAIN.nhNeverGeneratesRows).toBe(true);
    expect(EXPECTATION_ROW_GRAIN.grainIsNotDeclarable).toBe(true);
  });

  it("carries no grain flag and no cadence field — the prose and the table agree", () => {
    // The prose says grain is not declarable. A field table containing a grain or cadence column
    // would contradict it, and the contradiction is what this check exists to prevent.
    for (const forbidden of ["row_grain", "grain", "cadence", "billing_frequency", "frequency",
      "status", "invoice_ref", "obligation_ref", "expected_amount_estimated", "proration_basis"]) {
      expect(EXPECTATION_EXTRACT_COLUMNS).not.toContain(forbidden);
    }
    expect(EXPECTATION_EXTRACT_COLUMNS).toHaveLength(12);
  });

  it("records WHY each stopped field was stopped, with a binding reason", () => {
    expect(STOPPED_FIELDS.length).toBeGreaterThanOrEqual(7);
    for (const s of STOPPED_FIELDS) expect(s.why.length).toBeGreaterThan(80);
    const cadence = STOPPED_FIELDS.find((s) => s.candidate.startsWith("cadence"))!;
    expect(cadence.why).toContain("NH the author of the expectation");
  });
});

describe("expectation extract · capabilities are separate and fail closed", () => {
  it("names five, each with its own code and its own basis", () => {
    expect(EXPECTATION_CAPABILITIES).toHaveLength(5);
    const codes = EXPECTATION_CAPABILITIES.map((c) => c.unavailableCode.code);
    expect(new Set(codes).size).toBe(5); // collapsing any two would hide which one closed
    for (const c of EXPECTATION_CAPABILITIES) {
      expect(c.fields.length).toBeGreaterThan(0);
      expect(c.lossWhenClosed.length).toBeGreaterThan(30);
      expect(c.unavailableCode.severity).toBe("capability_unavailable");
    }
  });

  it("every capability field is a declared column", () => {
    for (const c of EXPECTATION_CAPABILITIES) {
      for (const f of c.fields) expect(EXPECTATION_EXTRACT_COLUMNS).toContain(f);
    }
  });
});

describe("expectation extract · the code catalogue", () => {
  it("uses its own NH-EX prefix and recycles nothing", () => {
    const codes = ALL_EXPECTATION_CODES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of codes) expect(c).toMatch(/^NH-EX-[123]\d{3}$/);
  });

  it("gives every code a remediation that says what to DO", () => {
    for (const c of ALL_EXPECTATION_CODES) {
      expect(c.remediation.length).toBeGreaterThan(40);
      // `since` must name a version this artefact actually declares — not a free-text label.
      expect(EXPECTATION_EXTRACT_VERSION_HISTORY.map((v) => v.version)).toContain(c.since);
    }
  });

  it("separates row quarantine from capability loss, which is the whole design", () => {
    const sev = (prefix: string) =>
      new Set(ALL_EXPECTATION_CODES.filter((c) => c.code.startsWith(prefix)).map((c) => c.severity));
    expect([...sev("NH-EX-1")]).toEqual(["extract_unusable"]);
    expect([...sev("NH-EX-2")]).toEqual(["row_quarantined"]);
    expect([...sev("NH-EX-3")]).toEqual(["capability_unavailable"]);
  });
});

// FALSIFIERS FOR THE LOCAL PILOT-PAIR READINESS PATH.
//
// The patch that introduced this path shipped a parser test and nothing that tested the thing the command
// actually claims. Its claims are the risky part, so each one is checked here against the REAL committed
// example exports rather than against a fixture written to pass:
//
//   1. it prints no cell from either source file — no identifier, no amount, no date;
//   2. it contains no money at all, checked on the emitted JSON and not on the object;
//   3. it stays SOURCE_NATIVE and PROVISIONAL, because a local file cannot say where it came from;
//   4. it fails CLOSED on malformed, mis-encoded and mis-keyed input, with the input's own code;
//   5. an NH defect is reported as an NH defect and never as unreadable customer data.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PAIR_RUN_PREAMBLE, assessPairFromCsv, parseArguments } from "./assessPairCore";
import { CsvTransportError, parseStrictCsv } from "./csvPairTransport";
import { PROVENANCE_CHANNELS } from "../../src/contract/sourceFactAuthority";

const PKG = resolve(__dirname, "..", "..", "docs", "pilot-intake");
const example = (name: string): string => readFileSync(resolve(PKG, name), "utf8");

/** The two committed synthetic examples — the only exports in this repository, and shaped like real ones. */
const EXPECTATION = example("expectation_example.csv");
const BILLING = example("billing_example.csv");

describe("1 · the committed examples pass end to end", () => {
  it("both extracts are usable and the pair reaches a level", () => {
    const { report, exitCode } = assessPairFromCsv(EXPECTATION, BILLING, { currency: "USD" });
    expect(exitCode).toBe(0);
    expect(report.expectation.usable).toBe(true);
    expect(report.billing.usable).toBe(true);
    expect(report.expectation.acceptedRows).toBeGreaterThan(0);
    expect(report.billing.acceptedRows).toBeGreaterThan(0);
  });

  it("authority is SOURCE_NATIVE and every level is PROVISIONAL — a local file proves no origin", () => {
    const { report } = assessPairFromCsv(EXPECTATION, BILLING, { currency: "USD" });
    expect(report.authority.reached).toBe("SOURCE_NATIVE");
    expect(report.provisional).toBe(true);
    expect(report.attestation).toBeNull();
    expect(report.authority.ceilingReason).toContain("no attestation accompanied the submission");
  });

  it("the preamble states the two things a JSON blob on a terminal does not say for itself", () => {
    const text = PAIR_RUN_PREAMBLE.join(" ");
    expect(text).toMatch(/computes no\s+money/);
    expect(text).toMatch(/PROVISIONAL/);
    expect(text).toMatch(/validation only/i);
    expect(text).toMatch(/not evidence of recovered revenue/i);
  });
});

describe("2 · the report leaks nothing from the source files", () => {
  it("no cell value from either export appears in the emitted JSON", () => {
    // THE CLAIM THE COMMAND MAKES ABOUT ITSELF, and nothing checked it. Every cell of both files is
    // collected and searched for in the output. Short and numeric-looking cells are excluded: "1", "USD"
    // and "false" occur in the report for unrelated reasons, and a coincidence is not a leak.
    const { report } = assessPairFromCsv(EXPECTATION, BILLING, { currency: "USD" });
    const emitted = JSON.stringify(report, null, 2);
    const cells = new Set<string>();
    for (const csv of [EXPECTATION, BILLING]) {
      for (const row of parseStrictCsv(csv).rows) {
        for (const value of Object.values(row.cells)) {
          const v = value.trim();
          if (v.length >= 5 && !/^(?:true|false)$/i.test(v)) cells.add(v);
        }
      }
    }
    expect(cells.size).toBeGreaterThan(10); // the search is meaningful only if it searches for something
    const leaked = [...cells].filter((v) => emitted.includes(v));
    expect(leaked, `leaked source values: ${leaked.join(", ")}`).toEqual([]);
  });

  it("the emitted JSON carries no monetary figure and no monetary key", () => {
    // Checked on the STRING that is printed, not on the object: the no-money guarantee has to survive
    // serialisation, and that is the form an operator actually sees and pastes into a ticket.
    const { report } = assessPairFromCsv(EXPECTATION, BILLING, { currency: "USD" });
    const emitted = JSON.stringify(report, null, 2);
    // ONE FIGURE IS PERMITTED, AND ONLY ONE: the governed sentence that explains why zero is forbidden
    // quotes `$0.00` to say what NH refuses to print — "never as zero, because $0.00 would assert the
    // obligation was checked and found clean". That is the constitution's no-zero rule being stated, not
    // a monetary claim about this dataset. Every other figure is banned, so a real amount still fails.
    const figures = [...emitted.matchAll(/\$\s?[\d,.]+/g)].map((m) => m[0]);
    const permitted = figures.filter((f) => f === "$0.00"
      && emitted.includes(`never as zero, because ${f} would assert`));
    expect(figures.filter((f) => !permitted.includes(f)),
      `unexpected monetary figures: ${figures.join(", ")}`).toEqual([]);
    for (const key of ["minor", "amountMinor", "exposure", "residual", "recovered", "revenue", "total"]) {
      expect(emitted.toLowerCase(), key).not.toContain(`"${key}`);
    }
  });
});

describe("3 · it fails closed on input it cannot trust", () => {
  it("a mis-encoded export is REFUSED, not silently transliterated", () => {
    // The defect this corrects: `readFileSync(path, "utf8")` does not throw on invalid UTF-8 — Node
    // substitutes U+FFFD — so a cp1252 export from a European ERP would arrive with its identifiers
    // quietly rewritten. An identifier is a join key, so a rewritten one is NH authoring the identity it
    // is meant to be reading.
    const cp1252 = Buffer.from([0x69, 0x64, 0x0a, 0x4d, 0xfc, 0x6c, 0x0a]).toString("utf8");
    expect(cp1252).toContain("�"); // the premise: Node did not throw
    expect(() => parseStrictCsv(cp1252)).toThrow("CSV_NOT_UTF8");
  });

  it("malformed transport is refused before any validator sees it", () => {
    for (const [csv, code] of [
      ['id\n"unclosed\n', "CSV_UNCLOSED_QUOTE"],
      ["id,id\na,b\n", "CSV_DUPLICATE_HEADER"],
      ["id,amount\na\n", "CSV_RAGGED_RECORD"],
    ] as const) {
      expect(() => assessPairFromCsv(csv, BILLING, { currency: "USD" })).toThrow(code);
    }
  });

  it("a readable file with the WRONG shape is refused by the contract, and SAYS WHICH CODE", () => {
    // The layering that matters: transport decides whether the bytes are a CSV, and the governed contract
    // decides whether the CSV is an extract. A well-formed CSV of the wrong columns must reach the
    // contract and be refused there, with the contract's own code.
    const wrong = "a,b,c\n1,2,3\n";
    const { report, exitCode } = assessPairFromCsv(wrong, BILLING, { currency: "USD" });
    expect(exitCode).toBe(2);
    expect(report.expectation.usable).toBe(false);
    expect(report.level).toBe("L0_NOT_READABLE");
    //
    // THE §6b PIN, TURNED OVER. It originally asserted the gap: the report exposed ROW-level rejection
    // codes and dropped the EXTRACT-level ones, so a wrong-column file came back `usable: false` and
    // `L0_NOT_READABLE` carrying NO code saying why — although the validator had computed them. For a
    // tool whose whole point is to name the missing fact, the one case where NH says "I cannot read this
    // at all" was the case where it explained least.
    //
    // Closed by surfacing the CODES ONLY. Two of the four fault details quote a header string taken from
    // the file, and `parseStrictCsv` takes `records[0]` as the header unconditionally — so a headerless
    // export makes the first DATA row the header and the detail would quote a real identifier or amount.
    // See `docs/EXTRACT_FAULT_REPORTING_V1.md`.
    expect(report.expectation.extractFaultCodes).toEqual(["NH-EX-1002", "NH-EX-1003"]);
    //
    // ...and the row-level answer is STILL empty, which is correct and is the distinction the original
    // pin was really protecting: no row was ever examined, so reporting a rejected row would assert work
    // that never happened. The two lists answer different questions and neither substitutes for the other.
    expect(report.expectation.rejectionCodes).toEqual([]);
    expect(report.expectation.rejectedRows).toBe(0);
  });

  it("MISSING OBLIGATION IDENTITY closes the capability and rejects no row", () => {
    // Capability gating per detector, never global dataset rejection — asserted through the real path on
    // the real examples rather than taken on trust.
    const header = parseStrictCsv(BILLING).header.filter((h) => h !== "obligation_ref");
    const rows = parseStrictCsv(BILLING).rows.map((r) => header.map((h) => r.cells[h]!).join(","));
    const withoutRef = `${header.join(",")}\n${rows.join("\n")}\n`;
    const { report, exitCode } = assessPairFromCsv(EXPECTATION, withoutRef, { currency: "USD" });
    expect(exitCode).toBe(0);                       // nothing is rejected
    expect(report.billing.usable).toBe(true);
    expect(report.billing.acceptedRows).toBe(parseStrictCsv(BILLING).rows.length);
    expect(report.level).toBe("L1_STRUCTURALLY_VALID"); // ...and the capability closes
    const blocked = report.blocked.map((b) => b.code);
    expect(blocked.some((c) => /^NH-BX-3\d{3}$/.test(c))).toBe(true);
  });
});

describe("4 · the argument refusals are falsifiable, not merely intended", () => {
  const ok = ["--expectation", "/e.csv", "--billing", "/b.csv", "--currency", "USD"];

  it("accepts exactly three flags, each once", () => {
    expect(parseArguments(ok)).toEqual({ expectation: "/e.csv", billing: "/b.csv", currency: "USD" });
  });

  it.each([
    ["too few", ok.slice(0, 4)],
    ["too many", [...ok, "--extra", "x"]],
    ["unknown flag", ["--expectation", "/e.csv", "--billing", "/b.csv", "--curr", "USD"]],
    ["duplicated flag", ["--expectation", "/e.csv", "--expectation", "/f.csv", "--currency", "USD"]],
    ["flag as value", ["--expectation", "--billing", "--billing", "/b.csv", "--currency", "USD"]],
    ["lowercase currency", ["--expectation", "/e.csv", "--billing", "/b.csv", "--currency", "usd"]],
    ["currency inferred", ["--expectation", "/e.csv", "--billing", "/b.csv", "--currency", "AUTO1"]],
    ["no currency at all", ["--expectation", "/e.csv", "--billing", "/b.csv", "--billing", "/c.csv"]],
  ])("refuses %s", (_label, argv) => {
    expect(() => parseArguments(argv)).toThrow(CsvTransportError);
  });

  it("the currency is REQUIRED, because inferring it would let the file decide which rows count", () => {
    // A row in another currency is excluded rather than converted, so whoever picks the currency picks
    // the population. That choice is the operator's, stated, and never read out of the data.
    expect(() => parseArguments(["--expectation", "/e.csv", "--billing", "/b.csv", "--currency", ""]))
      .toThrow(CsvTransportError);
  });
});

describe("5 · an NH defect is never reported as unreadable customer data", () => {
  it("the CLI separates the input's own refusal from our own failure", () => {
    // Asserted on source, because the alternative is a subprocess test that would be slow and flaky. The
    // property: CsvTransportError prints its own code, a filesystem errno prints LOCAL_INPUT_UNREADABLE,
    // and anything else — a validator throwing, a bug here — prints NH_INTERNAL_ERROR. Reporting an NH
    // defect as bad input is the NH-AX-1009 mistake: blaming the data for a claim we made.
    const src = readFileSync(resolve(__dirname, "assessPairCli.ts"), "utf8");
    expect(src).toContain("NH_INTERNAL_ERROR");
    expect(src).toContain("LOCAL_INPUT_UNREADABLE");
    expect(src).toMatch(/error instanceof CsvTransportError/);
    // ...and no branch writes a path, a row or the raw exception.
    const stripped = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    // BAN THE DANGEROUS FORMS, not the identifier. The first version of this check banned `error`
    // anywhere inside a `stderr.write`, which flagged `error.code` — our OWN governed transport code, and
    // exactly what should be printed. A guard that cannot tell a governed code from a raw exception
    // forbids the correct behaviour.
    for (const leak of [/error\.message/, /error\.stack/, /String\(error\)/, /\$\{error\}/,
      /stderr\.write\([^)]*\bargs\b/, /stderr\.write\([^)]*\bpath\b/, /stderr\.write\([^)]*Csv\b/]) {
      expect(stripped, `must not write ${leak.source}`).not.toMatch(leak);
    }
    // ...and the only things it may write are the governed code or one of two fixed strings.
    expect(stripped).toMatch(/stderr\.write\(`\$\{error\.code\}/);
  });

  it("nothing on this path persists, fetches or computes money", () => {
    const stripped = (f: string) => readFileSync(resolve(__dirname, f), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    for (const f of ["assessPairCore.ts", "assessPairCli.ts", "csvPairTransport.ts"]) {
      const code = stripped(f);
      for (const forbidden of ["prisma", "fetch(", "http", "writeFileSync", "appendFileSync",
        "reconciliationCore", "obligationAware", "domain/money", "domain/outcomes"]) {
        expect(code, `${f} must not reference ${forbidden}`).not.toContain(forbidden);
      }
    }
    // Only the CLI edge may touch the filesystem, and only to read.
    expect(stripped("assessPairCore.ts")).not.toContain("node:fs");
    expect(stripped("csvPairTransport.ts")).not.toContain("node:fs");
  });
});

// GAPS THIS PATH EXPOSED. The first was PATCHED and this block is its regression test; the second and
// third are still pinned, which is why the title names both states rather than one.
describe("6 · gaps this path EXPOSED · one fixed, the rest pinned", () => {
  it("at SOURCE_NATIVE the operator is told the one thing they can actually do", () => {
    // FOUND BY RUNNING THE COMMAND, which is why the local path was worth building — and this test is
    // the earlier pin TURNED OVER rather than deleted.
    //
    // It originally asserted the defect: `wouldBeLiftedBy` was computed as
    // `PROVENANCE_CHANNELS.filter((c) => !c.implemented)`, so at the rung a real local run actually
    // reaches it named the four channels that do NOT exist and omitted DATA_OWNER_ATTESTATION — the one
    // that is implemented, that reaches a strictly higher rung, and whose one-page form already ships in
    // `docs/pilot-intake/ATTESTATION.md`. The field answered *which channels are unbuilt* where the
    // question was *which would raise this rung*; the two coincided only while nothing was implemented.
    //
    // Corrected by deriving from the LADDER, and the two readings are now kept apart rather than
    // collapsed: `wouldBeLiftedBy` is everything above this rung, `availableNow` is what a customer can
    // act on today. See `docs/AUTHORITY_NEXT_ACTION_V1.md`.
    const { report } = assessPairFromCsv(EXPECTATION, BILLING, { currency: "USD" });
    expect(report.authority.reached).toBe("SOURCE_NATIVE");
    expect(report.authority.availableNow).toEqual(["DATA_OWNER_ATTESTATION"]);
    expect(report.authority.wouldBeLiftedBy).toContain("DATA_OWNER_ATTESTATION");
    // The premise that made it a defect, kept as the premise that makes the fix meaningful: the offered
    // channel is the only one whose rung is reachable from here at all.
    const spec = (c: string) => PROVENANCE_CHANNELS.find((p) => p.channel === c)!;
    expect(PROVENANCE_CHANNELS.filter((c) => c.implemented).map((c) => c.channel))
      .toEqual(["DATA_OWNER_ATTESTATION"]);
    expect(spec("DATA_OWNER_ATTESTATION").reaches).toBe("SOURCE_ATTESTED");
    // ...and the four that are still only a direction remain listed, so the gap keeps its shape.
    const unbuilt = report.authority.wouldBeLiftedBy.filter((c) => !spec(c).implemented);
    expect(unbuilt).toHaveLength(4);
    for (const c of unbuilt) expect(spec(c).reaches, c).toBe("AUTHORITY_VERIFIED");
    // The rung itself is UNMOVED by better advice — this slice changed guidance, not authority.
    expect(report.provisional).toBe(true);
    expect(report.attestation).toBeNull();
  });

  it("CURRENCY is the only reading term, and the asymmetry behind that is deliberate", () => {
    // ASKED AS A BLOCKER AND ANSWERED AS A DESIGN. The first form of this test claimed a European export
    // writing `31/01/2026` or `1.234,56` was a blocker on real data. It is not, and the evidence is in
    // the package we send: PILOT_DATA_REQUEST_V1 asks for timestamps `YYYY-MM-DD` and amounts "raw, as
    // recorded", and PRE_SUBMISSION_CHECKLIST names "dates reformatted to local order" and "amounts given
    // thousands separators" as spreadsheet damage to check for. A non-ISO file is a non-conforming file
    // and is refused with a named code, which the customer was told in advance.
    //
    // So the omission is load-bearing in two ways. `ExpectationExtractTerms` DOES carry optional
    // `dateLocale` and `amountFormat`; `BillingExtractTerms` carries NEITHER, because the billing
    // contract requires ISO outright. A `--date-locale` flag here would therefore read one half of a pair
    // and be refused on the other — and it would quietly accept locally a file the package tells the
    // customer to re-export. Both reasons point the same way, so the flag is absent on purpose.
    const terms = parseArguments(["--expectation", "/e.csv", "--billing", "/b.csv", "--currency", "USD"]);
    expect(Object.keys(terms).sort()).toEqual(["billing", "currency", "expectation"]);
    const core = readFileSync(resolve(__dirname, "assessPairCore.ts"), "utf8");
    expect(core).not.toMatch(/dateLocale|amountFormat/);
    // The premise, checked rather than recalled: the two validators' terms really are asymmetric.
    const billingTerms = readFileSync(
      resolve(__dirname, "..", "..", "src", "contract", "billingExtractValidator.ts"), "utf8");
    expect(billingTerms).toMatch(/interface BillingExtractTerms \{[^}]*\}/);
    expect(/interface BillingExtractTerms \{([^}]*)\}/.exec(billingTerms)![1]!)
      .not.toMatch(/dateLocale|amountFormat/);
  });
});

describe("7 · the verification covering this path cannot be escaped", () => {
  it("every .ts file in this directory is inside the typecheck project and CI runs it", () => {
    // THE GUARD ON THE GUARD. Two things had to be added for this code to be held to the same bar as
    // `src/`: a tsconfig project, because no project included `scripts/`, and a vitest include, because
    // neither suite collected these tests. Both are configuration, so both can be silently outgrown by a
    // new file — and the failure mode is invisible, which is why it is asserted rather than trusted.
    const root = resolve(__dirname, "..", "..");
    const project = JSON.parse(readFileSync(resolve(root, "tsconfig.scripts.json"), "utf8")
      .replace(/^\s*\/\/[^\n]*$/gm, "")) as { include: string[] };
    expect(project.include).toContain("scripts/data-readiness/**/*.ts");
    expect(JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"))
      .scripts["typecheck:scripts"]).toBe("tsc --noEmit -p tsconfig.scripts.json");
    expect(readFileSync(resolve(root, ".github", "workflows", "ci.yml"), "utf8"))
      .toContain("npm run typecheck:scripts");
    // ...and the test files are collected by the suite CI actually invokes.
    expect(readFileSync(resolve(root, "vite.config.ts"), "utf8"))
      .toContain('"scripts/data-readiness/**/*.test.ts"');
  });

  it("CI runs every read-only verifier, fail-closed", () => {
    // THE SECOND GAP THIS DIRECTORY'S WORK UNCOVERED. Nothing in the workflow called `pilot:verify`
    // (242 checks), `readiness:control` (25), `recon:verify` or `recon:ref:verify`, so four verifiers
    // guarding the customer-facing package and both frozen benchmark packages ran only by hand. *A test
    // CI never runs is not a guard* — asserted here because a workflow is configuration and
    // configuration is silently outgrown.
    //
    // `verify:evidence` joined them on 2026-10-16. It was the fifth, reported by that slice as still
    // outside the gate, and it could not be wired until the artefacts its records hash were tracked:
    // before that, all ten per cycle read `absent` on a clean checkout and it exited 1.
    //
    // `verify:baselines` is the sixth, added with the preservation ledger it verifies. A tracked record
    // nothing checks is a receipt for a lost artefact, so the gate and the preservation are one act.
    const root = resolve(__dirname, "..", "..");
    const ci = readFileSync(resolve(root, ".github", "workflows", "ci.yml"), "utf8");
    const scripts = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).scripts;
    const VERIFIERS = [
      "pilot:verify",
      "readiness:control",
      "recon:verify",
      "recon:ref:verify",
      "verify:evidence",
      "verify:baselines",
    ];
    for (const cmd of VERIFIERS) {
      expect(scripts[cmd], `${cmd} must exist as an npm script`).toBeTruthy();
      expect(ci, `CI must run ${cmd}`).toContain(`npm run ${cmd}`);
    }
    // FAIL-CLOSED, structurally. A step that swallowed a non-zero exit would leave the job green while
    // the verifier refused, which is worse than not running it: it would look like coverage.
    expect(ci).not.toContain("continue-on-error");
    // Built from the same list, so a seventh verifier cannot be added to one half and forgotten in the
    // other — the drift a hand-kept duplicate invites.
    //
    // NO ESCAPING, and that is the correction rather than an oversight. This generalisation's first form
    // escaped the colon as `\\:`, which inside a RegExp source means a literal BACKSLASH followed by a
    // colon — so the pattern matched nothing at all, including `|| true`. A colon needs no escaping in a
    // regex, which is why the hardcoded form it replaced worked. Fifteenth instance of the same lesson,
    // and the sharpest kind: a guard that cannot fire is not a weaker guard, it is no guard, and
    // generalising a working check is exactly when it happens. So the pattern is asserted to FIRE on a
    // swallowed exit before it is trusted not to fire on the real workflow.
    const swallowed = new RegExp(`npm run (${VERIFIERS.join("|")})[^\\n]*\\|\\|`);
    expect(swallowed.test("        run: npm run verify:baselines || true")).toBe(true);
    expect(swallowed.test("        run: npm run pilot:verify || echo ignored")).toBe(true);
    expect(swallowed.test("        run: npm run verify:baselines")).toBe(false);
    expect(ci).not.toMatch(swallowed);
    // ...and the frozen inputs these verifiers READ are tracked, or they throw ENOENT on a clean
    // checkout and the job is red for a reason that has nothing to do with the freeze.
    //
    // READ FROM GIT, NOT FROM THE FILESYSTEM. The first form of this check used `existsSync`, which
    // cannot establish the property the comment claims: a file present in a developer's working tree and
    // absent from the index is EXACTLY the state that made these verifiers fail on every clean checkout,
    // and it is invisible to `existsSync`. A structural guard must read the construct it is actually
    // asking about, and "tracked" is a fact about the index.
    const tracked = new Set(
      execFileSync("git", ["ls-files", "e2e/fixtures"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean),
    );
    for (const pkg of ["reconciliation-synthetic", "reconciliation-obligation-ref"]) {
      for (const f of ["expectation.csv", "observation.csv", "ground-truth.csv", "planted-register.json"]) {
        expect(tracked.has(`e2e/fixtures/${pkg}/${f}`), `${pkg}/${f} must be tracked`).toBe(true);
        expect(existsSync(resolve(root, "e2e", "fixtures", pkg, f)), `${pkg}/${f} must be present`).toBe(true);
      }
    }
  });

  it("no governed reading term is passed that the validator does not declare", () => {
    // THE DEFECT TYPECHECKING FOUND, pinned so it cannot return. `control.ts` passed
    // `asOf: "2026-06-30"` into `ExpectationExtractTerms`, which declares only `currency`, `dateLocale`
    // and `amountFormat`. It was inert — the validator never reads it, and the control still passes
    // 25/25 without it — but it read as a governed cut-off being supplied to a validator whose stated
    // property is that it consults NO clock. An excess property that looks like a governed term is worse
    // than a missing one, because a reviewer believes it.
    const terms = /interface ExpectationExtractTerms \{([\s\S]*?)\n\}/.exec(
      readFileSync(resolve(__dirname, "..", "..", "src", "contract", "expectationExtractValidator.ts"),
        "utf8"))![1]!;
    const declared = [...terms.matchAll(/readonly (\w+)\??:/g)].map((m) => m[1]!);
    expect(declared.sort()).toEqual(["amountFormat", "currency", "dateLocale"]);
    for (const f of ["control.ts", "assessPairCore.ts"]) {
      const code = readFileSync(resolve(__dirname, f), "utf8");
      expect(code, `${f} must not pass asOf as a reading term`).not.toMatch(/\basOf\b/);
    }
  });
});

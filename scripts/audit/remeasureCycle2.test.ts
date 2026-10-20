// FALSIFIERS FOR THE CYCLE-2 RE-MEASUREMENT.
//
// This instrument went through five forms before it measured anything correctly, and every defect was in
// the measurer rather than the product. The tests below are written against those specific failures,
// because a re-measurement that is wrong in the pessimistic direction still reads as rigour:
//
//   1. cent-tag decoding as the PRIMARY mechanism — blind to exactly the scenarios whose status changed,
//      because a tag is only given to a scenario the old truth expected to contribute money;
//   2. no FALSE-POSITIVE slot in the verdict vocabulary — $1,000.00 of money nobody owes filed as
//      "NOT_A_LEAKAGE" and never surfaced;
//   3. one dataset measured against a three-dataset denominator — a narrower question, quietly asked;
//   4. the false-positive rule keyed on `business_leakage_minor` rather than `expected_bucket`, which
//      flagged S09 for doing precisely what the truth predicted;
//   5. `supersedesPrediction` folding a commercial judgement into a build prediction.
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  CYCLE,
  EVIDENCE_RECORD,
  FIXTURE_DIR,
  REMEASURE_SCHEME,
  TRUTH_EXPOSURE_BUCKETS,
  assertUnquoted,
  decodeContributors,
  remeasure,
  splitRows,
  withhold,
  type ScenarioTruth,
} from "./remeasureCycle2";

const ROOT = resolve(__dirname, "..", "..");
const sha = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const DATASETS = ["dataset", "spot-multicurrency", "spot-cancelled-after-asof"] as const;

const truthJson = () => read(`${FIXTURE_DIR}/ground-truth.json`);
const csvOf = (n: string) => read(`${FIXTURE_DIR}/${n}.csv`);
const allDatasets = () => DATASETS.map((name) => ({ name, csv: csvOf(name) }));

describe("transport · the row splitter refuses what it cannot handle", () => {
  it("1 · a quoted CSV is REFUSED, never parsed approximately", () => {
    // A quoted field can hide a comma and silently mis-key a row, which would make every ablation wrong
    // in a way nothing downstream could detect. The licence for a minimal splitter is this refusal.
    expect(() => assertUnquoted('a,b\n"x,y",2\n')).toThrow(/double quote/);
    expect(() => assertUnquoted(csvOf("dataset"))).not.toThrow();
  });

  it("2 · withhold removes exactly the named entity's rows and nothing else", () => {
    const csv = csvOf("dataset");
    const { header, rows } = splitRows(csv);
    const target = rows[5]!.slice(0, rows[5]!.indexOf(","));
    const before = rows.filter((r) => r.startsWith(`${target},`)).length;
    expect(before).toBeGreaterThan(0);
    const after = splitRows(withhold(csv, new Set([target])));
    expect(after.header).toBe(header);
    expect(after.rows.length).toBe(rows.length - before);
    expect(after.rows.some((r) => r.startsWith(`${target},`))).toBe(false);
    // Every other row survives, in order.
    expect(after.rows).toEqual(rows.filter((r) => !r.startsWith(`${target},`)));
  });

  it("3 · withholding nothing is a no-op on the row set", () => {
    const csv = csvOf("dataset");
    expect(splitRows(withhold(csv, new Set())).rows).toEqual(splitRows(csv).rows);
  });
});

describe("cent-tag decoding · kept only as a cross-check, and it REFUSES rather than guesses", () => {
  const tagged = (ids: readonly [string, number][]): ScenarioTruth[] =>
    ids.map(([id, tag]) => ({
      scenario_id: id, entity_id: `e-${id}`, row_count: 1, business_class: "c",
      expected_bucket: "observedUnpaid", expected_cohort: "stalled", expected_payment_state: "Unpaid",
      expected_amount_minor: 100 + tag, cent_tag: tag, business_leakage_minor: 100 + tag,
      representable: true, nh_can_detect: true, expected_detector: "x",
    }));

  it("4 · a decodable cents value names exactly its contributors", () => {
    // 11 = 1 + 2 + 8, so all three. (This assertion's first form said ["A","C"] — my arithmetic, not the
    // decoder's; kept visible because the cents ARE a bitmask and reading one by eye is how the S09
    // defect went unnoticed for three weeks.)
    expect([...decodeContributors(500011, tagged([["A", 1], ["B", 2], ["C", 8]])).scenarioIds].sort())
      .toEqual(["A", "B", "C"]);
    // 9 = 1 + 8 → A and C only.
    const nine = decodeContributors(500009, tagged([["A", 1], ["B", 2], ["C", 8]]));
    expect(nine.undecodable).toBe(false);
    expect([...nine.scenarioIds].sort()).toEqual(["A", "C"]);
  });

  it("5 · cents that do not reconstruct are UNDECODABLE, not best-effort", () => {
    // The real case: the frozen truth's `partialOutstanding` tags sum to 7 while its own declared total's
    // cents are 8, because S09 carries `cent_tag: 4` against `expected_amount_minor: 5`. A lenient
    // decoder would have named a plausible subset and hidden a defect in the ruler.
    expect(decodeContributors(400008, tagged([["A", 1], ["B", 2], ["C", 4]])).undecodable).toBe(true);
  });

  it("6 · THE BLIND SPOT THAT DISQUALIFIED IT AS THE PRIMARY MECHANISM", () => {
    // An untagged scenario is structurally invisible to tag decoding, whatever money it moves. The frozen
    // truth gives `cent_tag: 0` to every scenario it expected to contribute nothing — which is exactly
    // the set whose status could change when a new detector ships.
    const untagged = [...tagged([["A", 1]]), ...tagged([["Z", 0]])];
    const r = decodeContributors(670001, untagged);
    expect(r.undecodable).toBe(false);
    expect(r.scenarioIds).toEqual(["A"]);
    expect(r.scenarioIds).not.toContain("Z");
  });
});

describe("the measurement · against the real frozen package", () => {
  it("7 · the inputs still hash to the tracked evidence record", async () => {
    const record = JSON.parse(read(EVIDENCE_RECORD)) as {
      datasets: { name: string; sha256: string }[];
      groundTruthSha256: string;
    };
    for (const name of DATASETS) {
      expect(sha(csvOf(name)), name).toBe(record.datasets.find((d) => d.name === name)?.sha256);
    }
    expect(sha(truthJson())).toBe(record.groundTruthSha256);
  });

  it("8 · COMPLETENESS · every dollar is attributed, on every field of every dataset", async () => {
    // The identity that resolved the first run's unexplained $1,000.00, and the only thing that can
    // detect the one case ablation cannot see directly: two rows masking each other would each show a
    // zero delta and the residual would be non-zero.
    const r = await remeasure({
      datasets: allDatasets(), groundTruthJson: truthJson(),
      measuredAt: "2026-10-16T00:00:00.000Z", buildRevision: "test",
    });
    for (const [name, m] of Object.entries(r.perDataset)) {
      for (const [field, v] of Object.entries(m.completeness)) {
        expect(v.residual, `${name} · ${field}`).toBe(0);
      }
    }
  }, 60_000);

  it("9 · the denominator is the RECORDED one — 11 classes over $122,250.66", async () => {
    // Measuring `dataset.csv` alone gave 10 classes over $115,550.66, because
    // `terminal_state_after_cutoff` has its rows in `spot-cancelled-after-asof.csv`. Comparing that to
    // the recorded figure would be V1's warning realised: two correct numbers about two different
    // denominators, quoted interchangeably.
    const r = await remeasure({
      datasets: allDatasets(), groundTruthJson: truthJson(),
      measuredAt: "2026-10-16T00:00:00.000Z", buildRevision: "test",
    });
    expect(r.coverage.businessClasses).toBe(11);
    expect(r.coverage.totalBusinessLeakageMinor).toBe(12225066);
    expect(r.coverage.notRepresentableValueMinor).toBe(6510000);
    expect(r.coverage.classesNotRepresentable).toBe(6);
  }, 60_000);

  it("10 · DETECTOR #2 closed exactly the $14,800.00 the recorded score called a gap", async () => {
    const r = await remeasure({
      datasets: allDatasets(), groundTruthJson: truthJson(),
      measuredAt: "2026-10-16T00:00:00.000Z", buildRevision: "test",
    });
    const d2 = r.ablations.filter((a) => a.detectedIn.includes("nonStalledExposure.overdueUnpaid"));
    expect(d2.map((a) => a.scenarioId).sort()).toEqual(["S17", "S18"]);
    expect(d2.reduce((n, a) => n + a.detectedMinor, 0)).toBe(1480000);
    // ...and that is the recorded `representableButNotDetectedValueMinor`, now zero.
    expect(r.coverage.representableNotDetectedValueMinor).toBe(0);
    expect(r.coverage.classesRepresentableNotDetected).toBe(0);
  }, 60_000);

  it("11 · the FALSE POSITIVE is surfaced, and it is S33 alone at $1,000.00", async () => {
    const r = await remeasure({
      datasets: allDatasets(), groundTruthJson: truthJson(),
      measuredAt: "2026-10-16T00:00:00.000Z", buildRevision: "test",
    });
    expect(r.falsePositives.map((f) => f.scenarioId)).toEqual(["S33"]);
    expect(r.falsePositiveMinor).toBe(100000);
    const fp = r.falsePositives[0]!;
    expect(fp.truthSays).toBe("row_excluded");
    expect(fp.bookedIn).toEqual(["observed.observedUnpaid"]);
  }, 60_000);

  it("12 · S09 is NOT flagged — the rule reads expected_bucket, not the commercial price", async () => {
    // The corrected rule. S09 is priced at zero because "one cent outstanding is not commercially
    // meaningful leakage", while the truth still expects it in `partialOutstanding` with
    // `nh_can_detect: true`. The product booking $0.05 there is exactly the prediction.
    expect(TRUTH_EXPOSURE_BUCKETS).toContain("partialOutstanding");
    const r = await remeasure({
      datasets: allDatasets(), groundTruthJson: truthJson(),
      measuredAt: "2026-10-16T00:00:00.000Z", buildRevision: "test",
    });
    const s09 = r.ablations.find((a) => a.scenarioId === "S09")!;
    expect(s09.verdict).toBe("NOT_A_LEAKAGE");
    expect(s09.supersedesPrediction).toBe(false);
    expect(s09.delta["observed.partialOutstanding"]).toBe(5);
  }, 60_000);

  it("13 · the cross-check agrees wherever the ruler's own tag arithmetic is self-consistent", async () => {
    const r = await remeasure({
      datasets: allDatasets(), groundTruthJson: truthJson(),
      measuredAt: "2026-10-16T00:00:00.000Z", buildRevision: "test",
    });
    const main = r.perDataset["dataset"]!;
    for (const x of main.crossCheck) {
      if (x.field === "observed.partialOutstanding") {
        expect(x.undecodable, "the S09 tag defect must stay visible, not be papered over").toBe(true);
        continue;
      }
      expect(x.undecodable, x.field).toBe(false);
      expect(x.agrees, x.field).toBe(true);
    }
  }, 60_000);

  it("14 · THE INSTRUMENT CAN FAIL · withholding a detected scenario makes it NOT_DETECTED", async () => {
    // A test that cannot fail is not a control. Remove S04's rows from the input entirely and the
    // ablation must report it undetected rather than carrying its $15,000.08 forward from somewhere.
    const csv = csvOf("dataset");
    const s04 = (JSON.parse(truthJson()) as { scenarios: ScenarioTruth[] }).scenarios
      .find((s) => s.scenario_id === "S04")!;
    const r = await remeasure({
      datasets: [
        { name: "dataset", csv: withhold(csv, new Set([s04.entity_id])) },
        { name: "spot-multicurrency", csv: csvOf("spot-multicurrency") },
        { name: "spot-cancelled-after-asof", csv: csvOf("spot-cancelled-after-asof") },
      ],
      groundTruthJson: truthJson(),
      measuredAt: "2026-10-16T00:00:00.000Z", buildRevision: "test",
    });
    const a = r.ablations.find((x) => x.scenarioId === "S04")!;
    expect(a.verdict).toBe("NOT_DETECTED");
    expect(a.rowsWithheld).toBe(0);
    expect(a.supersedesPrediction).toBe(true); // predicted detectable, now absent
  }, 60_000);

  it("15 · it is PURE · same inputs, same answer, and the clock is an input", async () => {
    const args = {
      datasets: allDatasets(), groundTruthJson: truthJson(),
      measuredAt: "2026-10-16T00:00:00.000Z", buildRevision: "test",
    };
    const a = await remeasure(args);
    const b = await remeasure(args);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(a.scheme).toBe(REMEASURE_SCHEME);
    expect(a.cycle).toBe(CYCLE);
    // The claim boundary is structural, not prose.
    expect(a.claimBoundary.isRecoveredRevenue).toBe(false);
    expect(a.claimBoundary.isProvenRevenueReturned).toBe(false);
  }, 120_000);
});

describe("the command · read-only, proved against the filesystem", () => {
  it("16 · a full CLI run leaves every frozen artefact byte-identical", () => {
    // TRACKED PATHS ONLY, and that is a correction. The first form included `FROZEN.json`, which is
    // deliberately untracked — so the test passed here and failed in CI with ENOENT. A test whose
    // premise is "my working copy has files the repository does not track" is a test about my working
    // copy, which is the same defect as the shallow-clone one, one day later. The list is now asserted
    // tracked, so an untracked path cannot silently re-enter it.
    const covered = [
      `${FIXTURE_DIR}/dataset.csv`,
      `${FIXTURE_DIR}/spot-multicurrency.csv`,
      `${FIXTURE_DIR}/spot-cancelled-after-asof.csv`,
      `${FIXTURE_DIR}/ground-truth.json`,
      `${FIXTURE_DIR}/prediction.json`,
      `${FIXTURE_DIR}/score.json`,
      EVIDENCE_RECORD,
    ];
    const tracked = new Set(
      execFileSync("git", ["ls-files", "e2e/"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean),
    );
    for (const p of covered) expect(tracked.has(p), `${p} must be tracked to be covered here`).toBe(true);
    const before = covered.map((p) => sha(read(p)));
    const outputBefore = sha(read("docs/audit/cycle2-remeasured-2026-10-16.json"));
    const recordedBefore = readdirSync(`${ROOT}/docs/audit`).sort();

    // THE COMMAND WRITES SOMEWHERE ELSE FOR THIS TEST, and that is the fix for a defect this test used
    // to carry. Its output path carries the date, so the "AGREES · nothing written" branch is only taken
    // when a file for TODAY already exists — the first run on each new calendar day wrote one instead,
    // failed here, and left an untracked file in `docs/`. A test that fails once a day because of the
    // clock is a test about the clock. Pointed at a temp directory it exercises BOTH branches on ANY
    // date, which is strictly more than it checked before.
    const outDir = mkdtempSync(join(tmpdir(), "nh-audit-"));
    const env = { ...process.env, NH_AUDIT_OUT_DIR: outDir };
    const first = spawnSync("npx", ["vite-node", "scripts/audit/remeasure-cycle2.ts"], {
      cwd: ROOT, encoding: "utf8", timeout: 180_000, env,
    });
    expect(first.status, first.stderr?.slice(0, 2000)).toBe(0);
    expect(first.stdout).toMatch(/^wrote /m);
    const written = readdirSync(outDir);
    expect(written).toHaveLength(1);
    const writtenBytes = sha(readFileSync(join(outDir, written[0]!), "utf8"));

    // A RE-RUN RE-DERIVES AND COMPARES, writing nothing. An output that every run rewrites dirties the
    // tree and cannot be the source of a quoted figure — the `results.json` problem, which this
    // command's first form reproduced.
    const second = spawnSync("npx", ["vite-node", "scripts/audit/remeasure-cycle2.ts"], {
      cwd: ROOT, encoding: "utf8", timeout: 180_000, env,
    });
    expect(second.status, second.stderr?.slice(0, 2000)).toBe(0);
    expect(second.stdout).toMatch(/re-derived and AGREES · nothing written/);
    expect(sha(readFileSync(join(outDir, written[0]!), "utf8"))).toBe(writtenBytes);

    // Nothing under the frozen package moved, and nothing was added to or changed in `docs/audit`.
    expect(covered.map((p) => sha(read(p)))).toEqual(before);
    expect(sha(read("docs/audit/cycle2-remeasured-2026-10-16.json"))).toBe(outputBefore);
    expect(readdirSync(`${ROOT}/docs/audit`).sort()).toEqual(recordedBefore);
    rmSync(outDir, { recursive: true, force: true });
  }, 240_000);

  it("17 · the module opens nothing under e2e/ — the I/O is all in the edge", () => {
    const core = read("scripts/audit/remeasureCycle2.ts");
    // Structural, reading the construct rather than the word: no fs import and no write call of any kind
    // in the pure core. A prose mention of a path is not an open.
    expect(core).not.toMatch(/^\s*import\s[^\n]*from\s+["']node:fs["']/m);
    expect(core).not.toMatch(/writeFileSync|appendFileSync|createWriteStream|openSync|rmSync|unlinkSync/);
    const edge = read("scripts/audit/remeasure-cycle2.ts");
    // The edge writes exactly one path, and it is not under e2e/.
    const writes = [...edge.matchAll(/writeFileSync\(([^,]+),/g)].map((m) => m[1]!.trim());
    expect(writes).toEqual(["out"]);
    // The DEFAULT target is `docs/audit`, and the override is an environment variable rather than an
    // argument — so nothing a caller passes on the command line can redirect a recorded measurement, and
    // the default is still pinned here. The property this line protects is "the edge writes under
    // docs/audit unless a test deliberately points it elsewhere", not the exact spelling of a constant.
    expect(edge).toMatch(/const OUT_DIR = process\.env\.NH_AUDIT_OUT_DIR \?\? "docs\/audit";/);
    expect(edge).not.toMatch(/OUT_DIR\s*=\s*process\.argv/);
  });

  it("18 · it is wired into the suite CI runs, and into the typecheck project", () => {
    // A test CI never runs is not a guard, and neither is a type nobody checks.
    expect(read("vite.config.ts")).toContain('"scripts/audit/**/*.test.ts"');
    expect(read("tsconfig.scripts.json")).toContain('"scripts/audit/**/*.ts"');
    expect(JSON.parse(read("package.json")).scripts["audit:remeasure"]).toBeTruthy();
  });

  it("19 · the dated output exists and agrees with a fresh in-process measurement", async () => {
    const out = JSON.parse(read("docs/audit/cycle2-remeasured-2026-10-16.json")) as {
      coverage: { classesDetectedNow: number; businessClasses: number; detectedValueMinor: number; totalBusinessLeakageMinor: number };
      falsePositiveMinor: number;
      scheme: string;
    };
    const fresh = await remeasure({
      datasets: allDatasets(), groundTruthJson: truthJson(),
      measuredAt: "2026-10-16T00:00:00.000Z", buildRevision: "test",
    });
    expect(out.scheme).toBe(REMEASURE_SCHEME);
    expect(out.coverage.businessClasses).toBe(fresh.coverage.businessClasses);
    expect(out.coverage.classesDetectedNow).toBe(fresh.coverage.classesDetectedNow);
    expect(out.coverage.detectedValueMinor).toBe(fresh.coverage.detectedValueMinor);
    expect(out.coverage.totalBusinessLeakageMinor).toBe(fresh.coverage.totalBusinessLeakageMinor);
    expect(out.falsePositiveMinor).toBe(fresh.falsePositiveMinor);
  }, 60_000);

  it("20 · git confirms no tracked file under e2e/ is MODIFIED or DELETED", () => {
    // Narrowed from "e2e/ is clean", which was imprecise: a staged ADDITION is not a modification, and
    // the first form went red while `score.json` was being added to the index — flagging the one change
    // the audit is allowed to make. The property that matters is that no EXISTING evidence moved.
    const lines = execFileSync("git", ["status", "--porcelain", "e2e/"], { cwd: ROOT, encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
    const touched = lines.filter((l) => /^(.[MD]|[MD].)/.test(l));
    expect(touched, `no tracked file under e2e/ may be modified or deleted, got:\n${touched.join("\n")}`).toEqual([]);
  });
});

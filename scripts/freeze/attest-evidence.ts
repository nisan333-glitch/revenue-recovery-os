// WRITES a tracked evidence record. This is the ONLY file in scripts/freeze/ that writes anything.
//
// It is deliberately separate from `verify-evidence.ts`, and named for what it does, because conflating the
// two is the original defect: `verify.mjs` writes a freeze and prints `FROZEN <digest>`, which reads as a
// verification, so running it looked like checking and was actually re-freezing.
//
// PROSPECTIVE vs HISTORICAL, and the difference is enforced rather than documented:
//   • prospective (default) — `systemUnderTestRevision` is taken from git and REFUSED if the tree is dirty,
//     because a dirty tree is not a revision and recording its last commit repeats the defect being fixed.
//   • `--historical-unknown` — records the literal `"unknown"` plus a downgrade marker and a stated reason.
//     Required for the two 2026-09 cycles: their recorded `gitHead` was produced by `git rev-parse HEAD`
//     with no dirty-tree check, and both trees were provably dirty (cycle 1's ground truth needs a generator
//     newer than its recorded commit; cycle 2's scripts did not exist at its recorded commit).
//
// It does NOT claim a historical Git freeze. None existed: `e2e/fixtures/` was gitignored in full when both
// cycles ran, so no dataset, ground truth, prediction or manifest was tracked at the time, and nothing
// establishes the bytes between the run and the attestation. The record states the date it attests from.
//
// Since 2026-10-16 the five hash-covered artefacts of each cycle are tracked, so a record written now is
// verifiable from a clean checkout. That is continuity from `attestedAt` forward. It is not provenance, and
// this tool must never be read as supplying any.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { assertProspectiveRevision, stableEvidenceDigest } from "../../src/evidence/evidenceIdentity";

const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const SCRIPTS = ["generate.mjs", "verify.mjs", "run.mjs", "score.mjs", "browser-confirm.mjs"];

function revision(historicalUnknown: boolean): string {
  if (historicalUnknown) return "unknown";
  const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim() !== "";
  const value = dirty ? `${head}-dirty` : head;
  assertProspectiveRevision(value); // throws on a dirty tree, by design
  return value;
}

const cycle = process.argv[2];
const historicalUnknown = process.argv.includes("--historical-unknown");
const reason = process.argv.find((a) => a.startsWith("--reason="))?.slice("--reason=".length);
if (!cycle) {
  console.error("usage: attest-evidence.ts <cycle> [--historical-unknown --reason=…]");
  process.exit(2);
}
const dir = `e2e/fixtures/${cycle}`;
const manifest = JSON.parse(readFileSync(`${dir}/FROZEN.json`, "utf8")) as Record<string, unknown>;

const record: Record<string, unknown> = {
  systemUnderTestRevision: revision(historicalUnknown),
  datasets: (manifest["datasets"] as { name: string }[]).map((d) => ({
    name: d.name,
    sha256: sha(readFileSync(`${dir}/${d.name}.csv`)),
  })),
  groundTruthSha256: sha(readFileSync(`${dir}/ground-truth.json`)),
  predictionSha256: sha(readFileSync(`${dir}/prediction.json`)),
  scriptSha256: Object.fromEntries(SCRIPTS.map((f) => [f, sha(readFileSync(`scripts/${cycle}/${f}`))])),
  runParameters: manifest["runParameters"],
  attestedAt: new Date().toISOString().slice(0, 10),
  // The two 2026-09-30 records carry an earlier wording of this note whose present-tense premise
  // ("e2e/fixtures/ is gitignored") the 2026-10-16 tracking commit made false. They are PRESERVED
  // UNCHANGED — they were accurate when written, they are attested evidence, and rewriting an attestation
  // is precisely what this scheme exists to forbid. The correction lives here, in the verifier's derived
  // continuity line, and in docs/EVIDENCE_PRESERVATION_V1.md.
  attestedNote:
    "Attests to components verified on the attestedAt date, and to continuity from that date forward — " +
    "NOT to original historical provenance. There was no original Git freeze: these artefacts were " +
    "untracked when the cycle ran, so nothing establishes the bytes between the run and the attestation. " +
    "Metadata below is reported, never hashed.",
};
if (historicalUnknown) {
  record["historicalReproducibility"] = "downgraded";
  record["historicalReproducibilityReason"] =
    reason ?? "the tested product revision cannot be established from the preserved repository state";
}
record["evidenceIdentity"] = await stableEvidenceDigest(record);

mkdirSync("e2e/evidence", { recursive: true });
const out = `e2e/evidence/${cycle}.evidence.json`;
writeFileSync(out, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8" });
console.log(`wrote ${out}\n  evidenceIdentity: ${record["evidenceIdentity"]}\n  systemUnderTestRevision: ${record["systemUnderTestRevision"]}`);

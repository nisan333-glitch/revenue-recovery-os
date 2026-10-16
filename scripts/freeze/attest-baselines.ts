// WRITES the tracked preservation ledger for the reconciliation benchmark's historical baselines.
//
// It is the ONLY writer for that ledger, kept separate from `verify-baselines.ts` and named for the act it
// performs, because conflating the two is the original defect this directory exists to correct: the old
// `verify.mjs` wrote a freeze and printed `FROZEN <digest>`, so running it looked like checking and was
// actually re-freezing.
//
// WHAT IT ATTESTS: that these bytes were present and hashed to these values on the date it records.
// Continuity from that date forward, and nothing earlier. It claims NO original provenance, NO historical
// reproducibility and NO independent validation, and those three refusals are required literals in
// `baselineLedger.ts` rather than sentences here — see `REQUIRED_CLAIMS`.
//
// IT NEVER BACKDATES. `attestedAt` is today's date from the clock. A ledger dated to when the measurements
// were taken would assert exactly the continuity nobody can establish.
//
// IT NEVER REGENERATES A BASELINE. It opens the baseline files for READING only; the single file it writes
// is the ledger. If a declared baseline is missing it refuses rather than producing a ledger that quietly
// covers fourteen files, and if an undeclared `baseline.*` is on disk it refuses rather than absorbing it.
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  BASELINE_LEDGER_SCHEME,
  DECLARED_BASELINES,
  RECORDED_BASELINE,
  baselineContinuityLine,
  citesHash,
  stableBaselineLedgerDigest,
} from "../../src/evidence/baselineLedger";

const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const OUT = "e2e/evidence/reconciliation-baselines.evidence.json";

function refuse(reason: string): never {
  console.error(`REFUSED · ${reason}\nNothing was written.`);
  process.exit(1);
}

// ── 1 · the declared set must be exactly what is on disk ─────────────────────────────────────────
const dirs = [...new Set(DECLARED_BASELINES.map((p) => p.slice(0, p.lastIndexOf("/"))))];
const onDisk = dirs.flatMap((d) =>
  readdirSync(d).filter((f) => f.startsWith("baseline.")).map((f) => `${d}/${f}`),
).sort();
const undeclared = onDisk.filter((p) => !DECLARED_BASELINES.includes(p));
if (undeclared.length > 0) {
  refuse(
    `undeclared baseline artefact(s) on disk: ${undeclared.join(", ")}. The set is DECLARED, never ` +
      "globbed: absorbing a new file into a ledger whose prose was written about the old set is how a " +
      "schema inferred from its own rows loses a column. Declare it in DECLARED_BASELINES deliberately.",
  );
}

const entries = DECLARED_BASELINES.map((path) => {
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch {
    return refuse(`declared baseline ${path} is absent — a ledger covering fourteen of fifteen files is not the ledger`);
  }
  return { path, sha256: sha(bytes), bytes: bytes.length };
});

// ── 2 · the one authenticated baseline, checked against its witness rather than asserted ─────────
const recorded = entries.find((e) => e.path === RECORDED_BASELINE.path);
if (!recorded) refuse(`${RECORDED_BASELINE.path} is not in the declared set`);
if (recorded.sha256 !== RECORDED_BASELINE.sha256) {
  refuse(
    `${RECORDED_BASELINE.path} hashes ${recorded.sha256.slice(0, 16)}… but the repository records ` +
      `${RECORDED_BASELINE.sha256.slice(0, 16)}… — the bytes and the record disagree, which is a stop ` +
      "condition and not something to write down",
  );
}
const doc = readFileSync(RECORDED_BASELINE.recordedHashSource, "utf8");
if (!citesHash(doc, RECORDED_BASELINE.sha256)) {
  refuse(
    `${RECORDED_BASELINE.recordedHashSource} does not cite ${RECORDED_BASELINE.sha256.slice(0, 16)}… — ` +
      "the citation is verified against the document, never copied into the ledger and trusted",
  );
}

// ── 3 · the ledger ───────────────────────────────────────────────────────────────────────────────
// `attestingRevision` is the revision at which the bytes were HASHED. It is excluded metadata, reported
// and never hashed, and it may never be read as the revision that PRODUCED a measurement — which is why
// `producingRevision` sits beside it as a covered field whose value is NOT_ESTABLISHED.
const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim() !== "";

const ledger: Record<string, unknown> = {
  ledgerScheme: BASELINE_LEDGER_SCHEME,
  authenticatedBaselines: [
    {
      ...recorded,
      recordedHashSource: RECORDED_BASELINE.recordedHashSource,
      recordedCoreSha256: RECORDED_BASELINE.recordedCoreSha256,
      recordedCoreCommit: RECORDED_BASELINE.recordedCoreCommit,
    },
  ],
  unauthenticatedBaselines: entries.filter((e) => e.path !== RECORDED_BASELINE.path),
  producingRevision: "NOT_ESTABLISHED",
  producingRevisionReason:
    "No baseline artefact carries a core revision, a scorer revision or a timestamp — the JSON files' only " +
    "top-level keys are totalPlantedMinor, knownCases, unknownCases, mustRefuseCases and candidates — and " +
    "none was ever Git-tracked, so nothing in the repository states which build produced which " +
    "measurement. The one exception is bounded: docs/BENCHMARK_REVISION_V2.md records one baseline's hash " +
    "beside core c80b35c5…, which establishes WHICH MEASUREMENT those bytes are and not who produced them " +
    "or when.",
  historicalReproducibility: "NOT_CLAIMED",
  historicalReproducibilityReason:
    "The reconciliation core has moved four times since the earliest of these baselines " +
    "(c80b35c5 -> 831b2dab -> ec1efe95 -> fdc6c785 -> 60e71f6f). A pre-correction baseline cannot be " +
    "reproduced on this build: the execution would be blocked by the calculation-method compatibility " +
    "gate before anything was computed. No reproduction was attempted and none is asserted.",
  independentValidation: "NONE",
  independentValidationReason:
    "Every artefact here was produced, retained and now attested by the same party. The benchmark is " +
    "synthetic throughout and no figure in it is a proven monetary outcome.",
  attestedAt: new Date().toISOString().slice(0, 10),
  attestingRevision: dirty ? `${head}-dirty` : head,
  attestedNote:
    "Attests that these bytes were present and hashed to these values on the attestedAt date, and to " +
    "continuity from that date forward. NOT original provenance, NOT historical reproducibility, NOT " +
    "independent validation. Metadata is reported, never hashed; attestingRevision is when we LOOKED and " +
    "is never the revision that produced a measurement.",
};
ledger["ledgerIdentity"] = await stableBaselineLedgerDigest(ledger);

mkdirSync("e2e/evidence", { recursive: true });
writeFileSync(OUT, `${JSON.stringify(ledger, null, 2)}\n`, { encoding: "utf8" });
console.log(`wrote ${OUT}`);
console.log(`   ledger identity   : ${ledger["ledgerIdentity"]}`);
console.log(`   ${baselineContinuityLine(ledger)}`);
console.log(`   authenticated     : 1 · ${RECORDED_BASELINE.path} (cited in ${RECORDED_BASELINE.recordedHashSource})`);
console.log(`   unauthenticated   : ${(ledger["unauthenticatedBaselines"] as unknown[]).length}`);
console.log(`   attesting revision: ${ledger["attestingRevision"]} · when we looked, NOT what produced these`);

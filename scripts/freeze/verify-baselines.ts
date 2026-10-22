// Read-only verification of the reconciliation benchmark's historical baselines against their TRACKED
// preservation ledger.
//
// IT OPENS NOTHING FOR WRITING. It re-hashes every declared baseline from disk, re-derives the ledger
// identity from the ledger's own covered components, and re-checks the one recorded hash against the
// document that records it. It never regenerates a baseline, and it never presents a regenerated object as
// a historical measurement — which, for these files, would be impossible anyway: no command writes a
// `baseline.*` file, so there is nothing to regenerate them with.
//
// WHAT A PASS MEANS: the bytes are unchanged since the ledger's attestedAt date. Nothing more. The ledger
// states NOT_ESTABLISHED for the producing revision, NOT_CLAIMED for historical reproducibility and NONE
// for independent validation, and it prints all three on every run so a green CI step cannot be read as
// more than it is.
//
// WHY THE DOCUMENT IS RE-READ rather than the ledger's own copy being trusted: *a governed definition is
// verified against its own witness wherever it is resolved for use, not trusted as stored.* Copying the
// hash into the ledger and comparing the ledger against itself is the agreement that can only agree — the
// register-tamper-evidence defect, and the reference-first scheduling defect before it.
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  BASELINE_COVERED_COMPONENTS,
  BASELINE_EXCLUDED_METADATA,
  DECLARED_BASELINES,
  RECORDED_BASELINE,
  baselineContinuityLine,
  citesHash,
  stableBaselineLedgerDigest,
  type BaselineEntry,
} from "../../src/evidence/baselineLedger";

const LEDGER = "e2e/evidence/reconciliation-baselines.evidence.json";
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

interface Failure {
  readonly kind: "absent" | "mismatch" | "identity" | "undeclared" | "citation" | "claim";
  readonly detail: string;
}

function readOrAbsent(path: string): Buffer | null {
  try {
    return readFileSync(path);
  } catch {
    return null;
  }
}

const failures: Failure[] = [];

const raw = readOrAbsent(LEDGER);
if (raw === null) {
  console.error(`tracked baseline ledger ${LEDGER} is missing — nothing was regenerated and nothing was written`);
  process.exit(1);
}
const ledger = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;

// ── 1 · every declared baseline, re-hashed from disk ─────────────────────────────────────────────
const entries = [
  ...(ledger["authenticatedBaselines"] as BaselineEntry[]),
  ...(ledger["unauthenticatedBaselines"] as BaselineEntry[]),
];
for (const entry of entries) {
  const bytes = readOrAbsent(entry.path);
  if (bytes === null) {
    failures.push({ kind: "absent", detail: `${entry.path} is absent — it cannot be verified from this checkout` });
    continue;
  }
  const got = sha(bytes);
  if (got !== entry.sha256) {
    failures.push({
      kind: "mismatch",
      detail: `${entry.path} hashes ${got.slice(0, 16)}… but the ledger says ${entry.sha256.slice(0, 16)}…`,
    });
  }
  if (bytes.length !== entry.bytes) {
    failures.push({ kind: "mismatch", detail: `${entry.path} is ${bytes.length} bytes, ledger says ${entry.bytes}` });
  }
}

// ── 2 · nothing undeclared has appeared beside them ──────────────────────────────────────────────
const dirs = [...new Set(DECLARED_BASELINES.map((p) => p.slice(0, p.lastIndexOf("/"))))];
for (const dir of dirs) {
  let found: string[];
  try {
    found = readdirSync(dir);
  } catch {
    failures.push({ kind: "absent", detail: `${dir} is absent` });
    continue;
  }
  for (const file of found.filter((f) => f.startsWith("baseline."))) {
    const path = `${dir}/${file}`;
    if (!DECLARED_BASELINES.includes(path)) {
      failures.push({
        kind: "undeclared",
        detail: `${path} is on disk and not in the declared set — declare it deliberately, never absorb it`,
      });
    }
  }
}

// ── 3 · the recorded hash is still cited by the document that records it ─────────────────────────
const authenticated = ledger["authenticatedBaselines"] as readonly BaselineEntry[];
if (authenticated.length !== 1 || authenticated[0]?.path !== RECORDED_BASELINE.path) {
  failures.push({
    kind: "claim",
    detail: `the authenticated set must be exactly [${RECORDED_BASELINE.path}] — it is the only baseline whose hash the repository records`,
  });
} else {
  const doc = readOrAbsent(RECORDED_BASELINE.recordedHashSource);
  if (doc === null) {
    failures.push({ kind: "citation", detail: `${RECORDED_BASELINE.recordedHashSource} is absent` });
  } else if (!citesHash(doc.toString("utf8"), RECORDED_BASELINE.sha256)) {
    failures.push({
      kind: "citation",
      detail:
        `${RECORDED_BASELINE.recordedHashSource} no longer cites ${RECORDED_BASELINE.sha256.slice(0, 16)}… — ` +
        "the authenticated baseline's only external witness is gone, so it is no longer authenticated",
    });
  }
}

// ── 4 · the ledger identity, recomputed from the ledger's own covered components ─────────────────
// So an edit to the LEDGER is caught as well as an edit to a baseline. `stableBaselineLedgerDigest` also
// enforces the three required claim literals and the disjointness of the two sets, so a softened claim
// cannot reach the comparison at all — it throws first.
const recordedIdentity = ledger["ledgerIdentity"];
let computed = "<refused>";
try {
  computed = await stableBaselineLedgerDigest(ledger);
  if (recordedIdentity !== computed) {
    failures.push({
      kind: "identity",
      detail: `ledger identity is ${computed} but the ledger claims ${String(recordedIdentity)}`,
    });
  }
} catch (error) {
  failures.push({ kind: "claim", detail: error instanceof Error ? error.message : String(error) });
}

// ── report ───────────────────────────────────────────────────────────────────────────────────────
console.log("\n── reconciliation benchmark baselines");
console.log(`   ledger identity   : ${computed}${recordedIdentity === computed ? " · matches the tracked ledger" : " · MISMATCH"}`);
console.log(`   ${baselineContinuityLine(ledger)}`);
for (const key of BASELINE_EXCLUDED_METADATA.filter((k) => k in ledger && k !== "ledgerIdentity")) {
  console.log(`   metadata · ${key}: ${String(ledger[key])}`);
}
console.log(`   covered components: ${BASELINE_COVERED_COMPONENTS.join(", ")}`);
for (const failure of failures) console.error(`   ✗ ${failure.kind}: ${failure.detail}`);
if (failures.length > 0) {
  console.error(
    `\n${failures.length} baseline verification failure(s). Nothing was regenerated and nothing was written.`,
  );
  process.exit(1);
}
console.log(`   ✓ ${entries.length} preserved baselines verified · 1 authenticated, ${entries.length - 1} not`);
console.log("\nbaselines verified — bytes unchanged since the ledger's attestedAt, and no claim beyond that");

// Read-only verification of a synthetic-validation cycle against its TRACKED evidence record.
//
// WHAT MAKES THIS DIFFERENT FROM `verify.mjs`. That script is a freeze-CREATION step whose name and whose
// `FROZEN <digest>` output read as verification: it rewrites `prediction.json` and `FROZEN.json`, stamps the
// current clock and the current `git rev-parse HEAD`, and prints a digest of what it just wrote. Running it
// can therefore never fail on a provenance change, because it overwrites the provenance — and running it is
// what destroyed the originally recorded `gitHead` and `frozenAt` in both cycles' manifests.
//
// So this file opens NOTHING for writing. It compares what is on disk against a record that is committed to
// Git, and it either agrees, disagrees, or says which artifact is missing. It never regenerates anything, and
// it never presents a regenerated object as historical proof.
//
// IT DOES NOT CLAIM A HISTORICAL GIT FREEZE. Neither cycle ever had one — `.gitignore` excludes all of
// `e2e/fixtures/`, so no dataset, ground truth, prediction or manifest was ever tracked. A record here
// attests to components verified on the date it was written, which each record states.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  COVERED_COMPONENTS,
  EXCLUDED_METADATA,
  stableEvidenceDigest,
} from "../../src/evidence/evidenceIdentity";

const CYCLES: Readonly<Record<string, string>> = {
  "synthetic-validation": "e2e/fixtures/synthetic-validation",
  "synthetic-validation-2026-09-27": "e2e/fixtures/synthetic-validation-2026-09-27",
};

const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

interface Failure {
  readonly kind: "absent" | "mismatch" | "identity";
  readonly detail: string;
}

function readOrAbsent(path: string): Buffer | null {
  try {
    return readFileSync(path);
  } catch {
    return null;
  }
}

async function verifyCycle(cycle: string, dir: string): Promise<readonly Failure[]> {
  const recordPath = `e2e/evidence/${cycle}.evidence.json`;
  const raw = readOrAbsent(recordPath);
  if (raw === null) return [{ kind: "absent", detail: `tracked evidence record ${recordPath} is missing` }];
  const record = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
  const failures: Failure[] = [];

  // Every covered file, re-hashed from disk. An ABSENT artifact is named rather than silently skipped: these
  // files are gitignored, so a clean clone legitimately has none of them, and that must read as "cannot be
  // verified here", never as "verified".
  const fileChecks: readonly { readonly path: string; readonly want: string }[] = [
    ...(record["datasets"] as { name: string; sha256: string }[]).map((d) => ({
      path: `${dir}/${d.name}.csv`,
      want: d.sha256,
    })),
    { path: `${dir}/ground-truth.json`, want: record["groundTruthSha256"] as string },
    { path: `${dir}/prediction.json`, want: record["predictionSha256"] as string },
    ...Object.entries(record["scriptSha256"] as Record<string, string>).map(([file, want]) => ({
      path: `scripts/${cycle}/${file}`,
      want,
    })),
  ];

  for (const { path, want } of fileChecks) {
    const bytes = readOrAbsent(path);
    if (bytes === null) {
      failures.push({ kind: "absent", detail: `${path} is absent — it cannot be verified from this checkout` });
      continue;
    }
    const got = sha(bytes);
    if (got !== want) {
      failures.push({ kind: "mismatch", detail: `${path} hashes ${got.slice(0, 16)}… but the record says ${want.slice(0, 16)}…` });
    }
  }

  // The identity is recomputed from the record's own covered components and compared to the recorded value,
  // so an edit to the record itself is caught as well as an edit to the artifacts.
  const recorded = record["evidenceIdentity"];
  const computed = await stableEvidenceDigest(record);
  if (recorded !== computed) {
    failures.push({
      kind: "identity",
      detail: `evidence identity is ${computed} but the record claims ${String(recorded)}`,
    });
  }

  console.log(`\n── ${cycle}`);
  console.log(`   evidence identity : ${computed}${recorded === computed ? " · matches the tracked record" : " · MISMATCH"}`);
  console.log(`   tested revision   : ${String(record["systemUnderTestRevision"])}` +
    (record["historicalReproducibility"] ? ` · ${String(record["historicalReproducibility"])}` : ""));
  // Metadata is REPORTED and never hashed. Printing it beside the identity is the whole point: a reader can
  // see the provenance fields without being invited to treat them as part of the evidence.
  const metadata = EXCLUDED_METADATA.filter((key) => key in record && key !== "evidenceIdentity");
  for (const key of metadata) console.log(`   metadata · ${key}: ${String(record[key]).slice(0, 96)}`);
  console.log(`   covered components: ${COVERED_COMPONENTS.join(", ")}`);
  for (const failure of failures) console.error(`   ✗ ${failure.kind}: ${failure.detail}`);
  if (failures.length === 0) console.log(`   ✓ ${fileChecks.length} covered artifacts verified`);
  return failures;
}

const requested = process.argv.slice(2);
const cycles = requested.length > 0 ? requested : Object.keys(CYCLES);
let total = 0;
for (const cycle of cycles) {
  const dir = CYCLES[cycle];
  if (!dir) {
    console.error(`unknown cycle '${cycle}' — known: ${Object.keys(CYCLES).join(", ")}`);
    process.exit(2);
  }
  total += (await verifyCycle(cycle, dir)).length;
}
if (total > 0) {
  console.error(`\n${total} evidence verification failure(s). Nothing was regenerated and nothing was written.`);
  process.exit(1);
}
console.log("\nevidence verified — identities match the tracked records, and no artifact was rewritten");

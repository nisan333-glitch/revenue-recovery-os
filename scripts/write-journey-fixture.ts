// EP-19 · The browser journey's fixture, written by the repository's own generator.
//
// It exists as a pre-step rather than an import inside `e2e/journey.mjs` because that harness is
// plain ESM JavaScript and the generator is TypeScript in `src/contract/`. Going through the real
// generator (instead of pasting rows into the harness) is the point: the browser journey and the
// server matrix then exercise the same bytes, and a change to the contract cannot leave the
// browser test quietly asserting against a stale copy.
//
// SYNTHETIC ONLY. Every identifier carries a `synthetic-` prefix so a leaked row is obviously fake.
import { mkdir, writeFile } from "node:fs/promises";
import { SCENARIO_POLICY, syntheticPilotCsv, syntheticScenarios, SYNTHETIC_PROVENANCE } from "../src/contract/syntheticPilotDataset";

const ROW_COUNT = 24;
// A SECOND dataset, from the same generator at a different size, for the frozen-policy section.
//
// It cannot reuse `journey.synthetic.csv`. `deriveIdempotencyKey(boundary, sha256(csvText))` keys a
// submission by its exact bytes, and the journey has already submitted those bytes successfully for
// this boundary — a re-upload is refused as a DUPLICATE SUBMISSION, which is a different rule and
// would surface as a conflict error rather than the governance refusal under test. Different row
// count, same generator, so nothing here is hand-written or invented.
const FROZEN_ROW_COUNT = 26;
const directory = "e2e/fixtures";
await mkdir(directory, { recursive: true });

await writeFile(`${directory}/journey.synthetic.csv`, syntheticPilotCsv(ROW_COUNT), {
  encoding: "utf8",
  mode: 0o600,
});
await writeFile(`${directory}/journey.frozen.synthetic.csv`, syntheticPilotCsv(FROZEN_ROW_COUNT), {
  encoding: "utf8",
  mode: 0o600,
});
await writeFile(
  `${directory}/journey.fixture.json`,
  `${JSON.stringify({ rowCount: ROW_COUNT, policy: SCENARIO_POLICY, provenance: SYNTHETIC_PROVENANCE,
    scenarios: syntheticScenarios().map(({ id, csvText, expected }) => ({ id, csvText, expected })),
  }, null, 2)}\n`,
  { encoding: "utf8", mode: 0o600 },
);
console.log(`wrote SYNTHETIC journey fixture (${ROW_COUNT} + ${FROZEN_ROW_COUNT} rows) to ${directory}/`);

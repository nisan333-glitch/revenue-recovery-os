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
const directory = "e2e/fixtures";
await mkdir(directory, { recursive: true });

await writeFile(`${directory}/journey.synthetic.csv`, syntheticPilotCsv(ROW_COUNT), {
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
console.log(`wrote SYNTHETIC journey fixture (${ROW_COUNT} rows) to ${directory}/`);

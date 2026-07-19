// NH renderer (Mission #009, Increment 4) — synthetic golden-fixture regression tests (node:test).
// Run: node --test research/renderer/test/golden.test.mjs
//
// The golden fixture is a fully-synthetic, schema-valid dataset (M900) that exercises the complete
// currently supported rendering surface (Charter + Research Record §A–§I) with controlled
// NOT_POPULATED fields. golden-output.md is a frozen regression ORACLE generated from the fixture by
// the current renderer; these tests fail if the renderer's output ever drifts from it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { loadDataset } from "../../validator/load.mjs";
import { renderMissionCharter, renderResearchRecord } from "../render.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIX = resolve(__dirname, "..", "fixtures");
const DATASET = resolve(FIX, "golden-dataset.json");
const GOLDEN = resolve(FIX, "golden-output.md");

// The exact CLI composition (Charter + blank line + Research Record).
const compose = (ds) => renderMissionCharter(ds) + "\n" + renderResearchRecord(ds);
const render = () => compose(loadDataset(DATASET));
const golden = () => readFileSync(GOLDEN, "utf8");

test("golden: render matches the committed golden file byte-for-byte", () => {
  assert.equal(render(), golden());
});

test("golden: rendering twice is byte-identical (determinism)", () => {
  assert.equal(render(), render());
});

test("golden: expected section ordering (Charter → §A → §B → §C–§I)", () => {
  const md = render();
  const iCharter = md.indexOf("# Mission Charter");
  const iObs = md.indexOf("## Observations (§A)");
  const iInf = md.indexOf("## Inferences (§B)");
  const iClaims = md.indexOf("## Claims (3)");
  const iVerdicts = md.indexOf("## Verdicts (3)");
  assert.ok(iCharter >= 0 && iObs > iCharter, "Charter before §A");
  assert.ok(iInf > iObs, "§A before §B");
  assert.ok(iClaims > iInf, "§B before Claims");
  assert.ok(iVerdicts > iClaims, "Claims before Verdicts");
});

test("golden: all synthetic object IDs are preserved in the render", () => {
  const md = render();
  const ids = [
    "M900",
    "M900-C1", "M900-C2", "M900-C3",
    "M900-C1-E1", "M900-C1-E2", "M900-C2-E1", "M900-C2-E2",
    "S901", "S902", "S903",
    "M900-A1", "M900-U1", "M900-X1",
    "O1", "O2", "O3", "O4",
  ];
  for (const id of ids) assert.ok(md.includes(id), `render missing id ${id}`);
});

test("golden: controlled NOT_POPULATED behaviour", () => {
  const md = render();
  // Deliberately omitted in the fixture: mission.revision_history and source S902.version_or_archive_info.
  assert.match(md, /\| revision_history \| NOT_POPULATED \|/);
  // Populated on S901 but omitted on S902 -> S901's value is present and the marker exists.
  assert.ok(md.includes("synthetic v1 archived"), "S901 version_or_archive_info populated");
  assert.ok(md.includes("NOT_POPULATED"), "NOT_POPULATED marker present for deliberately-empty fields");
  // Inconclusive claim M900-C3 has empty supporting_evidence -> renders NOT_POPULATED, never blank.
  assert.match(md, /\| M900-C3 \|[^\n]*NOT_POPULATED/);
});

test("golden: fixture object counts (1/3/4/3/1/1/1/3)", () => {
  const ds = loadDataset(DATASET);
  assert.equal(ds.mission ? 1 : 0, 1);
  assert.equal(ds.claims.length, 3);
  assert.equal(ds.evidence.length, 4);
  assert.equal(ds.sources.length, 3);
  assert.equal(ds.assumptions.length, 1);
  assert.equal(ds.unknowns.length, 1);
  assert.equal(ds.contradictions.length, 1);
  assert.equal(ds.verdicts.length, 3);
});

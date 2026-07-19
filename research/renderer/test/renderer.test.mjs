// NH renderer (Mission #009) — unit + fidelity tests (node:test, zero-dep).
// Run: node --test research/renderer/test/renderer.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { loadDataset } from "../../validator/load.mjs";
import {
  renderResearchRecord,
  renderMissionCharter,
  renderObservations,
  renderInferences,
  cell,
  mdEscape,
  NOT_POPULATED,
} from "../render.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXPORTS = resolve(__dirname, "..", "..", "exports");
const M007 = resolve(EXPORTS, "mission-007", "dataset.json");
// Mission #008 File 3 — used ONLY as a read-only fidelity oracle, never as a layout template.
const ORACLE = resolve(EXPORTS, "mission-008", "RECONSTRUCTED_RESEARCH_RECORD.md");

const dataset007 = () => loadDataset(M007);

test("determinism: rendering the same dataset twice is byte-identical", () => {
  const a = renderResearchRecord(dataset007());
  const b = renderResearchRecord(dataset007());
  assert.equal(a, b);
});

test("section counts match the dataset (7/8/5/1/1/1/7)", () => {
  const md = renderResearchRecord(dataset007());
  assert.match(md, /## Claims \(7\)/);
  assert.match(md, /## Evidence \(8\)/);
  assert.match(md, /## Sources \(5\)/);
  assert.match(md, /## Assumptions \(1\)/);
  assert.match(md, /## Unknowns \(1\)/);
  assert.match(md, /## Contradictions \(1\)/);
  assert.match(md, /## Verdicts \(7\)/);
});

test("every object ID from the dataset appears in the render (no omission)", () => {
  const ds = dataset007();
  const md = renderResearchRecord(ds);
  for (const c of ds.claims) assert.ok(md.includes(c.claim_id), `missing ${c.claim_id}`);
  for (const e of ds.evidence) assert.ok(md.includes(e.evidence_id), `missing ${e.evidence_id}`);
  for (const s of ds.sources) assert.ok(md.includes(s.source_id), `missing ${s.source_id}`);
  for (const a of ds.assumptions) assert.ok(md.includes(a.assumption_id), `missing ${a.assumption_id}`);
  for (const u of ds.unknowns) assert.ok(md.includes(u.unknown_id), `missing ${u.unknown_id}`);
  for (const x of ds.contradictions) assert.ok(md.includes(x.contradiction_id), `missing ${x.contradiction_id}`);
});

test("column order is derived from the schema, not from any Markdown", () => {
  const md = renderResearchRecord(dataset007());
  // Claim schema property order begins claim_id, statement, claim_type, scope, ...
  assert.match(md, /\| claim_id \| statement \| claim_type \| scope \|/);
  // Evidence schema property order begins evidence_id, source_id, claim_id, exact_finding, ...
  assert.match(md, /\| evidence_id \| source_id \| claim_id \| exact_finding \|/);
});

test("absent/empty fields render as the uniform NOT_POPULATED marker", () => {
  // Minimal synthetic dataset: a claim missing every optional field.
  const minimal = {
    validator_dataset_version: "1",
    mission: { mission_id: "MTEST" },
    claims: [
      {
        claim_id: "MTEST-C1",
        statement: "x",
        claim_type: "Causal",
        scope: "s",
        materiality: "L2",
        current_verdict: "Inconclusive",
        confidence: "Low",
        overturn_conditions: "o",
      },
    ],
  };
  const md = renderResearchRecord(minimal);
  assert.ok(md.includes(NOT_POPULATED), "expected NOT_POPULATED for absent optional fields");
  // e.g. supporting_evidence is absent -> must be marked, not blank/omitted.
  assert.match(md, /\| MTEST-C1 \|.*NOT_POPULATED/);
});

test("cell(): arrays join, empties mark, objects render key:value", () => {
  assert.equal(cell(["a", "b"]), "a; b");
  assert.equal(cell([]), NOT_POPULATED);
  assert.equal(cell(""), NOT_POPULATED);
  assert.equal(cell(undefined), NOT_POPULATED);
  assert.equal(cell(false), "false");
  assert.equal(cell({ k: 1 }), "k: 1");
});

test("mdEscape(): pipes and newlines are neutralised", () => {
  assert.equal(mdEscape("a|b"), "a\\|b");
  assert.equal(mdEscape("a\nb"), "a b");
});

test("fidelity oracle: every claim & source ID in Mission #008 File 3 also appears in the render", () => {
  const md = renderResearchRecord(dataset007());
  const oracle = readFileSync(ORACLE, "utf8");
  const ids = new Set((oracle.match(/M007-C\d+\b/g) || []).concat(oracle.match(/\bS00\d\b/g) || []));
  assert.ok(ids.size >= 12, "oracle should expose the M007 claim & source IDs");
  for (const id of ids) assert.ok(md.includes(id), `render missing oracle ID ${id}`);
});

// ---- Increment 2: Charter + §A/§B ----

test("charter: deterministic and field order derived from the mission schema", () => {
  const a = renderMissionCharter(dataset007());
  const b = renderMissionCharter(dataset007());
  assert.equal(a, b); // byte-stable
  assert.match(a, /# Mission Charter/);
  // schema property order begins mission_id, title, decision_supported, cost_if_wrong, ...
  assert.match(a, /\| mission_id \| M007 \|/);
  assert.match(a, /\| title \| Native JSON Authoring Validation/);
  assert.ok(a.indexOf("| mission_id |") < a.indexOf("| title |"), "mission_id before title");
  assert.ok(a.indexOf("| title |") < a.indexOf("| decision_supported |"), "title before decision_supported");
});

test("charter: fields absent from the M007 mission object render as NOT_POPULATED", () => {
  const a = renderMissionCharter(dataset007());
  for (const f of ["cost_if_wrong", "definitions", "stakeholders", "time_sensitivity", "pre_research_position", "revision_history"]) {
    assert.match(a, new RegExp(`\\| ${f} \\| ${NOT_POPULATED} \\|`), `${f} should be NOT_POPULATED`);
  }
});

test("§A observations: O-pointers surfaced from researcher_notes, prose NOT_POPULATED", () => {
  const a = renderObservations(dataset007());
  assert.match(a, /## Observations \(§A\)/);
  for (const p of ["O1", "O2", "O3", "O4", "O5"]) assert.ok(a.includes(`| ${p} |`), `missing pointer ${p}`);
  // O1 is shared by C1-E1, C2-E1, C4-E1 and maps to S001; prose is not stored.
  assert.match(a, /\| O1 \| M007-C1-E1; M007-C2-E1; M007-C4-E1 \| S001 \| NOT_POPULATED \|/);
});

test("§A observations: pointer set matches the committed M007 record used as a read-only oracle", () => {
  const a = renderObservations(dataset007());
  // Oracle: the committed Mission #007 research record (read-only comparison, not a template).
  const oraclePath = resolve(__dirname, "..", "..", "missions", "mission-007", "RESEARCH_RECORD.md");
  const oracle = readFileSync(oraclePath, "utf8");
  const ptrs = new Set(oracle.match(/\bO\d+\b/g) || []);
  assert.ok(ptrs.size >= 5, "oracle should expose O1..O5");
  for (const p of ptrs) assert.ok(a.includes(`| ${p} |`), `render missing oracle pointer ${p}`);
});

test("§B inferences: claim origin + confidence_rationale and contradiction reasoning surfaced", () => {
  const b = renderInferences(dataset007());
  assert.match(b, /## Inferences \(§B\)/);
  assert.match(b, /### Per-claim reasoning/);
  assert.match(b, /\| M007-C1 \| Initial anchor hypothesis, tested against Cepeda 2006 \+ Dunlosky 2013\./);
  assert.match(b, /### Contradiction reasoning/);
  assert.match(b, /\| M007-X1 \| real but domain-limited effect; under-studied authentic settings \|/);
  assert.ok(b.includes(NOT_POPULATED), "inference prose is marked NOT_POPULATED");
});

test("research record now includes §A and §B ahead of the unchanged §C–§I spine", () => {
  const md = renderResearchRecord(dataset007());
  assert.ok(md.indexOf("## Observations (§A)") < md.indexOf("## Claims (7)"), "§A before Claims");
  assert.ok(md.indexOf("## Inferences (§B)") < md.indexOf("## Claims (7)"), "§B before Claims");
  // §C–§I spine preserved.
  assert.match(md, /## Claims \(7\)/);
  assert.match(md, /## Verdicts \(7\)/);
});

test("full CLI-composed output (charter + record) is byte-identical across runs", () => {
  const compose = () => renderMissionCharter(dataset007()) + "\n" + renderResearchRecord(dataset007());
  assert.equal(compose(), compose());
});

// NH renderer (Mission #009) — unit + fidelity tests (node:test, zero-dep).
// Run: node --test research/renderer/test/renderer.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { loadDataset } from "../../validator/load.mjs";
import { renderResearchRecord, cell, mdEscape, NOT_POPULATED } from "../render.mjs";

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

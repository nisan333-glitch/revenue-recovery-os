// NH Validator Stage A — unit + fixture-based adversarial tests (node:test, zero-dep).
// Run: node --test research/validator/test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { compileSchema, validate } from "../schema-validate.mjs";
import { validateDataset } from "../validate.mjs";
import { loadDataset, loadSchemas, normalise } from "../load.mjs";
import { ruleSchema } from "../rules.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIX = resolve(__dirname, "..", "fixtures");
const golden = () => JSON.parse(readFileSync(resolve(FIX, "golden-valid.json"), "utf8"));
const clone = (o) => structuredClone(o);
const types = (result) => result.events.map((e) => e.event_type);
const blockingTypes = (result) => result.events.filter((e) => e.blocking).map((e) => e.event_type);

// ---------- schema-subset validator: per-keyword unit tests -------------------
test("schema: type", () => {
  assert.equal(validate({ type: "string" }, "x").length, 0);
  assert.ok(validate({ type: "string" }, 5).length > 0);
  assert.ok(validate({ type: "integer" }, 1.5).length > 0);
  assert.equal(validate({ type: "array" }, []).length, 0);
});
test("schema: required + additionalProperties", () => {
  const s = { type: "object", properties: { a: { type: "string" } }, required: ["a"], additionalProperties: false };
  assert.equal(validate(s, { a: "x" }).length, 0);
  assert.ok(validate(s, {}).some((e) => e.includes("missing required")));
  assert.ok(validate(s, { a: "x", b: 1 }).some((e) => e.includes("additional property")));
});
test("schema: enum / pattern / minLength", () => {
  assert.ok(validate({ enum: ["A", "B"] }, "C").length > 0);
  assert.equal(validate({ enum: ["A", "B"] }, "A").length, 0);
  assert.ok(validate({ type: "string", pattern: "^M[0-9]{3,}$" }, "X1").length > 0);
  assert.equal(validate({ type: "string", pattern: "^M[0-9]{3,}$" }, "M900").length, 0);
  assert.ok(validate({ type: "string", minLength: 2 }, "a").length > 0);
});
test("schema: format date", () => {
  assert.equal(validate({ type: "string", format: "date" }, "2026-07-17").length, 0);
  assert.ok(validate({ type: "string", format: "date" }, "2026-13-40").length > 0);
  assert.ok(validate({ type: "string", format: "date" }, "not-a-date").length > 0);
});
test("schema: items / minItems / minimum / maximum", () => {
  assert.ok(validate({ type: "array", minItems: 2 }, [1]).length > 0);
  assert.ok(validate({ type: "array", items: { type: "integer", minimum: 0, maximum: 5 } }, [3, 9]).some((e) => e.includes("maximum")));
});
test("schema: allOf + if/then (claim L3/L4 conditional)", () => {
  const s = {
    type: "object",
    properties: { materiality: { enum: ["L1", "L2", "L3", "L4"] }, reviewer: { type: "string" } },
    allOf: [{ if: { properties: { materiality: { enum: ["L3", "L4"] } } }, then: { required: ["reviewer"] } }],
  };
  assert.equal(validate(s, { materiality: "L2" }).length, 0); // then not triggered
  assert.ok(validate(s, { materiality: "L3" }).some((e) => e.includes("reviewer"))); // then triggers
  assert.equal(validate(s, { materiality: "L3", reviewer: "x" }).length, 0);
});

// ---------- fail-closed on unsupported keywords -------------------------------
test("compileSchema flags unsupported keywords (fail-closed)", () => {
  assert.equal(compileSchema({ type: "object" }).length, 0);
  assert.ok(compileSchema({ oneOf: [{ type: "string" }] }).some((u) => u.keyword === "oneOf"));
  assert.ok(compileSchema({ $ref: "x.json" }).some((u) => u.keyword === "$ref"));
  assert.ok(compileSchema({ type: "string", format: "email" }).some((u) => u.keyword === "format:email"));
});
test("all 8 NH-ROP schemas are fully supported (no unsupported keyword)", () => {
  const schemas = loadSchemas();
  for (const [k, s] of Object.entries(schemas)) {
    assert.equal(compileSchema(s).length, 0, `schema ${k} has unsupported keywords`);
  }
});
test("ruleSchema fails closed when a schema uses an unsupported keyword", () => {
  const schemas = loadSchemas();
  schemas.claims = { ...schemas.claims, oneOf: [{ type: "object" }] };
  const norm = normalise(golden());
  const events = ruleSchema(norm, schemas);
  assert.ok(events.some((e) => e.event_type === "SCHEMA_VALIDATOR_UNSUPPORTED_KEYWORD" && e.blocking));
});

// ---------- golden-valid: no false positives ---------------------------------
test("golden-valid dataset => 0 errors, 0 warnings, exit 0", () => {
  const r = validateDataset(golden());
  assert.equal(r.summary.errors, 0, JSON.stringify(r.events, null, 2));
  assert.equal(r.summary.warnings, 0, JSON.stringify(r.events, null, 2));
  assert.equal(r.exit, 0);
});

// ---------- one adversarial fixture per BLOCKING rule ------------------------
test("R-SCHEMA: bad enum => SCHEMA_INVALID, exit 1, isolated", () => {
  const d = clone(golden());
  d.claims[0].current_verdict = "Maybe";
  const r = validateDataset(d);
  assert.equal(r.exit, 1);
  assert.deepEqual([...new Set(blockingTypes(r))], ["SCHEMA_INVALID"]);
});
test("R-ID-UNIQUE: duplicate claim id => ID_DUPLICATE, exit 1, isolated", () => {
  const d = clone(golden());
  d.claims.push({ ...clone(d.claims[1]), claim_id: "M900-C1" }); // dup of C1 (Unsupported => no evidence needed)
  const r = validateDataset(d);
  assert.equal(r.exit, 1);
  assert.deepEqual([...new Set(blockingTypes(r))], ["ID_DUPLICATE"]);
});
test("R-XREF: dangling evidence.claim_id => XREF_BROKEN, exit 1, isolated", () => {
  const d = clone(golden());
  d.evidence[0].claim_id = "M900-C999";
  const r = validateDataset(d);
  assert.equal(r.exit, 1);
  assert.ok(blockingTypes(r).includes("XREF_BROKEN"));
  assert.deepEqual([...new Set(blockingTypes(r))], ["XREF_BROKEN"]);
});
test("R-UNSUPPORTED-REF: supporting ref with wrong direction => mismatch, exit 1, isolated", () => {
  const d = clone(golden());
  d.evidence[0].direction = "Contradicts"; // still listed under C1.supporting_evidence
  const r = validateDataset(d);
  assert.equal(r.exit, 1);
  assert.deepEqual([...new Set(blockingTypes(r))], ["EVIDENCE_DIRECTION_MISMATCH"]);
});
test("R-VERDICT-CEILING: Confirmed on Weak evidence => VERDICT_EXCEEDS_EVIDENCE, exit 1", () => {
  const d = clone(golden());
  d.evidence[0].strength_category = "Weak";
  d.evidence[1].strength_category = "Weak";
  const r = validateDataset(d);
  assert.equal(r.exit, 1);
  assert.deepEqual([...new Set(blockingTypes(r))], ["VERDICT_EXCEEDS_EVIDENCE"]);
});
test("R-CONTRADICTION-MATERIAL: Confirmed + Material-remains => block, exit 1", () => {
  const d = clone(golden());
  d.contradictions.push({ contradiction_id: "M900-X2", in_conflict: ["M900-C1", "M900-C1-E1"], nature_of_conflict: "n", resolution_status: "Material-remains" });
  const r = validateDataset(d);
  assert.equal(r.exit, 1);
  assert.deepEqual([...new Set(blockingTypes(r))], ["CONTRADICTION_MATERIAL_UNRESOLVED"]);
});
test("R-ASSUMPTION-FATAL: Confirmed + Open Fatal assumption => block, exit 1", () => {
  const d = clone(golden());
  d.assumptions.push({ assumption_id: "M900-A1", statement: "s", why_needed: "w", risk_if_false: "Fatal", status: "Open", claims_affected: ["M900-C1"] });
  const r = validateDataset(d);
  assert.equal(r.exit, 1);
  assert.deepEqual([...new Set(blockingTypes(r))], ["ASSUMPTION_FATAL_OPEN"]);
});
test("R-UNKNOWN-BLOCKING: closing with blocking unknown => block, exit 1", () => {
  const d = clone(golden());
  d.mission.completion_status = "Closed";
  d.unknowns.push({ unknown_id: "M900-U1", exact_open_question: "q", why_it_matters: "m", materiality: "L2", blocks_decision: true, status: "Open" });
  const r = validateDataset(d);
  assert.equal(r.exit, 1);
  assert.deepEqual([...new Set(blockingTypes(r))], ["UNKNOWN_BLOCKS_CLOSURE"]);
});
test("R-CONFIRMED-NEEDS-EVIDENCE: Confirmed with no evidence => block (+strength warn)", () => {
  const d = clone(golden());
  d.claims[0].supporting_evidence = [];
  const r = validateDataset(d);
  assert.equal(r.exit, 1);
  assert.deepEqual([...new Set(blockingTypes(r))], ["VERDICT_UNSUPPORTED_BY_EVIDENCE"]);
  assert.ok(types(r).includes("VERDICT_STRENGTH_UNKNOWN")); // advisory, non-blocking
});

// ---------- advisory fixtures: exit 0, warning present -----------------------
test("R-LINEAGE: Confirmed on single lineage (>=2 ev) => advisory only, exit 0", () => {
  const d = clone(golden());
  d.evidence[1].independence_group = "L01"; // same as E1
  const r = validateDataset(d);
  assert.equal(r.exit, 0);
  assert.equal(r.summary.errors, 0);
  assert.ok(types(r).includes("LINEAGE_POSSIBLE_FALSE_INDEPENDENCE"));
});
test("R-REVENUE-PROVEN-REVIEW: Proven classification => advisory only, exit 0", () => {
  const d = clone(golden());
  d.verdicts.push({ claim_id: "M900-C1", verdict_status: "Confirmed", confidence: "Moderate", confidence_rationale: "r", scope_of_validity: "s", overturn_conditions: "o", review_date: "2026-07-17", reviewer: "x", outcome_ladder_classification: "Proven" });
  const r = validateDataset(d);
  assert.equal(r.exit, 0);
  assert.equal(r.summary.errors, 0);
  assert.ok(types(r).includes("REVENUE_PROVEN_REVIEW_REQUIRED"));
});
test("R-VERDICT-STRENGTH-UNKNOWN: Confirmed without strength_category => advisory, exit 0", () => {
  const d = clone(golden());
  delete d.evidence[0].strength_category;
  delete d.evidence[1].strength_category;
  const r = validateDataset(d);
  assert.equal(r.exit, 0);
  assert.equal(r.summary.errors, 0);
  assert.ok(types(r).includes("VERDICT_STRENGTH_UNKNOWN"));
});

// ---------- fail-closed load + malformed-but-parseable ------------------------
test("loadDataset throws on malformed JSON (=> CLI exit 2)", () => {
  assert.throws(() => loadDataset(resolve(FIX, "not-json.json")));
});
test("malformed-but-parseable: mission wrong type => SCHEMA_INVALID, exit 1", () => {
  const d = clone(golden());
  d.mission = "oops";
  const r = validateDataset(d);
  assert.equal(r.exit, 1);
  assert.ok(blockingTypes(r).includes("SCHEMA_INVALID"));
});

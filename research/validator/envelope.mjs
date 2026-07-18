// NH Validator Stage A — envelope validation (F-1).
// Deterministic, driven by research/validator/dataset.schema.json at the ENVELOPE
// level only. It enforces the contract's top-level `type`, `additionalProperties`,
// `required`, and each property's `type`/`items` shape. It does NOT resolve `$ref`
// (unsupported by the subset validator); per-element conformance is validated
// separately by ruleSchema against the loaded NH-ROP schemas.
//
// No coercion. No auto-correction. Unknown/misspelled top-level keys and non-array
// collections are rejected with a blocking ENVELOPE_INVALID event, never skipped.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { err, EVENT_TYPE } from "./events.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENVELOPE_SCHEMA_PATH = resolve(__dirname, "dataset.schema.json");

export function loadEnvelopeSchema() {
  return JSON.parse(readFileSync(ENVELOPE_SCHEMA_PATH, "utf8"));
}

const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const typeName = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);

// Fail-closed check that the contract only uses envelope constructs this validator
// maps. Returns ENVELOPE_CONTRACT_UNSUPPORTED events (=> exit 2) if not.
const TOP_OK = new Set(["$schema", "$id", "title", "description", "type", "additionalProperties", "required", "properties"]);
const PROP_OK = new Set(["$ref", "type", "items", "description"]);
const ITEM_OK = new Set(["$ref", "type", "description"]);

export function checkEnvelopeContract(schema) {
  const events = [];
  const flag = (target, kw) => events.push(err({
    rule_id: "R-ENVELOPE", event_type: EVENT_TYPE.ENVELOPE_CONTRACT_UNSUPPORTED, targets: [target],
    observation: `envelope contract uses keyword '${kw}' that the dedicated envelope validator does not map; failing closed.`,
    protocol_ref: "validator envelope contract",
  }));
  for (const k of Object.keys(schema)) if (!TOP_OK.has(k)) flag("dataset.schema.json", k);
  for (const [pk, pv] of Object.entries(schema.properties ?? {})) {
    if (!isObj(pv)) continue;
    for (const kk of Object.keys(pv)) if (!PROP_OK.has(kk)) flag(`dataset.schema.json#/properties/${pk}`, kk);
    if (isObj(pv.items)) for (const kk of Object.keys(pv.items)) if (!ITEM_OK.has(kk)) flag(`dataset.schema.json#/properties/${pk}/items`, kk);
  }
  return events;
}

// Validate a dataset instance against the envelope contract (envelope level only).
// Returns blocking ENVELOPE_INVALID events (=> exit 1). Empty array = envelope OK.
export function validateEnvelope(dataset, schema) {
  const events = [];
  const bad = (path, reason) => events.push(err({
    rule_id: "R-ENVELOPE", event_type: EVENT_TYPE.ENVELOPE_INVALID, targets: [path], observation: reason,
    protocol_ref: "dataset.schema.json (envelope contract)",
  }));

  if (!isObj(dataset)) { bad("$", `dataset envelope must be a JSON object, got ${typeName(dataset)}`); return events; }

  const props = schema.properties ?? {};
  const required = schema.required ?? [];
  const additionalFalse = schema.additionalProperties === false;

  for (const r of required) {
    if (!(r in dataset)) bad(`$.${r}`, `missing required envelope property '${r}'`);
  }
  if (additionalFalse) {
    for (const k of Object.keys(dataset)) {
      if (!(k in props)) bad(`$.${k}`, `unknown top-level property '${k}' (envelope additionalProperties:false) — misspelled key or non-contract data is not silently skipped`);
    }
  }
  for (const [pk, pv] of Object.entries(props)) {
    if (!(pk in dataset)) continue; // optional collections may be absent (contract), validated elsewhere if present
    const val = dataset[pk];
    if (pv.type === "array") {
      if (!Array.isArray(val)) bad(`$.${pk}`, `collection '${pk}' must be an array, got ${typeName(val)} (no coercion)`);
    } else if (pv.$ref) {
      if (!isObj(val)) bad(`$.${pk}`, `'${pk}' must be an object, got ${typeName(val)} (no coercion)`);
    } else if (pv.type === "string") {
      if (typeof val !== "string") bad(`$.${pk}`, `'${pk}' must be a string, got ${typeName(val)}`);
    }
  }
  return events;
}

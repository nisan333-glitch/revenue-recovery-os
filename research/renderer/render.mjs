// NH JSON->Markdown renderer (Mission #009) — pure, deterministic, zero-dependency.
//
// Derivation constraint (binding): output is derived ONLY from dataset.json + the frozen schemas.
// Column order and section order come from the schema/envelope contract, never copied from any
// hand-authored Markdown. Absent/empty fields render as a single uniform marker (never omitted,
// never fabricated). No clock, no randomness -> byte-identical for a given input.
import { loadSchemas, normalise } from "../validator/load.mjs";

export const NOT_POPULATED = "NOT_POPULATED";

// Section order = the dataset envelope's typed-array order (from the validator's TYPE_SCHEMAS),
// minus the singular `mission`. This is a property of the contract, not of any document.
export const RECORD_SECTIONS = [
  "claims",
  "evidence",
  "sources",
  "assumptions",
  "unknowns",
  "contradictions",
  "verdicts",
];

const title = (key) => key.charAt(0).toUpperCase() + key.slice(1);

// Render a single scalar leaf deterministically.
function scalar(v) {
  if (v === undefined || v === null) return NOT_POPULATED;
  if (typeof v === "boolean") return v ? "true" : "false";
  const s = String(v).trim();
  return s === "" ? NOT_POPULATED : s;
}

// Render any field value into one table cell. Arrays -> "; " join; objects -> "k: v" pairs in
// key order; empty containers/blank strings -> NOT_POPULATED.
export function cell(v) {
  if (v === undefined || v === null) return NOT_POPULATED;
  if (Array.isArray(v)) return v.length ? v.map(scalar).join("; ") : NOT_POPULATED;
  if (typeof v === "object") {
    const keys = Object.keys(v);
    return keys.length ? keys.map((k) => `${k}: ${scalar(v[k])}`).join("; ") : NOT_POPULATED;
  }
  return scalar(v);
}

// Escape a value for a Markdown table cell (pipes, backslashes, newlines).
export function mdEscape(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

// Render one object type as a Markdown table whose columns are the schema's property order.
export function renderTable(schema, rows) {
  const cols = Object.keys(schema.properties || {});
  const header = `| ${cols.join(" | ")} |`;
  const sep = `| ${cols.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${cols.map((c) => mdEscape(cell(r[c]))).join(" | ")} |`).join("\n");
  return [header, sep, body].join("\n");
}

// Render the Research Record sections C–I (structured spine) from a dataset envelope.
export function renderResearchRecord(dataset) {
  const schemas = loadSchemas();
  const n = normalise(dataset);
  const out = [];
  out.push("# Research Record — rendered from dataset.json (NH deterministic renderer)");
  out.push(
    "> Derived exclusively from `dataset.json` + the frozen schemas. Column order = schema property " +
      `order; section order = envelope contract. Absent or empty fields render as \`${NOT_POPULATED}\`. ` +
      "No content is inferred or copied from any hand-authored Markdown.",
  );
  const mid = dataset && dataset.mission ? cell(dataset.mission.mission_id) : NOT_POPULATED;
  out.push(`**Mission:** ${mdEscape(mid)}`);
  for (const key of RECORD_SECTIONS) {
    const rows = n[key];
    out.push(`## ${title(key)} (${rows.length})`);
    out.push(rows.length ? renderTable(schemas[key], rows) : "_(none in dataset)_");
  }
  return out.join("\n\n") + "\n";
}

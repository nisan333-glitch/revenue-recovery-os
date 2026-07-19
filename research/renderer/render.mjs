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

// Render a 2-column field/value table for a single object, columns = schema property order.
function fieldValueTable(schema, obj) {
  const cols = Object.keys(schema.properties || {});
  const header = "| field | value |";
  const sep = "| --- | --- |";
  const body = cols.map((c) => `| ${c} | ${mdEscape(cell(obj ? obj[c] : undefined))} |`).join("\n");
  return [header, sep, body].join("\n");
}

// Mission Charter — rendered from the mission object + the mission schema (field order = schema).
export function renderMissionCharter(dataset) {
  const schemas = loadSchemas();
  const schema = schemas.mission;
  const m = dataset && dataset.mission ? dataset.mission : null;
  const out = [];
  out.push("# Mission Charter — rendered from dataset.json (NH deterministic renderer)");
  out.push(
    "> Derived exclusively from `dataset.json` (mission object) + the frozen schema. Field order = " +
      `schema property order. Absent or empty fields render as \`${NOT_POPULATED}\`. No content is ` +
      "inferred or copied from any hand-authored Markdown.",
  );
  out.push(m ? fieldValueTable(schema, m) : "_(no mission object in dataset)_");
  return out.join("\n\n") + "\n";
}

// §A Observations — surface the O# pointers carried in evidence `researcher_notes`. The observation
// PROSE is not stored in the dataset, so it renders as the uniform marker (never fabricated).
function observationsBlock(n) {
  const map = new Map(); // "O#" -> { ev: string[], src: string[] } in dataset order
  for (const e of n.evidence) {
    if (typeof e.researcher_notes !== "string") continue;
    for (const p of e.researcher_notes.match(/\bO\d+\b/g) || []) {
      if (!map.has(p)) map.set(p, { ev: [], src: [] });
      const rec = map.get(p);
      if (e.evidence_id && !rec.ev.includes(e.evidence_id)) rec.ev.push(e.evidence_id);
      if (e.source_id && !rec.src.includes(e.source_id)) rec.src.push(e.source_id);
    }
  }
  const keys = [...map.keys()].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  const head =
    "## Observations (§A)\n\n" +
    "> Observation pointers surfaced from evidence `researcher_notes`. Observation prose is not stored " +
    `in the dataset -> \`${NOT_POPULATED}\`.`;
  if (!keys.length) return head + "\n\n_(no observation pointers in dataset)_";
  const rows = keys
    .map((k) => `| ${k} | ${mdEscape(map.get(k).ev.join("; "))} | ${mdEscape(map.get(k).src.join("; "))} | ${NOT_POPULATED} |`)
    .join("\n");
  return head + "\n\n| pointer | evidence | sources | observation_prose |\n| --- | --- | --- | --- |\n" + rows;
}

// §B Inferences — free-form reasoning prose is not stored; surface the structured reasoning fields
// that the dataset does carry (claim origin + confidence_rationale; contradiction reasoning).
function inferencesBlock(n) {
  const parts = [];
  parts.push(
    "## Inferences (§B)\n\n> Free-form inference prose is not stored in the dataset -> " +
      `\`${NOT_POPULATED}\`. The structured reasoning fields that do exist are surfaced below.`,
  );
  const claimRows = n.claims
    .map((c) => `| ${mdEscape(cell(c.claim_id))} | ${mdEscape(cell(c.origin))} | ${mdEscape(cell(c.confidence_rationale))} |`)
    .join("\n");
  parts.push(
    "### Per-claim reasoning\n\n| claim_id | origin | confidence_rationale |\n| --- | --- | --- |\n" +
      (claimRows || "_(no claims in dataset)_"),
  );
  const xHead = "### Contradiction reasoning";
  if (!n.contradictions.length) {
    parts.push(xHead + "\n\n_(no contradictions in dataset)_");
  } else {
    const xRows = n.contradictions
      .map((x) => `| ${mdEscape(cell(x.contradiction_id))} | ${mdEscape(cell(x.possible_explanations))} | ${mdEscape(cell(x.impact_on_verdict))} |`)
      .join("\n");
    parts.push(xHead + "\n\n| contradiction_id | possible_explanations | impact_on_verdict |\n| --- | --- | --- |\n" + xRows);
  }
  return parts.join("\n\n");
}

// Public standalone renderers for §A and §B (each a self-contained block + trailing newline).
export function renderObservations(dataset) {
  return observationsBlock(normalise(dataset)) + "\n";
}
export function renderInferences(dataset) {
  return inferencesBlock(normalise(dataset)) + "\n";
}

// Render the Research Record sections A–I from a dataset envelope. §A/§B are prepended to the
// unchanged §C–§I structured-spine loop.
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
  out.push(observationsBlock(n)); // §A
  out.push(inferencesBlock(n)); // §B
  for (const key of RECORD_SECTIONS) {
    const rows = n[key];
    out.push(`## ${title(key)} (${rows.length})`);
    out.push(rows.length ? renderTable(schemas[key], rows) : "_(none in dataset)_");
  }
  return out.join("\n\n") + "\n";
}

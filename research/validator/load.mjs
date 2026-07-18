// NH Validator Stage A — dataset + schema loader (read-only).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_DIR = resolve(__dirname, "..", "schemas");

// Map dataset array key -> schema file + object kind label.
export const TYPE_SCHEMAS = {
  mission: { file: "research-mission.schema.json", kind: "mission" },
  claims: { file: "claim.schema.json", kind: "claim" },
  evidence: { file: "evidence.schema.json", kind: "evidence" },
  sources: { file: "source.schema.json", kind: "source" },
  assumptions: { file: "assumption.schema.json", kind: "assumption" },
  unknowns: { file: "unknown.schema.json", kind: "unknown" },
  contradictions: { file: "contradiction.schema.json", kind: "contradiction" },
  verdicts: { file: "verdict.schema.json", kind: "verdict" },
};

export function loadSchemas() {
  const schemas = {};
  for (const [key, { file }] of Object.entries(TYPE_SCHEMAS)) {
    schemas[key] = JSON.parse(readFileSync(resolve(SCHEMA_DIR, file), "utf8"));
  }
  return schemas;
}

// Load a dataset JSON. Throws on parse/IO error (caller maps to exit 2).
export function loadDataset(path) {
  const raw = readFileSync(path, "utf8");
  const data = JSON.parse(raw);
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("dataset must be a JSON object envelope");
  }
  return data;
}

// Normalise the envelope into typed arrays (missing arrays => []).
export function normalise(dataset) {
  return {
    validator_dataset_version: dataset.validator_dataset_version,
    mission: dataset.mission ?? null,
    claims: dataset.claims ?? [],
    evidence: dataset.evidence ?? [],
    sources: dataset.sources ?? [],
    assumptions: dataset.assumptions ?? [],
    unknowns: dataset.unknowns ?? [],
    contradictions: dataset.contradictions ?? [],
    verdicts: dataset.verdicts ?? [],
  };
}

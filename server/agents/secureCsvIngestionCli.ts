import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { prisma } from "../db";
import { parseAgentProcessConfig } from "./config";
import { PostgresCaseCandidateStore } from "./postgresCaseCandidateStore";
import { ingestSecureCsv, SECURE_CSV_LIMITS, type SecureCsvIngestionOptions } from "./secureCsvIngestion";

async function main(): Promise<void> {
  const path = process.argv[2];
  if (!path || process.argv.length !== 3 || !isAbsolute(path)) {
    throw new Error("usage: ingest:csv /absolute/path/to/private.csv");
  }
  const boundaryId = requiredEnv("NH_INGEST_BOUNDARY_ID");
  const agentId = process.env.NH_INGEST_AGENT_ID?.trim() || "secure-csv-import";
  const detectorVersion = requiredEnv("NH_INGEST_DETECTOR_VERSION");
  const sourceRefKey = requiredEnv("NH_INGEST_SOURCE_REF_KEY");
  const admissionPolicies = parseAgentProcessConfig(process.env).admissionPolicies;
  if (admissionPolicies.size === 0) throw new Error("NH_AGENT_ADMISSION_POLICIES is required");
  const headerMap = parseHeaderMap(process.env.NH_INGEST_HEADER_MAP);

  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!before.isFile()) throw new Error("ingestion source must be a regular file");
    if ((before.mode & 0o077) !== 0) throw new Error("ingestion source permissions must not allow group/world access");
    if (before.size <= 0 || before.size > SECURE_CSV_LIMITS.maxBytes) throw new Error("ingestion source size is outside the secure limit");
    const raw = await handle.readFile();
    const after = await handle.stat();
    if (after.size !== before.size || raw.length !== before.size) throw new Error("ingestion source changed while it was being read");
    const options: SecureCsvIngestionOptions = {
      boundaryId, agentId, detectorVersion, sourceRefKey, policies: admissionPolicies,
      headerMap,
      confirmMappedHeaders: process.env.NH_INGEST_CONFIRM_HEADER_MAP === "true",
    };
    const result = await ingestSecureCsv(raw, new PostgresCaseCandidateStore(), options);
    console.log(JSON.stringify(result));
  } finally {
    await handle.close();
    await prisma.$disconnect();
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parseHeaderMap(raw: string | undefined): SecureCsvIngestionOptions["headerMap"] {
  if (!raw?.trim()) return undefined;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("NH_INGEST_HEADER_MAP must be valid JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("NH_INGEST_HEADER_MAP must be an object");
  return value as SecureCsvIngestionOptions["headerMap"];
}

if (require.main === module) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : "secure CSV ingestion failed");
    process.exitCode = 1;
  });
}

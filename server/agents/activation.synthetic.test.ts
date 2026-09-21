/** SYNTHETIC fixture acceptance. No customer-performance conclusions. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SUPPORTED_CURRENCIES } from "../../src/domain/money";
import { InMemoryCaseCandidateStore, type CaseCandidate } from "./caseAdmission";
import { ingestSecureCsv } from "./secureCsvIngestion";
import {
  SYNTHETIC_FIELDS, SYNTHETIC_OPTIONS, SYNTHETIC_POLICY,
  syntheticCsv, syntheticExpectedResults, syntheticRecords,
} from "./fixtures/activation.synthetic";
import expected from "./fixtures/activation.synthetic.expected-results.json";

const records = syntheticRecords();
const mixedPath = new URL("./fixtures/activation.synthetic.csv", import.meta.url);
const validPath = new URL("./fixtures/activation.well-formed.synthetic.csv", import.meta.url);
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

function recordingStore() {
  const store = new InMemoryCaseCandidateStore();
  const saved: CaseCandidate[] = [];
  const attempted: CaseCandidate[] = [];
  return {
    saved, attempted,
    async createIfAbsent(candidate: CaseCandidate) {
      attempted.push(candidate);
      const result = await store.createIfAbsent(candidate);
      if (result.created) saved.push(result.candidate);
      return result;
    },
  };
}

describe("SYNTHETIC ActivationMissed fixture", () => {
  it("keeps the committed CSV artifacts deterministic with exactly the existing seven columns", () => {
    expect(SYNTHETIC_FIELDS).toEqual([
      "sourceIdentity", "recoveryType", "observedAt", "amountAtRiskMinor",
      "currency", "actionAvailable", "expectedProofEvent",
    ]);
    expect(readFileSync(mixedPath, "utf8")).toBe(syntheticCsv());
    expect(readFileSync(validPath, "utf8")).toBe(syntheticCsv(records.slice(0, 95)));
    expect(syntheticCsv()).toBe(syntheticCsv(syntheticRecords()));
    expect(records).toHaveLength(100);
    expect(records.every((record) => record.recoveryType === "ActivationMissed")).toBe(true);
  });

  it("matches every saved per-row classification, reason, flag and batch outcome to measured output", async () => {
    expect(await syntheticExpectedResults()).toEqual(expected);
    expect(expected.rows.map((row) => row.rowNumber)).toEqual(Array.from({ length: 100 }, (_, index) => index + 1));
    const counts = Object.fromEntries(["admissible", "below_threshold", "no_action", "duplicate", "malformed"].map(
      (classification) => [classification, expected.rows.filter((row) => row.classification === classification).length],
    ));
    expect(counts).toEqual({ admissible: 70, below_threshold: 15, no_action: 5, duplicate: 5, malformed: 5 });
  });

  it("creates 70 pending candidates from the committed 95-row subset and persists synthetic provenance", async () => {
    const store = recordingStore();
    const result = await ingestSecureCsv(readFileSync(validPath), store, SYNTHETIC_OPTIONS);
    expect(result).toEqual({ rowsRead: 95, admitted: 75, created: 70, filtered: 20, rawCsvPersisted: false });
    expect(store.saved).toHaveLength(70);
    for (const candidate of store.saved) {
      expect(candidate.status).toBe("pending_review");
      expect(candidate.boundaryId).toContain("SYNTHETIC");
      expect(candidate.agentId).toContain("SYNTHETIC");
      expect(candidate.signal.detectorVersion).toContain("SYNTHETIC");
      expect(candidate.signal.expectedProofEvent).toContain("SYNTHETIC");
      expect(candidate.signal.sourceRef).toMatch(/^hmac-sha256:[a-f0-9]{64}$/);
    }
    const persisted = JSON.stringify(store.saved);
    expect(persisted).not.toContain("sourceIdentity");
    for (const record of records.filter((record) => record.sourceIdentity)) {
      expect(persisted).not.toContain(record.sourceIdentity.trim());
    }
    expect(expected.label).toBe("SYNTHETIC");
    expect(expected.containsRealCustomerData).toBe(false);
  });

  it("rejects the full mixed file before persistence and preserves both input buffers and disk bytes", async () => {
    for (const [path, reject] of [[mixedPath, true], [validPath, false]] as const) {
      const input = readFileSync(path);
      const before = Buffer.from(input);
      const store = recordingStore();
      if (reject) {
        await expect(ingestSecureCsv(input, store, SYNTHETIC_OPTIONS)).rejects.toThrow("CSV row 97 amountAtRiskMinor is invalid");
        expect(store.attempted).toHaveLength(0);
      } else {
        await ingestSecureCsv(input, store, SYNTHETIC_OPTIONS);
      }
      expect(input.equals(before)).toBe(true);
      expect(hash(readFileSync(path))).toBe(hash(before));
    }
  });

  it("does not create more candidates on exact or reordered replay and leaves the first observations unchanged", async () => {
    const store = recordingStore();
    const input = readFileSync(validPath);
    await ingestSecureCsv(input, store, SYNTHETIC_OPTIONS);
    const saved = JSON.stringify(store.saved);
    for (const replay of [input, syntheticCsv([...records.slice(0, 95)].reverse())]) {
      await expect(ingestSecureCsv(replay, store, SYNTHETIC_OPTIONS))
        .resolves.toMatchObject({ rowsRead: 95, admitted: 75, created: 0, filtered: 20 });
      expect(JSON.stringify(store.saved)).toBe(saved);
    }
  });

  it("deduplicates semantic observations even when their payload hashes differ", async () => {
    const store = recordingStore();
    await ingestSecureCsv(syntheticCsv([records[2]!, records[92]!]), store, SYNTHETIC_OPTIONS);
    expect(store.saved).toHaveLength(1);
    expect(store.attempted[0]!.signal.sourcePayloadHash).not.toBe(store.attempted[1]!.signal.sourcePayloadHash);
    expect(store.attempted[0]!.dedupeKey).toBe(store.attempted[1]!.dedupeKey);
    expect(store.saved[0]!.signal.amountAtRiskMinor).toBe(50_000);
  });

  it("preserves supplied composite identities despite shared account, event and resource labels", async () => {
    const store = recordingStore();
    expect(records[68]!.sourceIdentity.split("|")[1]).toBe(records[69]!.sourceIdentity.split("|")[1]);
    expect(records[68]!.expectedProofEvent).toBe(records[69]!.expectedProofEvent);
    await expect(ingestSecureCsv(syntheticCsv([records[68]!, records[69]!, records[94]!]), store, SYNTHETIC_OPTIONS))
      .resolves.toMatchObject({ admitted: 3, created: 2 });
    expect(new Set(store.saved.map((candidate) => candidate.dedupeKey)).size).toBe(2);
  });

  it("keeps the same supplied identity distinct across boundaries and stable within one boundary", async () => {
    const store = recordingStore();
    const input = syntheticCsv([records[0]!]);
    for (const boundaryId of ["SYNTHETIC-boundary-a", "SYNTHETIC-boundary-b", "SYNTHETIC-boundary-a"]) {
      await ingestSecureCsv(input, store, { ...SYNTHETIC_OPTIONS, boundaryId });
    }
    expect(store.saved).toHaveLength(2);
    expect(store.saved[0]!.signal.sourceRef).not.toBe(store.saved[1]!.signal.sourceRef);
  });

  it("round-trips quoted commas and doubled quotes without changing proof-event text", async () => {
    const store = recordingStore();
    const csv = syntheticCsv([records[0]!]);
    expect(csv).toContain('"SYNTHETIC activation completed, resource ""synthetic-shared-resource"""');
    await ingestSecureCsv(csv, store, SYNTHETIC_OPTIONS);
    expect(store.saved[0]!.signal.expectedProofEvent).toBe(records[0]!.expectedProofEvent);
  });

  it.each(SUPPORTED_CURRENCIES)("uses the existing inclusive threshold in %s without currency conversion", async (currency) => {
    const store = recordingStore();
    for (const [amount, created] of [[9_999, 0], [10_000, 1], [10_001, 1]] as const) {
      const record = { ...records[0]!, sourceIdentity: `synthetic-boundary-value-${amount}`, currency, amountAtRiskMinor: String(amount) };
      await expect(ingestSecureCsv(syntheticCsv([record]), store, SYNTHETIC_OPTIONS)).resolves.toMatchObject({ created });
    }
  });

  it.each([
    [95, "amountAtRiskMinor", "10000", "CSV row 2 amountAtRiskMinor is invalid"],
    [96, "observedAt", "2026-02-28T12:00:00.000Z", "CandidateSignal.observedAt must be a valid ISO timestamp"],
    [97, "sourceIdentity", "synthetic-account-0098", "CSV row 2 sourceIdentity is required"],
    [98, "currency", "USD", "CandidateSignal.currency must be a supported currency code"],
    [99, "expectedProofEvent", "SYNTHETIC activation completed", "CandidateSignal.expectedProofEvent must be a non-empty string"],
  ] as const)("isolates negative row index %i and repairs only %s", async (index, field, repair, message) => {
    const store = recordingStore();
    await expect(ingestSecureCsv(syntheticCsv([records[index]!]), store, SYNTHETIC_OPTIONS)).rejects.toThrow(message);
    expect(store.attempted).toHaveLength(0);
    await expect(ingestSecureCsv(syntheticCsv([{ ...records[index]!, [field]: repair }]), store, SYNTHETIC_OPTIONS))
      .resolves.toMatchObject({ created: 1 });
  });

  it("rejects high-value no-action controls; changing only actionAvailable changes the decision", async () => {
    const controls = records.slice(85, 90);
    expect(controls.every((row) => Number(row.amountAtRiskMinor) >= SYNTHETIC_POLICY.economicThresholdMinor)).toBe(true);
    await expect(ingestSecureCsv(syntheticCsv(controls), recordingStore(), SYNTHETIC_OPTIONS))
      .resolves.toMatchObject({ admitted: 0, created: 0, filtered: 5 });
    await expect(ingestSecureCsv(syntheticCsv(controls.map((row) => ({ ...row, actionAvailable: "true" }))), recordingStore(), SYNTHETIC_OPTIONS))
      .resolves.toMatchObject({ admitted: 5, created: 5 });
  });

  it("makes the threshold controls sensitive to a deliberately different test-only policy", async () => {
    const controls = syntheticCsv(records.slice(70, 85));
    await expect(ingestSecureCsv(controls, recordingStore(), SYNTHETIC_OPTIONS)).resolves.toMatchObject({ filtered: 15 });
    await expect(ingestSecureCsv(controls, recordingStore(), {
      ...SYNTHETIC_OPTIONS, policies: new Map([["ActivationMissed", { ...SYNTHETIC_POLICY, economicThresholdMinor: 0 }]]),
    })).resolves.toMatchObject({ created: 15, filtered: 0 });
  });

  it("keeps upstream entity sufficiency explicitly outside the claim made by this fixture", () => {
    expect(expected.identityScope).toContain("ENTITY_DEFINING_CONTEXT");
    expect(expected.identityScope).toContain("not evaluated or claimed");
    expect(expected.claimLimits).toContain("No ROI, precision, recall, causality");
  });
});

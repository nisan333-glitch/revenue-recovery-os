import { afterAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app";
import * as proofService from "../services/proofService";

describe("Evidence amount and currency request boundary", () => {
  const app = buildApp();
  const ingest = vi.spyOn(proofService, "ingestCaseEvidence").mockResolvedValue({} as never);
  const payload = {
    evidenceId: "EV-validation", sourceSystem: "billing", sourceRecordId: "invoice-validation",
    evidenceType: "invoice_paid", observedAt: "2026-07-25T00:00:00.000Z",
  };
  afterAll(async () => { await app.close(); ingest.mockRestore(); });

  it.each([{ amountMinor: 100 }, { amountMinor: 0 }, { currency: "USD" }])(
    "rejects an incomplete monetary pair before the service: %j", async (money) => {
      ingest.mockClear();
      const response = await app.inject({ method: "POST", url: "/cases/RC-validation/evidence",
        headers: { "x-actor-id": "author@test", "x-actor-role": "author" },
        payload: { ...payload, ...money } });
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe("invalid_request");
      expect(ingest).not.toHaveBeenCalled();
    },
  );

  it.each([{}, { amountMinor: 0, currency: "USD" }, { amountMinor: 100, currency: "EUR" }])(
    "passes complete or absent monetary pairs unchanged: %j", async (money) => {
      ingest.mockClear();
      const response = await app.inject({ method: "POST", url: "/cases/RC-validation/evidence",
        headers: { "x-actor-id": "author@test", "x-actor-role": "author" },
        payload: { ...payload, ...money } });
      expect(response.statusCode).toBe(201);
      expect(ingest).toHaveBeenCalledWith(expect.anything(), "RC-validation", { ...payload, ...money });
    },
  );
});

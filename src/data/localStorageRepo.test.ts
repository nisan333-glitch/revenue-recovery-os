// R3: the repository's in-memory store is authoritative; localStorage is init + best-effort
// persistence only. A failed or unavailable write must NEVER make Trust diverge from Cases during
// a session (no "empty CFO view" on a storage-disabled browser).
import { describe, it, expect, afterEach } from "vitest";
import { createLocalStorageRepo } from "./localStorageRepo";
import { provenLedger } from "../domain/provenLedger";

const SEEDED_EVENTS = 14;
const SEEDED_PROOFS = 7;

function memStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => {
      m.set(k, String(v));
    },
    removeItem: (k: string) => {
      m.delete(k);
    },
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
  } as Storage;
}

function setStorage(s: Storage | undefined): void {
  if (s === undefined) delete (globalThis as { localStorage?: Storage }).localStorage;
  else (globalThis as { localStorage?: Storage }).localStorage = s;
}

afterEach(() => setStorage(undefined));

describe("localStorageRepo — in-memory is authoritative (R3)", () => {
  it("normal init: seeds events + trust, and persists across repo instances", () => {
    setStorage(memStorage());
    const repo = createLocalStorageRepo();
    expect(repo.list().length).toBe(SEEDED_EVENTS);
    const t = repo.loadTrust();
    expect(t.proofs.length).toBe(SEEDED_PROOFS);
    expect(provenLedger(t.proofs, "USD").revenueReturned.minor).toBe(8_340_000);
    expect(provenLedger(t.proofs, "USD").auditableRevenue.minor).toBe(7_980_000);
    // A second repo instance reads what the first persisted.
    const repo2 = createLocalStorageRepo();
    expect(repo2.loadTrust().proofs.length).toBe(SEEDED_PROOFS);
  });

  it("storage UNAVAILABLE: still seeds in-memory — Trust is not empty", () => {
    setStorage(undefined); // no localStorage at all
    const repo = createLocalStorageRepo();
    expect(repo.list().length).toBe(SEEDED_EVENTS);
    expect(repo.loadTrust().proofs.length).toBe(SEEDED_PROOFS); // in-memory seed, not EMPTY
  });

  it("write FAILURE (quota): in-memory Trust remains available and consistent with Cases", () => {
    setStorage({
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    } as Storage);
    const repo = createLocalStorageRepo();
    // Both stores seeded in-memory despite every write throwing — no divergence.
    expect(repo.list().length).toBe(SEEDED_EVENTS);
    expect(repo.loadTrust().proofs.length).toBe(SEEDED_PROOFS);
  });

  it("in-memory Trust survives a failed persistence write after saveTrust", () => {
    setStorage({
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    } as Storage);
    const repo = createLocalStorageRepo();
    repo.saveTrust({ baselines: [], proofs: [], evidenceByCase: {} });
    // The write threw, but the authoritative in-memory value updated.
    expect(repo.loadTrust().proofs.length).toBe(0);
  });

  it("reset reseeds both Cases and Trust in-memory", () => {
    setStorage(memStorage());
    const repo = createLocalStorageRepo();
    repo.saveTrust({ baselines: [], proofs: [], evidenceByCase: {} });
    expect(repo.loadTrust().proofs.length).toBe(0);
    repo.reset();
    expect(repo.list().length).toBe(SEEDED_EVENTS);
    expect(repo.loadTrust().proofs.length).toBe(SEEDED_PROOFS);
  });
});

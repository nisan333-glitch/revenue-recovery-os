// localStorage-backed repository. Seeds realistic data on first run.
import type { RecoveryEvent } from "../domain/types";
import { withDerivedReturn } from "../domain/invariants";
import type { RecoveryRepository, TrustStore } from "./repository";
import { seedEvents } from "./seed";
import { seedTrust } from "./seedTrust";

const KEY = "rros.events.v1";
const TRUST_KEY = "rros.trust.v1";

function read(): RecoveryEvent[] | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as RecoveryEvent[];
  } catch {
    return null;
  }
}

function write(events: RecoveryEvent[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(events));
  } catch {
    // ignore quota / unavailable storage; in-memory state still works for the session
  }
}

function readTrust(): TrustStore | null {
  try {
    const raw = localStorage.getItem(TRUST_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as TrustStore;
  } catch {
    return null;
  }
}

function writeTrust(trust: TrustStore): void {
  try {
    localStorage.setItem(TRUST_KEY, JSON.stringify(trust));
  } catch {
    // ignore quota / unavailable storage
  }
}

export function createLocalStorageRepo(): RecoveryRepository {
  // Always enforce the core equation on load so stored data can't drift.
  let cache: RecoveryEvent[] = (read() ?? seedEvents()).map(withDerivedReturn);
  if (read() === null) write(cache);

  // Trust world: seed the governed Baselines/Evidence/Proofs on first run.
  let trust: TrustStore = readTrust() ?? seedTrust();
  if (readTrust() === null) writeTrust(trust);

  return {
    list() {
      return cache.slice();
    },
    get(eventId) {
      return cache.find((e) => e.eventId === eventId);
    },
    save(event) {
      const derived = withDerivedReturn(event);
      const idx = cache.findIndex((e) => e.eventId === derived.eventId);
      if (idx >= 0) cache[idx] = derived;
      else cache.push(derived);
      write(cache);
    },
    saveAll(events) {
      cache = events.map(withDerivedReturn);
      write(cache);
    },
    reset() {
      cache = seedEvents().map(withDerivedReturn);
      write(cache);
      trust = seedTrust();
      writeTrust(trust);
    },
    loadTrust() {
      // Return the in-memory authoritative store (symmetry with `list()` returning `cache`).
      // localStorage is init + best-effort persistence only; a failed/unavailable write must NOT
      // make Trust diverge from Cases during a session (e.g. seeded proofs vanishing to an empty
      // CFO view on a storage-disabled browser).
      return trust;
    },
    saveTrust(next) {
      trust = next; // in-memory is authoritative
      writeTrust(next); // best-effort; swallows quota/unavailable
    },
  };
}

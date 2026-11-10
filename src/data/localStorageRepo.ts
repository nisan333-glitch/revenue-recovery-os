// localStorage-backed repository. Seeds realistic data on first run.
//
// IT ALSO FAILS CLOSED ON WHAT IS ALREADY STORED, which the Option 1 correction made necessary. Before
// this slice a browser that had used the app held seven approved proofs for mechanisms no source
// attests. Changing the seed does nothing for that browser: `readTrust()` finds the old store and
// returns it. Two independent defences, and only the second is load-bearing.
//
//   1 · The storage keys moved to `.v2`, so an existing browser re-seeds once. This handles the
//       ordinary case and nothing else — it is a one-time migration, not a guard.
//   2 · `admissibleProofs` filters EVERY proof read from storage through the same gate the approval
//       path uses. This reaches any store, including a `.v2` one that was hand-edited or written by an
//       older build, and it keeps working after the migration is forgotten. A proof whose reason has no
//       declared correction channel is dropped on READ, so it can never reach a screen or a total.
//
// Dropping on read rather than deleting is deliberate: the stored bytes are left alone, so nothing is
// destroyed and the next legitimate write persists whatever the gate admits.
import type { RecoveryEvent } from "../domain/types";
import { withDerivedReturn } from "../domain/invariants";
import { reasonHasDeclaredChannel } from "../domain/correctionMapping";
import type { Proof } from "../domain/proof";
import type { RecoveryRepository, TrustStore } from "./repository";
import { seedEvents } from "./seed";
import { seedTrust } from "./seedTrust";

// BUMPED from `.v1` with the Option 1 correction — see defence 1 above.
const KEY = "rros.events.v2";
const TRUST_KEY = "rros.trust.v2";

/**
 * Keep only proofs whose recovery mechanism has a declared correction channel.
 *
 * It asks the CHANNEL question and not the full `correctionMapping`, because a stored `Proof` carries
 * its reason and not the evidence record that satisfied the channel — so the answerable question is
 * the decisive one: could any correction ever have evidenced this mechanism?
 */
function admissibleProofs(proofs: Proof[]): Proof[] {
  return proofs.filter((p) => p.recoveryReason !== null && reasonHasDeclaredChannel(p.recoveryReason));
}

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
    const stored = JSON.parse(raw) as TrustStore;
    // Defence 2: a persisted proof for an unattestable mechanism never reaches a caller.
    return { ...stored, proofs: admissibleProofs(stored.proofs ?? []) };
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
      // Symmetric with the read: an inadmissible proof is not accepted into the in-memory store
      // either, so a caller cannot route around the gate by writing one directly.
      const admitted = { ...next, proofs: admissibleProofs(next.proofs) };
      trust = admitted; // in-memory is authoritative
      writeTrust(admitted); // best-effort; swallows quota/unavailable
    },
  };
}

// Repository abstraction. The UI depends only on this interface, so the
// localStorage backend can later be swapped for a REST/GraphQL API or an
// event-sourced server with zero UI changes.
import type { RecoveryEvent } from "../domain/types";
import type { Baseline } from "../domain/baseline";
import type { Proof } from "../domain/proof";
import type { Evidence } from "../domain/evidence";

/**
 * The governed trust collections, persisted SEPARATELY from mutable Cases. Baselines and Proofs
 * are append-only in practice (a lock replaces a still-unlocked baseline; a reversal/correction
 * appends a NEW linked record — an approved Proof or locked Baseline is never edited in place).
 */
export interface TrustStore {
  baselines: Baseline[];
  proofs: Proof[];
  evidenceByCase: Record<string, Evidence[]>;
}

export interface RecoveryRepository {
  list(): RecoveryEvent[];
  get(eventId: string): RecoveryEvent | undefined;
  save(event: RecoveryEvent): void;
  saveAll(events: RecoveryEvent[]): void;
  reset(): void;
  // --- Governed trust world (immutable/append-only) ---
  loadTrust(): TrustStore;
  saveTrust(trust: TrustStore): void;
}

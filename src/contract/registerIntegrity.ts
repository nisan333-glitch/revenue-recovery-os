// The integrity status of one stored governed record, as an auditor needs to see it.
//
// WHY A SHARED SHAPE. Two registers hold governed definitions — the admission bar and the analysis
// terms — and each stores a hash computed from its own values when it was proposed. Verification is the
// same question in both: does this row still hash to what its witness says? The answer is reported in
// one shape so an auditor reads one thing, and so the integrity sweep and the governance reads cannot
// drift into disagreeing about what "intact" means.
//
// THREE STATES, NOT A BOOLEAN. "Cannot be verified" is a different fact from "does not match", and
// collapsing them would let a row nobody could check read as a row that failed. UNVERIFIABLE is what a
// row yields when its stored values cannot be rebuilt into a valid definition at all — a column out of
// range, an enum nothing maps to — at which point there is nothing to hash and no comparison to make.
//
// REPORTING, NEVER REPAIRING. This module computes and compares. It writes nothing, and nothing here
// can be used to restamp a row: the computed hash is reported beside the stored one precisely so the
// difference is visible rather than resolved.
export type IntegrityStatus =
  /** The stored values hash to the stored witness. */
  | "INTACT"
  /** They do not. The row changed after it was blessed, or the witness did. */
  | "MISMATCH"
  /** The stored values are not a valid definition, so no hash can be computed from them. */
  | "UNVERIFIABLE";

export interface RegisterIntegrity {
  readonly status: IntegrityStatus;
  /** The witness as stored. Always reported, including when it is the thing in doubt. */
  readonly storedHash: string;
  /** Recomputed from the stored values. Null only when they could not be rebuilt. */
  readonly computedHash: string | null;
  /** Why, when the status is not INTACT. Never echoes a customer value. */
  readonly detail: string | null;
}

export function intact(storedHash: string): RegisterIntegrity {
  return Object.freeze({ status: "INTACT" as const, storedHash, computedHash: storedHash, detail: null });
}

/**
 * Compare a stored witness against a recomputed one.
 *
 * Both hashes are reported either way. An auditor given only "mismatch" cannot tell a one-field edit
 * from a wholesale replacement, and cannot check the comparison themselves.
 */
export function compareIntegrity(storedHash: string, computedHash: string): RegisterIntegrity {
  if (storedHash === computedHash) return intact(storedHash);
  return Object.freeze({
    status: "MISMATCH" as const,
    storedHash,
    computedHash,
    detail: "the stored values do not hash to the stored witness; the record changed after it was registered",
  });
}

/** The stored values are not a valid definition, so there is nothing to hash. */
export function unverifiable(storedHash: string, detail: string): RegisterIntegrity {
  return Object.freeze({ status: "UNVERIFIABLE" as const, storedHash, computedHash: null, detail });
}

/** May a record in this state be used — judged against, or granted authority? Only when INTACT. */
export function mayBeTrusted(integrity: RegisterIntegrity): boolean {
  return integrity.status === "INTACT";
}

// Durable storage for the delivery ledger · step 4 of the Phase 4 plan.
//
// WHY DURABILITY IS THE POINT. The gap the owner named is that the previous watcher "dies with the
// session". A ledger held in memory makes every guarantee in `bridge.ts` conditional on a process staying
// alive: retries restart from zero, a delivered message can be delivered twice, and a failed one is
// forgotten rather than visible. So the ledger is a file, and an endpoint reloads it on start.
//
// ATOMIC OR NOT AT ALL. The write is to a temporary file in the same directory followed by `rename`, which
// is atomic within a filesystem. A plain truncate-and-write can be interrupted and leave a half-written
// JSON document, and a ledger that cannot be parsed is indistinguishable from a ledger that was lost —
// which would silently reset every retry count and every delivered state.
//
// A CORRUPT LEDGER IS A REFUSAL, NEVER AN EMPTY ONE. `load` throws rather than returning `{}` when the
// file exists and cannot be read. Starting from empty would re-send every message already delivered and
// re-arm every retry, and it would do so quietly; an operator must be told the state was lost.
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";

import { validateMessage, validateReceipt } from "./bridge.ts";
import type { Entry, Ledger } from "./bridge.ts";

export const LEDGER_SCHEMA = "nh-ledger/v1";

interface LedgerFile {
  schema: typeof LEDGER_SCHEMA;
  entries: Record<string, Entry>;
}

const STATES = new Set(["pending", "delivered", "failed", "expired"]);

/**
 * Read a ledger back, re-validating every record in it.
 *
 * REVALIDATED ON LOAD, which is not paranoia about our own writer. The file is on disk between runs and is
 * exactly the kind of artefact a migration, a restore or an editor can touch; a record that no longer
 * satisfies `bridge.ts` must be refused loudly rather than carried into a decision about whether a message
 * was delivered. This is the register-tamper-evidence rule applied to a local file: verified where it is
 * resolved for use, not trusted as stored.
 */
export function loadLedger(path: string, now: Date): Ledger {
  if (!existsSync(path)) return Object.freeze({});
  let parsed: unknown;
  const raw = readFileSync(path, "utf8");
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`ledger at ${path} is not valid JSON; refusing to start from an empty ledger`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`ledger at ${path} is not an object`);
  }
  const file = parsed as Partial<LedgerFile>;
  if (file.schema !== LEDGER_SCHEMA) {
    throw new Error(`ledger at ${path} declares schema '${String(file.schema)}', expected '${LEDGER_SCHEMA}'`);
  }
  const entries = file.entries;
  if (typeof entries !== "object" || entries === null || Array.isArray(entries)) {
    throw new Error(`ledger at ${path} has no entries object`);
  }

  const out: Record<string, Entry> = {};
  for (const id of Object.keys(entries)) {
    const e = entries[id] as Partial<Entry> | undefined;
    if (e === undefined) continue;
    // `now` is NOT used to reject on expiry here: an expired entry is a legitimate historical record and
    // `settle` reports it as expired at read time. Passing `now` through keeps the message validator's own
    // shape checks available without letting the clock delete history.
    const m = validateMessage(e.message, now);
    if (!m.ok || m.value === null) throw new Error(`ledger entry '${id}' holds an invalid message: ${m.errors.join("; ")}`);
    if (m.value.id !== id) throw new Error(`ledger entry '${id}' holds a message whose id is '${m.value.id}'`);
    if (typeof e.state !== "string" || !STATES.has(e.state)) throw new Error(`ledger entry '${id}' has an unknown state`);
    if (!Number.isSafeInteger(e.attempts) || (e.attempts as number) < 0) throw new Error(`ledger entry '${id}' has an invalid attempt count`);
    let receipt = null;
    if (e.receipt !== null && e.receipt !== undefined) {
      const r = validateReceipt(e.receipt, now);
      if (!r.ok || r.value === null) throw new Error(`ledger entry '${id}' holds an invalid receipt: ${r.errors.join("; ")}`);
      receipt = r.value;
    }
    out[id] = Object.freeze({
      message: m.value,
      state: e.state as Entry["state"],
      attempts: e.attempts as number,
      lastAttemptAt: typeof e.lastAttemptAt === "string" ? e.lastAttemptAt : null,
      receipt,
    });
  }
  return Object.freeze(out);
}

/** Write a ledger atomically: same-directory temp file, then rename. */
export function saveLedger(path: string, ledger: Ledger): void {
  mkdirSync(dirname(path), { recursive: true });
  const file: LedgerFile = { schema: LEDGER_SCHEMA, entries: { ...ledger } as Record<string, Entry> };
  // The temp name carries the pid so two endpoints writing their own ledgers in one directory — which the
  // end-to-end test does — cannot collide on it.
  const tmp = join(dirname(path), `.${LEDGER_SCHEMA.replace(/\W/g, "_")}.${process.pid}.tmp`);
  writeFileSync(tmp, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  try {
    renameSync(tmp, path);
  } catch (err) {
    // Leave no stray temp file behind on a failed rename, but report the original failure rather than the
    // cleanup's: the rename is the thing that did not happen.
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      /* the original error below is the one that matters */
    }
    throw err;
  }
}

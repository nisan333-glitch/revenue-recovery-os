// SYNTHETIC DEMO · the two server-side steps an operator cannot do from a browser.
//
// WHAT THIS IS. A PRIVATE, OFF-BY-DEFAULT demonstration harness that lets an operator drive the whole
// Identify → Fix → Prove loop from the UI, with no seed script as an operator step:
//
//   1. LAUNCH   — enqueue the LABELLED synthetic book (`fixtures/reconciliation.synthetic.ts`) as a
//                 reconciliation task. The REAL reconciler, running in the REAL worker, decides what is
//                 under-billed; the REAL admission bar admits it. This module writes no candidate, no
//                 case, no authority row and no proof.
//   2. SETTLE   — simulate the synthetic payer paying the corrected invoice, as a SIGNED outcome record
//                 from a synthetic billing source, ingested through the REAL evidence path (real verifier,
//                 real role gate, real halt gate).
//
// WHY SETTLE EXISTS AT ALL. Outcome evidence must carry an Ed25519 attestation from the SOURCE system,
// and the party who benefits from a larger recovery number must not hold the key. A page script that
// could mint an attestation would answer the Trust Invariant's standing test the wrong way. So the key is
// generated in the API process, never leaves it, and the ONLY thing that can use it is `settle`, which:
//
//   · takes NO amount, currency, date, source or evidence id from the caller — the claim is built here
//     from the case's own frozen root (the amount the synthetic payer "pays" is the exposure that the
//     reconciler identified, by a rule fixed in this file);
//   · refuses any case that was not opened from THIS demo's book, on THIS demo's boundary;
//   · refuses until the corrective action (Intervene) and a locked baseline already exist, so the
//     simulated payment can never be ordered before the fix it is supposed to prove;
//   · settles a case at most once.
//
// WHAT IT DOES NOT MAKE. It makes no proof. Approval stays with a distinct approver identity through the
// normal gate, and the number is `Collected − Baseline` computed by the kernel from the signed record.
//
// SYNTHETIC IS SAID EVERYWHERE. The evidence record carries `SYNTHETIC` in its source-record id and
// note, and the verifier's receipt carries the demo key id. NOTE the source system is the existing
// allowlisted `billing`: a dedicated `synthetic-billing-source` system would require a new
// ROLE_MAP_VERSION (evidence-role map is a governance object) and is deliberately NOT done here — see
// docs/PILOT_RECONCILER_DEMO_V1.md.
//
// PRODUCTION BOUNDARY. Disabled unless NH_SYNTHETIC_DEMO_ENABLED=true, REFUSED outright when
// NODE_ENV=production, and fail-closed at start-up if the process is not configured to actually run the
// reconciler for the demo boundary (so a launch can never sit queued forever pretending to work).
import { createHash, generateKeyPairSync, randomUUID, sign, type KeyObject } from "node:crypto";
import { ConflictError, ForbiddenError, NotFoundError } from "../http/errors";
import { requireBoundaryAccess, roleCan, type ActorContext } from "../auth/identity";
import { parseAgentProcessConfig } from "../agents/config";
import {
  RECONCILIATION_AGENT_ID,
  RECONCILIATION_RECOVERY_TYPE,
} from "../agents/reconciliationObserver";
import {
  BILLING_COLUMNS,
  DEMO_BILLING_ROWS,
  DEMO_CURRENCY,
  DEMO_EXPECTATION_ROWS,
  EXPECTATION_COLUMNS,
  SYNTHETIC_LABEL,
} from "../agents/fixtures/reconciliation.synthetic";
import { sourceSigningPayload, type SourceTrustKey } from "../services/sourceVerification";
import type { RecoveryCaseRoot } from "../persistence/recoveryCaseStore";

export const SYNTHETIC_DEMO_BOUNDARY_DEFAULT = "SYNTHETIC-DEMO";
/** The existing allowlisted outcome source. See the header for why a dedicated system is not used. */
export const SYNTHETIC_DEMO_SOURCE_SYSTEM = "billing";
export const SYNTHETIC_DEMO_NOTE =
  "SYNTHETIC — simulated payment by a labelled synthetic payer. Not real money, not a customer record.";

export interface SyntheticDemoStatus {
  readonly enabled: true;
  readonly label: string;
  readonly boundaryId: string;
  readonly currency: string;
  readonly sourceKeyId: string;
}

export interface SyntheticLaunchResult {
  readonly launched: boolean;
  readonly alreadyLaunched: boolean;
  readonly boundaryId: string;
  readonly taskId: string;
  readonly label: string;
  readonly currency: string;
}

export interface SyntheticEvidenceClaim {
  readonly evidenceId: string;
  readonly sourceSystem: string;
  readonly sourceRecordId: string;
  readonly evidenceType: string;
  readonly observedAt: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly note: string;
  readonly sourceAttestation: { readonly keyId: string; readonly issuedAt: string; readonly signature: string };
}

/** The persistence the demo needs. Real implementations are the default; tests inject fakes. */
export interface SyntheticDemoPorts {
  enqueue(task: {
    readonly taskId: string;
    readonly boundaryId: string;
    readonly agentId: string;
    readonly idempotencyKey: string;
    readonly payload: Readonly<Record<string, unknown>>;
    readonly now: number;
  }): Promise<{ readonly created: boolean }>;
  readCase(recoveryCaseId: string): Promise<RecoveryCaseRoot | null>;
  hasIntervention(recoveryCaseId: string): Promise<boolean>;
  hasBaseline(recoveryCaseId: string): Promise<boolean>;
  evidenceExists(recoveryCaseId: string, evidenceId: string): Promise<boolean>;
}

export interface SyntheticDemoConfig {
  readonly boundaryId: string;
  readonly now?: () => number;
}

export class SyntheticDemo {
  readonly boundaryId: string;
  readonly trustKey: SourceTrustKey;
  private readonly privateKey: KeyObject;
  private readonly now: () => number;

  constructor(config: SyntheticDemoConfig, private readonly ports: SyntheticDemoPorts) {
    if (!config.boundaryId.trim()) throw new Error("synthetic demo requires a boundary");
    this.boundaryId = config.boundaryId.trim();
    this.now = config.now ?? Date.now;
    // EPHEMERAL, per process. Nothing is written to disk, nothing is reused between runs, and the private
    // half is a non-exported KeyObject: no route, log line or response can serialise it.
    const pair = generateKeyPairSync("ed25519");
    this.privateKey = pair.privateKey;
    this.trustKey = Object.freeze({
      keyId: `SYNTHETIC-DEMO-billing-${randomUUID().slice(0, 8)}`,
      sourceSystem: SYNTHETIC_DEMO_SOURCE_SYSTEM,
      publicKey: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
    });
  }

  status(): SyntheticDemoStatus {
    return Object.freeze({
      enabled: true as const,
      label: SYNTHETIC_LABEL,
      boundaryId: this.boundaryId,
      currency: DEMO_CURRENCY,
      sourceKeyId: this.trustKey.keyId,
    });
  }

  /** Enqueue the labelled book. Operator only; idempotent per boundary (a second launch is a no-op). */
  async launch(actor: ActorContext): Promise<SyntheticLaunchResult> {
    if (actor.role !== "operator") throw new ForbiddenError("launching the synthetic demo requires the operator role");
    requireBoundaryAccess(actor, this.boundaryId);
    const now = this.now();
    const book = Object.freeze({
      expectation: { columns: [...EXPECTATION_COLUMNS], rows: DEMO_EXPECTATION_ROWS },
      billing: { columns: [...BILLING_COLUMNS], rows: DEMO_BILLING_ROWS },
      currency: DEMO_CURRENCY,
    });
    const taskId = `SYNTHETIC-DEMO-reconciliation-${this.boundaryId}`;
    const queued = await this.ports.enqueue({
      taskId,
      boundaryId: this.boundaryId,
      agentId: RECONCILIATION_AGENT_ID,
      // Derived from the FIXTURE only (not from the clock), so a second launch is recognised as the same
      // observation instead of minting a duplicate.
      idempotencyKey: `SYNTHETIC-DEMO-${createHash("sha256").update(JSON.stringify(book)).digest("hex")}`,
      payload: Object.freeze({ ...book, observedAt: new Date(now - 60_000).toISOString(), actionAvailable: true }),
      now,
    });
    return Object.freeze({
      launched: queued.created,
      alreadyLaunched: !queued.created,
      boundaryId: this.boundaryId,
      taskId,
      label: SYNTHETIC_LABEL,
      currency: DEMO_CURRENCY,
    });
  }

  /**
   * Simulate the synthetic payer settling the corrected invoice, as a signed outcome record. Returns the
   * ingested evidence. `ingest` is the REAL `proofService.ingestCaseEvidence` bound to the REAL verifier.
   */
  async settle<T>(
    actor: ActorContext,
    recoveryCaseId: string,
    ingest: (claim: SyntheticEvidenceClaim) => Promise<T>,
  ): Promise<T> {
    // Same permission the real evidence route needs — the demo adds a check, it never removes one.
    if (!roleCan(actor.role, "IngestEvidence")) {
      throw new ForbiddenError(`role '${actor.role}' may not perform 'IngestEvidence'`);
    }
    const root = await this.ports.readCase(recoveryCaseId);
    if (!root) throw new NotFoundError("no such Recovery Case");
    if (
      root.boundaryId !== this.boundaryId
      || root.recoveryType !== RECONCILIATION_RECOVERY_TYPE
      || root.detectorVersion !== RECONCILIATION_AGENT_ID
    ) {
      throw new ForbiddenError("the synthetic billing source only settles cases opened from the synthetic demo book");
    }
    requireBoundaryAccess(actor, root.boundaryId);
    if (!(await this.ports.hasIntervention(recoveryCaseId))) {
      throw new ConflictError("the corrective action must be recorded before the synthetic payer settles");
    }
    if (!(await this.ports.hasBaseline(recoveryCaseId))) {
      throw new ConflictError("a locked baseline must exist before the synthetic payer settles");
    }
    const evidenceId = `EV-SYNTHETIC-${recoveryCaseId}`;
    if (await this.ports.evidenceExists(recoveryCaseId, evidenceId)) {
      throw new ConflictError("the synthetic payer has already settled this case");
    }
    const issuedAt = new Date(this.now()).toISOString();
    const claim = {
      evidenceId,
      sourceSystem: SYNTHETIC_DEMO_SOURCE_SYSTEM,
      sourceRecordId: `SYNTHETIC-INVOICE-${recoveryCaseId}`,
      evidenceType: "invoice_paid",
      observedAt: issuedAt,
      // THE RULE, FIXED HERE: the synthetic payer pays the corrected invoice in full — exactly the exposure
      // the reconciler identified. The caller supplies none of it.
      amountMinor: root.amountAtRiskMinor,
      currency: root.currency,
    };
    const signature = sign(null, sourceSigningPayload(recoveryCaseId, claim, issuedAt), this.privateKey).toString("base64");
    return ingest(Object.freeze({
      ...claim,
      note: SYNTHETIC_DEMO_NOTE,
      sourceAttestation: Object.freeze({ keyId: this.trustKey.keyId, issuedAt, signature }),
    }));
  }
}

/**
 * Build the demo from the environment, or `null` when it is not enabled. Every misconfiguration THROWS at
 * start-up: a demo that boots but cannot run the reconciler would present a launch button that does nothing.
 */
export function syntheticDemoFromEnvironment(
  env: Readonly<Record<string, string | undefined>>,
  ports: SyntheticDemoPorts,
): SyntheticDemo | null {
  if (env.NH_SYNTHETIC_DEMO_ENABLED !== "true") return null;
  if (env.NODE_ENV === "production") {
    throw new Error("the synthetic demo is a private demonstration harness and is refused when NODE_ENV=production");
  }
  const boundaryId = (env.NH_SYNTHETIC_DEMO_BOUNDARY ?? SYNTHETIC_DEMO_BOUNDARY_DEFAULT).trim();
  const agents = parseAgentProcessConfig(env);
  if (!agents.enabled || !agents.boundaryIds.includes(boundaryId)) {
    throw new Error("the synthetic demo requires NH_AGENTS_ENABLED=true and its boundary listed in NH_AGENT_BOUNDARIES");
  }
  if (env.NH_RECONCILIATION_OBSERVER_ENABLED !== "true" || (env.NH_RECONCILER_PSEUDONYM_KEY ?? "").length < 32) {
    throw new Error("the synthetic demo requires NH_RECONCILIATION_OBSERVER_ENABLED=true and NH_RECONCILER_PSEUDONYM_KEY");
  }
  if (!agents.admissionPolicies.has(RECONCILIATION_RECOVERY_TYPE)) {
    throw new Error(`the synthetic demo requires an NH_AGENT_ADMISSION_POLICIES entry for ${RECONCILIATION_RECOVERY_TYPE}`);
  }
  return new SyntheticDemo({ boundaryId }, ports);
}

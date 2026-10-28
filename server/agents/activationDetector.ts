import { createHash } from "node:crypto";
import { assertCandidateSignal } from "./admission";
import type { AgentHandler, CandidateSignal } from "./types";
import { createPilotAssessmentAgent } from "./pilotAssessmentAgent";
import { reconciliationObserver } from "./reconciliationObserver";

export const ACTIVATION_AGENT_ID = "activation-deadline-v1";
const fields = ["sourceRef", "signedAt", "activationDueAt", "activatedAt", "observedAt", "amountAtRiskMinor", "currency", "actionAvailable"];

/**
 * OPTIONAL obligation facts the SOURCE may state. All three together, or none.
 *
 * THIS DETECTOR INFERS NOTHING. An activation observation identifies an ACCOUNT, and whether one
 * activation cycle is one obligation is a governed question with an owner that this file does not
 * answer. What it does is RELAY: when the source states which obligation its observation concerns, and
 * what was owed and billed on it, the signal carries that statement so a proof can name its own subject.
 * When the source states nothing, the signal states nothing and the approved rule refuses PROVEN — which
 * is the correct outcome for an account-level observation, not a gap to be papered over here.
 *
 * The same shape the CSV ingestion path uses, deliberately: one way for a source to state an obligation.
 */
const obligationFields = ["obligationRef", "expectedMinor", "billedMinor"] as const;

/** Normalized observations only. Missing activation means observed absence, not missing data. */
export function activationDetector(now: () => number = Date.now): AgentHandler {
  return {
    agentId: ACTIVATION_AGENT_ID,
    // Explicit rather than relying on the absent-means-true default: this detector's whole purpose is
    // to publish candidates, and saying so keeps the registry requirement visible at the source.
    publishesCandidates: true,
    async run(payload, context) {
      const present = Object.keys(payload);
      const statesObligation = obligationFields.every((k) => k in payload);
      const permitted = statesObligation ? [...fields, ...obligationFields] : fields;
      // STILL EXACT, not merely a superset: a payload may carry the base fields, or the base fields plus
      // ALL THREE obligation facts, and nothing else. A partially stated obligation is a malformed
      // observation rather than an invitation to complete it.
      if (present.length !== permitted.length || permitted.some((key) => !(key in payload))
        || present.some((key) => !permitted.includes(key))) throw new Error("invalid activation observation fields");
      const timestamp = (value: unknown): number => {
        if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
          throw new Error("activation timestamps must be canonical ISO dates");
        }
        return Date.parse(value);
      };
      const signed = timestamp(payload.signedAt);
      const due = timestamp(payload.activationDueAt);
      const observed = timestamp(payload.observedAt);
      const activated = payload.activatedAt === null ? null : timestamp(payload.activatedAt);
      if (signed > due || signed > observed || observed > now() || (activated !== null && (activated < signed || activated > observed))) {
        throw new Error("activation observation has inconsistent timing");
      }
      if (typeof payload.sourceRef !== "string" || !/^hmac-sha256:[a-f0-9]{64}$/.test(payload.sourceRef)) {
        throw new Error("activation observations require a pseudonymous source reference");
      }
      // The digest preimage grows ONLY when the obligation facts are stated, so an observation that
      // states none digests exactly as it does today and no historical signal id moves.
      const digest = createHash("sha256")
        .update(JSON.stringify(permitted.map((key) => payload[key]))).digest("hex");
      let obligationCoverage: CandidateSignal["obligationCoverage"];
      if (statesObligation) {
        const ref = payload.obligationRef;
        const expectedMinor = payload.expectedMinor;
        const billedMinor = payload.billedMinor;
        if (typeof ref !== "string" || !/^hmac-sha256:[a-f0-9]{64}$/.test(ref)) {
          throw new Error("activation observation obligationRef must be an hmac-sha256 pseudonym");
        }
        if (!Number.isSafeInteger(expectedMinor) || !Number.isSafeInteger(billedMinor)) {
          throw new Error("activation observation expectedMinor and billedMinor must be safe integers");
        }
        obligationCoverage = {
          kind: "SINGLE_OBLIGATION",
          obligationRef: ref,
          expectedMinor: expectedMinor as number,
          billedMinor: billedMinor as number,
          residualMinor: (expectedMinor as number) - (billedMinor as number),
          currency: payload.currency as string,
        };
      }
      const signal: CandidateSignal = {
        signalId: `ACT-${digest.slice(0, 32)}`, boundaryId: context.boundaryId,
        recoveryType: "ActivationMissed", sourceRef: payload.sourceRef, sourcePayloadHash: digest,
        detectorVersion: ACTIVATION_AGENT_ID, observedAt: payload.observedAt as string,
        amountAtRiskMinor: payload.amountAtRiskMinor as number, currency: payload.currency as string,
        actionAvailable: payload.actionAvailable as boolean, expectedProofEvent: "activation followed by next invoice paid",
        ...(obligationCoverage ? { obligationCoverage } : {}),
      };
      assertCandidateSignal(signal);
      return activated === null && observed >= due && payload.actionAvailable ? [signal] : [];
    },
  };
}

/**
 * The production handler registry. Every agent is OPT-IN by an explicit `true`; an unset flag means
 * off and any other value is a configuration error rather than a silent default — a detector that
 * turned itself on because a variable was misspelled would be the wrong kind of surprise.
 *
 * EP-16 · The pilot assessment agent lives here too. It is observation-only and emits no
 * CandidateSignal, so enabling it adds no path into case creation; what it adds is the ability for a
 * worker to pick up an execution that the governed schedule endpoint has already authorised.
 */
export function configuredAgentHandlers(env: Readonly<Record<string, string | undefined>>): readonly AgentHandler[] {
  return [
    ...optIn(env, "NH_ACTIVATION_DETECTOR_ENABLED", () => activationDetector()),
    ...optIn(env, "NH_PILOT_ASSESSMENT_AGENT_ENABLED", () => createPilotAssessmentAgent()),
    // The reconciliation observer needs a deployment secret to pseudonymise unit references. Enabling it
    // without one is a startup error rather than a handler that publishes references anyone could invert.
    ...optIn(env, "NH_RECONCILIATION_OBSERVER_ENABLED", () => reconciliationObserver(env.NH_RECONCILER_PSEUDONYM_KEY ?? "")),
  ];
}

function optIn(
  env: Readonly<Record<string, string | undefined>>,
  variable: string,
  make: () => AgentHandler,
): readonly AgentHandler[] {
  const enabled = env[variable];
  if (enabled === undefined || enabled === "false") return [];
  if (enabled !== "true") throw new Error(`${variable} must be true or false`);
  return [make()];
}

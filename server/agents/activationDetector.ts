import { createHash } from "node:crypto";
import { assertCandidateSignal } from "./admission";
import type { AgentHandler, CandidateSignal } from "./types";
import { createPilotAssessmentAgent } from "./pilotAssessmentAgent";

export const ACTIVATION_AGENT_ID = "activation-deadline-v1";
const fields = ["sourceRef", "signedAt", "activationDueAt", "activatedAt", "observedAt", "amountAtRiskMinor", "currency", "actionAvailable"];

/** Normalized observations only. Missing activation means observed absence, not missing data. */
export function activationDetector(now: () => number = Date.now): AgentHandler {
  return {
    agentId: ACTIVATION_AGENT_ID,
    // Explicit rather than relying on the absent-means-true default: this detector's whole purpose is
    // to publish candidates, and saying so keeps the registry requirement visible at the source.
    publishesCandidates: true,
    async run(payload, context) {
      if (Object.keys(payload).length !== fields.length || fields.some((key) => !(key in payload))
        || Object.keys(payload).some((key) => !fields.includes(key))) throw new Error("invalid activation observation fields");
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
      const digest = createHash("sha256").update(JSON.stringify(fields.map((key) => payload[key]))).digest("hex");
      const signal: CandidateSignal = {
        signalId: `ACT-${digest.slice(0, 32)}`, boundaryId: context.boundaryId,
        recoveryType: "ActivationMissed", sourceRef: payload.sourceRef, sourcePayloadHash: digest,
        detectorVersion: ACTIVATION_AGENT_ID, observedAt: payload.observedAt as string,
        amountAtRiskMinor: payload.amountAtRiskMinor as number, currency: payload.currency as string,
        actionAvailable: payload.actionAvailable as boolean, expectedProofEvent: "activation followed by next invoice paid",
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

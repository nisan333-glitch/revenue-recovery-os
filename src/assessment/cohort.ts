// Cohort classification — is a cycle a Deviation (stalled) as-of asOf?
//
// A cycle stalls only once its deadline (expectation start + N days) has been reached by asOf WITHOUT
// a qualifying observation. Before the deadline it is simply within its window — not stalled, not
// resolved. An observation recorded after asOf is treated as "not yet observed" (no future-
// information leakage), so a cycle can be stalled-at-asOf even though it later activated — correct
// point-in-time behaviour. The classification returns an explicit REASON, never only a boolean.
//
// This module is domain-NEUTRAL: it references only expectationAt / observationAt / the threshold N.
// It contains no SaaS, activation, invoice or ARPA assumptions — those live in the adapter.
import type { ExpectationCycle } from "./types";
import type { AssessmentPolicy } from "./policy";
import { epochDay, isAfter, addDays } from "./dateNormalize";

export type StallReason =
  | "observed_within_threshold" // observation on/before expectation + N ⇒ not stalled
  | "observed_after_threshold" // observation later than expectation + N ⇒ stalled
  | "within_window_not_yet_due" // no observation, but the deadline is after asOf ⇒ not stalled yet
  | "no_observation_past_deadline"; // no observation and the deadline has been reached by asOf ⇒ stalled

export interface StallClassification {
  readonly stalled: boolean;
  readonly reason: StallReason;
}

/** Effective (as-of asOf) observation time: an observation after asOf is invisible. */
export function effectiveObservationAt(cycle: ExpectationCycle, asOf: string): string | null {
  const o = cycle.observationAt;
  if (o === null) return null;
  return isAfter(o, asOf) ? null : o;
}

export function classifyStall(cycle: ExpectationCycle, policy: AssessmentPolicy): StallClassification {
  const obs = effectiveObservationAt(cycle, policy.asOf);
  if (obs !== null) {
    const late = epochDay(obs) - epochDay(cycle.expectationAt) > policy.stallThresholdDays;
    return late
      ? { stalled: true, reason: "observed_after_threshold" }
      : { stalled: false, reason: "observed_within_threshold" };
  }
  // No qualifying observation by asOf: stalled only once the deadline has been reached.
  const deadline = addDays(cycle.expectationAt, policy.stallThresholdDays);
  return isAfter(deadline, policy.asOf)
    ? { stalled: false, reason: "within_window_not_yet_due" }
    : { stalled: true, reason: "no_observation_past_deadline" };
}

export function isStalled(cycle: ExpectationCycle, policy: AssessmentPolicy): boolean {
  return classifyStall(cycle, policy).stalled;
}

export interface Cohorts {
  readonly stalled: ExpectationCycle[]; // the Deviation set D
  /** Not yet classifiable: within its window, deadline after asOf — NOT confirmed non-deviant. */
  readonly undetermined: ExpectationCycle[];
  /** Confirmed non-deviant (observed within the threshold). The only valid basis for future matching. */
  readonly reference: ExpectationCycle[];
}

export function splitCohorts(cycles: readonly ExpectationCycle[], policy: AssessmentPolicy): Cohorts {
  const stalled: ExpectationCycle[] = [];
  const undetermined: ExpectationCycle[] = [];
  const reference: ExpectationCycle[] = [];
  for (const c of cycles) {
    const cls = classifyStall(c, policy);
    if (cls.stalled) stalled.push(c);
    else if (cls.reason === "within_window_not_yet_due") undetermined.push(c);
    else reference.push(c); // observed_within_threshold ⇒ confirmed non-deviant
  }
  return { stalled, undetermined, reference };
}

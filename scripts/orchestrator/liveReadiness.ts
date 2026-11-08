// CAN THE LIVE PROVIDER CALL RUN? Two independent blockers, reported separately.
//
// WHY SEPARATELY, which is the whole point of this module. `openAiPortFromEnv` answered one question —
// "is a credential configured?" — and a caller who read `available: false` learned nothing about whether
// the host was even reachable. Those are different problems with different owners and different remedies:
// a credential is a secret the owner saves, and reachability is a network policy on the environment. A
// single boolean makes them look like one blocker, and whoever is asked to fix it cannot tell which half
// they are fixing.
//
// It is the same rule the readiness ladder and `coverage.event` both learned: **the unavailable states stay
// DISTINGUISHABLE**, because collapsing them hides which half is missing — the only part of the answer that
// says what to go and get.
//
// NO SECRET IS EVER SENT TO TEST REACHABILITY. The probe is a request carrying NO credential, so a refusal
// is a statement about the network and never about the key. A probe that sent the real key to find out
// whether the host answered would be spending the secret on diagnostics.
//
// AND NO SECURITY LIMIT IS BYPASSED. The probe goes through the same egress path as any other request and
// reports what it is told. A blocked host stays blocked; this module's job is to NAME that, not to route
// around it.
//
// PURE EXCEPT FOR THE INJECTED PROBE. `env` and the probe arrive as arguments; nothing here reads a global.

export const LIVE_HOST = "api.openai.com";
export const LIVE_KEY_ENV = "OPENAI_API_KEY";

export type CredentialState = "PRESENT" | "ABSENT";
/** `NOT_PROBED` is not "blocked": it is the absence of a measurement, and is never read as one. */
export type NetworkState = "REACHABLE" | "BLOCKED_BY_POLICY" | "UNREACHABLE_OTHER" | "NOT_PROBED";

export interface Blocker {
  readonly id: "CREDENTIAL" | "NETWORK";
  readonly blocked: boolean;
  readonly state: CredentialState | NetworkState;
  readonly detail: string;
  /** Who can clear it, and how. Stated so a report says what to do rather than that something is missing. */
  readonly remedy: string | null;
  /** Whose decision it is. A credential and a network policy are not the same owner's action. */
  readonly ownedBy: "owner" | "nobody";
}

export interface LiveReadiness {
  /** True only when BOTH blockers are clear. Never inferred from one of them. */
  readonly liveCallPossible: boolean;
  readonly credential: Blocker;
  readonly network: Blocker;
  /**
   * What a run against the stub does and does not establish. Carried on the report itself so a reader
   * cannot quote the result without it.
   */
  readonly syntheticRunMeaning: string;
}

/** The result of one credential-free reachability probe. Injected, so this module needs no network. */
export interface ProbeResult {
  readonly state: NetworkState;
  /** Our own words, or a status line. Never a response body and never a header. */
  readonly detail: string;
}

export function credentialBlocker(env: Record<string, string | undefined>): Blocker {
  const raw = env[LIVE_KEY_ENV];
  const present = typeof raw === "string" && raw.trim().length > 0;
  return Object.freeze({
    id: "CREDENTIAL" as const,
    blocked: !present,
    state: present ? ("PRESENT" as const) : ("ABSENT" as const),
    // LENGTH ONLY, NEVER A PREFIX OR A SUFFIX. A hint that reveals the first characters of a key narrows
    // it; a length does not, and is enough to tell "configured" from "configured as an empty string".
    detail: present
      ? `a credential is configured for ${LIVE_HOST} (length ${raw!.trim().length})`
      : `${LIVE_KEY_ENV} is not set, so no credential exists for ${LIVE_HOST}`,
    remedy: present
      ? null
      : `Save a network secret for ${LIVE_HOST} on this environment. Saving it also opens the host, so the `
        + "network blocker clears with it. The value is never written to a file, a record, a log line or a "
        + "GitHub comment, and only the owner may make this change.",
    ownedBy: present ? ("nobody" as const) : ("owner" as const),
  });
}

export function networkBlocker(probe: ProbeResult): Blocker {
  const reachable = probe.state === "REACHABLE";
  return Object.freeze({
    id: "NETWORK" as const,
    blocked: !reachable,
    state: probe.state,
    detail: probe.detail,
    remedy: reachable
      ? null
      : probe.state === "NOT_PROBED"
        ? "Run the probe. This is the absence of a measurement, not a blocked host — the two are reported "
          + "separately so an unmeasured network is never counted as a refusal."
        : `Allow ${LIVE_HOST} on this environment's network policy, or save a network secret for it, which `
          + "opens the host as a side effect. Only the owner may make either change.",
    ownedBy: reachable ? ("nobody" as const) : ("owner" as const),
  });
}

export function liveReadiness(env: Record<string, string | undefined>, probe: ProbeResult): LiveReadiness {
  const credential = credentialBlocker(env);
  const network = networkBlocker(probe);
  return Object.freeze({
    // CONJUNCTIVE, and computed from both rather than short-circuited on one, so the report always carries
    // the state of each. A caller must never learn "not possible" without learning which half.
    liveCallPossible: !credential.blocked && !network.blocked,
    credential,
    network,
    syntheticRunMeaning:
      "A run against the stub port exercises task identity, deduplication, the budget reservation, the rate "
      + "limit, the breaker, the approval gate and the output contract. It establishes NOTHING about what a "
      + "real provider would answer: the stub replays text a test author wrote. A stub run is never a live run.",
  });
}

/** Render the two blockers as plain lines. No credential value can reach these, by construction. */
export function renderLiveReadiness(r: LiveReadiness): string[] {
  const line = (b: Blocker): string[] => [
    `${b.id}: ${b.blocked ? "BLOCKED" : "clear"} · ${b.state}`,
    `  ${b.detail}`,
    ...(b.remedy === null ? [] : [`  remedy (${b.ownedBy}): ${b.remedy}`]),
  ];
  return [
    `live call possible: ${r.liveCallPossible ? "YES" : "NO"}`,
    ...line(r.credential),
    ...line(r.network),
    `synthetic run: ${r.syntheticRunMeaning}`,
  ];
}

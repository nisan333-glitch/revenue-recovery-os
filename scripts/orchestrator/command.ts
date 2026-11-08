// The orchestrator command's logic, separated from its I/O.
//
// WHY THE SPLIT. A command written as top-level statements — argv read, stdout written, process exited on
// import — has claims no test can reach: that it prints no credential, that an empty state exits non-zero,
// that a refusal is reported rather than swallowed. This module is the logic, imported freely; `orchestrate.ts`
// is the entry point and holds the argv, the stdout and the exit. The lesson is already on record in this
// repository twice: a command whose claims cannot be imported cannot be falsified, and the entry point must
// not run on import.
//
// PURE. It reads an injected `env` object and an injected `now`, calls the injected port, and returns lines
// and an exit code. It opens no file, touches no network itself and exits no process.

import { formatMessageComment } from "../coordination/wire.ts";
import { MSG_SCHEMA, type Message } from "../coordination/bridge.ts";
import { bodyHash } from "../coordination/wire.ts";
import { openAiPortFromEnv } from "./openaiPort.ts";
import { liveReadiness, renderLiveReadiness, type ProbeResult } from "./liveReadiness.ts";
import { StubModelPort, stubOk } from "./stubPort.ts";
import { buildStatus, renderStatus, type LivePortStatus } from "./status.ts";
import { runTask, submit, DEFAULT_CONFIG, EMPTY_STATE, type OrchestratorState } from "./orchestrator.ts";
import type { ModelPort } from "./modelPort.ts";

export interface CommandResult {
  lines: readonly string[];
  exitCode: number;
}

export function livePortStatus(env: Record<string, string | undefined>): LivePortStatus {
  const a = openAiPortFromEnv(env);
  return a.available
    ? { available: true, reason: null, remedy: null }
    : { available: false, reason: a.reason, remedy: a.remedy };
}

const USAGE = [
  "usage: npm run orchestrate -- <status|run> [--prompt <text>] [--kind <kind>]",
  "  status  print what works, what is missing, what is blocked, and what is needed from the owner",
  "  run     submit one task and run it through the model port, then print the status",
  "",
  "The live provider port is used when a credential is configured for its host. Otherwise a stub port",
  "answers and every record says so, because a stub run is not a live run.",
];

/**
 * Run the command.
 *
 * `port` is injected so a test can supply a stub and assert what was and was not invoked. When it is omitted
 * the live port is used if a credential exists, and a stub otherwise — and the status report states which.
 */
export async function runOrchestratorCommand(
  argv: readonly string[],
  env: Record<string, string | undefined>,
  now: Date,
  port?: ModelPort,
  /**
   * The credential-free reachability probe's result, injected.
   *
   * DEFAULTS TO `NOT_PROBED`, which is deliberately NOT "blocked": an unmeasured network is the absence of
   * a measurement and must never be reported as a refusal. The entry point supplies a real probe.
   */
  probe: ProbeResult = { state: "NOT_PROBED", detail: "no reachability probe was run for this invocation" },
): Promise<CommandResult> {
  const mode = argv[0];
  if (mode === undefined || mode === "--help" || mode === "-h") return { lines: USAGE, exitCode: 2 };
  if (mode !== "status" && mode !== "run") return { lines: [`unknown mode '${mode}'`, ...USAGE], exitCode: 2 };

  const live = livePortStatus(env);
  const flag = (name: string): string | null => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && i + 1 < argv.length ? (argv[i + 1] ?? null) : null;
  };

  let state: OrchestratorState = EMPTY_STATE;
  const lines: string[] = [];

  if (mode === "run") {
    const prompt = flag("prompt");
    if (prompt === null || prompt.trim().length === 0) {
      return { lines: ["run requires --prompt <text>", ...USAGE], exitCode: 2 };
    }
    const kind = flag("kind") ?? "coordination-question";
    const submitted = submit(
      state,
      { spec: { kind, prompt, parentId: null, context: {} }, submittedBy: "claude-code" },
      now,
    );
    state = submitted.state;
    lines.push(`submit: ${submitted.result.outcome} ${submitted.result.taskId ?? ""}`.trimEnd());
    for (const e of submitted.result.errors) lines.push(`  ${e}`);

    if (submitted.result.outcome === "accepted" && submitted.result.taskId !== null) {
      const chosen =
        port ??
        (live.available
          ? (() => {
              const a = openAiPortFromEnv(env);
              return a.available ? a.port : new StubModelPort([stubOk("stub answer: no credential configured")]);
            })()
          : new StubModelPort([stubOk("stub answer: no credential configured")]));
      const run = await runTask(state, submitted.result.taskId, chosen, now);
      state = run.state;
      if (run.outcome.kind === "refused") {
        lines.push(`run: refused by the ${run.outcome.guard} guard — ${run.outcome.reason}`);
      } else {
        const c = run.outcome.call;
        lines.push(
          `run: ${run.outcome.kind} via ${c.implementation} (${c.provider}/${c.model}, channel ${c.channel}), ` +
            `cost ${c.costCents === null ? "NOT COMPUTED" : `${c.costCents}c`}`,
        );
        if (c.finding !== null) {
          lines.push(`  trust: ${c.finding.trust}`);
          lines.push(`  summary: ${c.finding.summary}`);
          for (const n of c.finding.notes) lines.push(`  note: ${n}`);
        }
        if (c.failureReason !== null) lines.push(`  failure: ${c.failureReason}`);
      }
    }
    lines.push("");
  }

  const report = buildStatus(state, now, live, DEFAULT_CONFIG);
  lines.push(...renderStatus(report));
  // THE TWO BLOCKERS, SEPARATELY. A caller must never learn "the live call is not possible" without
  // learning which half is missing and whose action clears it.
  lines.push("");
  lines.push("LIVE PROVIDER READINESS");
  lines.push(...renderLiveReadiness(liveReadiness(env, probe)).map((l) => `  ${l}`));
  // A report that established nothing exits non-zero, so a caller cannot read silence as health.
  return { lines, exitCode: report.establishment === "NOT_ESTABLISHABLE" ? 2 : 0 };
}

/**
 * Render a bridge message carrying an orchestrator result.
 *
 * The orchestrator does not post to GitHub itself: posting is an outward-facing action and the comment is
 * produced here so a human, or a separately gated poster, sends it. The envelope is the EXISTING `nh-msg/v1`
 * wire format, unchanged — this slice adds no new wire format and widens no hashed record.
 *
 * `from`/`to` are bridge parties. The invoked API model is NOT one of them: it is a service this orchestrator
 * called, and the body says which provider and model answered. Representing it as the `chatgpt` party would
 * tell the owner their personal conversation had been automated, which is false.
 */
export function orchestratorBridgeComment(input: {
  id: string;
  from: Message["from"];
  to: Message["to"];
  inReplyTo: string | null;
  body: string;
  createdAt: Date;
  ttlSeconds: number;
}): string {
  const message: Message = {
    schema: MSG_SCHEMA,
    id: input.id,
    from: input.from,
    to: input.to,
    in_reply_to: input.inReplyTo,
    body_sha256: bodyHash(input.body),
    created_at: input.createdAt.toISOString().replace(/\.\d{3}Z$/, "Z"),
    expires_at: new Date(input.createdAt.getTime() + input.ttlSeconds * 1000).toISOString().replace(/\.\d{3}Z$/, "Z"),
  };
  return formatMessageComment(message, input.body);
}

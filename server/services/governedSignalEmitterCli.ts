// EP-31 · CLI for the governed signal emitter.
//
// Deliberately the same shape as `secureCsvIngestionCli` — the repository's existing entry point for
// creating candidates — rather than a new convention. One boundary per invocation, configuration from the
// environment, fail-closed on the governed threshold, and no HTTP route: nothing a request can reach.
//
// It creates `pending_review` candidates and stops there. It cannot open a Recovery Case (that needs an
// accepted review by another identity), and it cannot approve a Proof (that needs a locked baseline,
// case-scoped evidence and an approver who is not the owner).
import { prisma } from "../db";
import { parseAgentProcessConfig } from "../agents/config";
import {
  emitGovernedSignals,
  EMITTED_RECOVERY_TYPE,
  SIGNAL_EMITTER_AGENT_ID,
} from "./governedSignalEmitter";
import {
  mayStage,
  resolveSignalStagingConfig,
  SIGNAL_EMITTER_BOUNDARIES_VARIABLE,
} from "./governedSignalStaging";

async function main(): Promise<void> {
  const boundaryId = requiredEnv("NH_SIGNAL_EMITTER_BOUNDARY_ID");

  // BOTH GATES, the same two that govern staging. The master switch must be on and this boundary must be
  // named in the allowlist — a boundary that was never enrolled has no staged rows anyway, and refusing
  // here says so plainly instead of reporting a silent zero.
  const staging = resolveSignalStagingConfig(process.env);
  if (!mayStage(staging, boundaryId)) {
    throw new Error(
      `boundary ${boundaryId} is not enrolled for governed signal emission ` +
        `(set ${SIGNAL_EMITTER_BOUNDARIES_VARIABLE} to include it)`,
    );
  }

  // The materiality floor is a commercial judgement, so it is required rather than defaulted.
  const admissionPolicies = parseAgentProcessConfig(process.env).admissionPolicies;
  if (!admissionPolicies.has(EMITTED_RECOVERY_TYPE)) {
    throw new Error(`NH_AGENT_ADMISSION_POLICIES must configure a threshold for ${EMITTED_RECOVERY_TYPE}`);
  }

  try {
    const result = await emitGovernedSignals({
      boundaryId,
      policies: admissionPolicies,
      limit: optionalPositiveInt("NH_SIGNAL_EMITTER_LIMIT"),
    });
    console.log(JSON.stringify({ agentId: SIGNAL_EMITTER_AGENT_ID, ...result }));
  } finally {
    await prisma.$disconnect();
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function optionalPositiveInt(name: string): number | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

if (require.main === module) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : "governed signal emission failed");
    process.exitCode = 1;
  });
}

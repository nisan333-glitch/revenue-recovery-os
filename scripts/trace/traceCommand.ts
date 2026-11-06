// THE TRACE COMMAND, AS A FUNCTION · importable, so every claim it makes can be falsified.
//
// IT HOLDS NO I/O AT ALL: argv and the environment arrive as arguments, the database read arrives as an
// injectable function, and the result is returned rather than printed. The entry point
// `financial-trace.ts` holds `process`, stdout and `process.exit`, because `main()` runs at module scope
// and those side effects must not fire on import — which is also what would make the interesting claims
// ("it prints no identifier", "our own bug is not reported as bad input") untestable if they lived there.
import { readFinancialTrace } from "../../server/services/financialTraceRead";
import { renderFinancialTrace } from "../../src/domain/financialTrace";
import { formatMoney, money } from "../../src/domain/money";
import type { ActorContext } from "../../server/auth/identity";

export interface TraceCommandInput {
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
}

export interface TraceCommandOutcome {
  readonly exitCode: number;
  readonly output: string;
}

const USAGE =
  "usage: npm run trace:case -- <recoveryCaseId>\n" +
  "  NH_TRACE_ACTOR_ID    the reading actor (default audit@local)\n" +
  "  NH_TRACE_ACTOR_ROLE  a role holding AuditRead: approver, verifier or steward (default approver)\n" +
  "  NH_TRACE_BOUNDARY    the boundary the actor holds; required, and checked against the case's own";

/**
 * EXACT CENTS, ALWAYS. `formatMoney` defaults to whole units, and a trace that printed `$600` for
 * `$600.00` would be a financial report rounding its own evidence.
 */
const format = (minor: number, currency: string): string =>
  formatMoney(money(minor, currency), { exact: true });

/**
 * The command, as a function. A refusal about the INPUT carries its own message; anything else is
 * reported as OUR failure — reporting our own bug as bad input is the mistake of blaming the data for a
 * claim we made.
 */
export async function runTraceCommand(
  input: TraceCommandInput,
  read: (actor: ActorContext, caseId: string) => ReturnType<typeof readFinancialTrace> = readFinancialTrace,
): Promise<TraceCommandOutcome> {
  const caseId = input.argv[0]?.trim();
  if (!caseId) return { exitCode: 2, output: `trace: no recovery case id given.\n${USAGE}` };
  if (!input.env.DATABASE_URL) {
    return {
      exitCode: 2,
      output:
        "trace: DATABASE_URL is not set, so NOTHING was examined. An unexamined database is not a case " +
        `without evidence.\n${USAGE}`,
    };
  }
  const boundaryId = input.env.NH_TRACE_BOUNDARY?.trim();
  if (!boundaryId) return { exitCode: 2, output: `trace: NH_TRACE_BOUNDARY is required.\n${USAGE}` };

  const actor: ActorContext = Object.freeze({
    actorId: input.env.NH_TRACE_ACTOR_ID?.trim() || "audit@local",
    role: (input.env.NH_TRACE_ACTOR_ROLE?.trim() || "approver") as ActorContext["role"],
    boundaryIds: Object.freeze([boundaryId]),
  });

  try {
    const view = await read(actor, caseId);
    return { exitCode: 0, output: renderFinancialTrace(view.trace, view.traceDigest, format) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // A gate refusal and a missing root are answers about the REQUEST. Anything else is ours to own.
    const aboutTheRequest =
      /forbidden|not permitted|AuditRead|boundary|no authoritative root|not found/i.test(message);
    return aboutTheRequest
      ? { exitCode: 1, output: `trace: refused — ${message}` }
      : { exitCode: 3, output: `NH_INTERNAL_ERROR — ${message}` };
  }
}

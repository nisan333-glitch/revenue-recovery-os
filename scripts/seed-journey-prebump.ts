// JOURNEY SUPPORT ONLY · seed the HISTORY the re-assessment stage needs.
//
// Run by `e2e/journey.mjs`, never by the application, and it would be wrong to wire it anywhere else.
//
// WHY THE JOURNEY CANNOT SIMPLY MAKE ONE. A re-assessment is only meaningful across a CALCULATION
// METHOD change, and `ASSESSMENT_CALC_VERSION` is a build constant: every definition the governance
// screen can register is stamped with the method this build implements, so a freshly governed version
// always names the method the execution already used and the server correctly answers NH-AX-1017 —
// nothing to re-assess. To exercise a real change the journey needs a result from BEFORE the bump, and
// that is a fact about the past, not something a running system can be asked to produce.
//
// WHY IT IS WRITTEN AND NOT RUN. A pre-bump execution cannot run on this build at all: the run-time
// compatibility gate blocks it NH-AX-2006 before anything is computed, which is precisely why
// re-assessment is the only route to a current-method answer for these bytes. Driving the worker here
// would assert the opposite of what is true. So the result is recorded the way the pre-bump build
// recorded it — the same `runProjectedAssessment` over the same retained input and the same
// reconstructed policy, under a binding naming the older method, through the same append-only store,
// followed by the same CLAIMED → COMPLETED events. `server/services/reassessment.test.ts` builds its
// fixture identically and for the same reason.
//
// NO TASK IS ENQUEUED, because the run already happened. Nothing can claim it, and the input stays
// purgeable through the governed path.
//
// SYNTHETIC ONLY. It copies the retained projection of a dataset the journey itself generated; it
// invents no rows and reads no customer data.
import {
  deriveExecutionId,
  hashExecutionBinding,
  hashExecutionInput,
  hashFinding,
  runProjectedAssessment,
  type ExecutionBinding,
  type ExecutionInput,
} from "../src/contract/assessmentExecution";
import { makePolicy } from "../src/assessment/policy";
import {
  appendExecutionEvent,
  createExecutionIfAbsent,
  findExecution,
  findExecutionInput,
  recordFindingIfAbsent,
} from "../server/persistence/pilotExecutionStore";
import { prisma } from "../server/db";

/** The method a pre-bump execution carries. Not in the lineage registry, and deliberately not. */
const PRE_BUMP_METHOD = "assess-2026.0-journey-pre";
/** A version earlier than any the journey registers, so the two bindings cannot collide. */
const PRE_BUMP_TERMS_VERSION = "0.9.0";

async function main(): Promise<void> {
  const [boundaryId, sourceExecutionId] = process.argv.slice(2);
  if (!boundaryId || !sourceExecutionId) {
    throw new Error("usage: seed-journey-prebump.ts <boundaryId> <sourceExecutionId>");
  }

  const source = await findExecution(sourceExecutionId, boundaryId);
  if (!source) throw new Error(`no execution ${sourceExecutionId} in boundary ${boundaryId}`);
  const stored = await findExecutionInput(sourceExecutionId, boundaryId);
  if (!stored) throw new Error(`execution ${sourceExecutionId} has no retained input`);

  const input: ExecutionInput = Object.freeze({
    scheme: "nh-pilot-assessment-projection-v1",
    cycles: stored.cycles,
  });
  const binding: ExecutionBinding = Object.freeze({
    ...source.binding,
    assessmentPolicy: Object.freeze({
      ...source.binding.assessmentPolicy,
      policyVersion: PRE_BUMP_TERMS_VERSION,
      calculationMethodVersion: PRE_BUMP_METHOD,
    }),
  });

  const executionId = await deriveExecutionId(binding);
  const [bindingHash, inputHash] = await Promise.all([
    hashExecutionBinding(binding),
    hashExecutionInput(input),
  ]);
  const { created } = await createExecutionIfAbsent({
    executionId,
    binding,
    bindingHash,
    input,
    inputHash,
    scheduledByActorId: "journey-pre-bump@company",
    scheduledByRole: "operator",
    attributions: [],
    sourceResolution: null,
  });

  if (created) {
    // The older method goes on the POLICY, not onto the finding afterwards: `assessmentId` folds
    // `policy.calculationMethodVersion` in, so only this way does the historical finding carry the id
    // the pre-bump build would have derived — and the revision's own id legitimately differ from it.
    const finding = runProjectedAssessment({
      executionId,
      binding,
      input,
      policy: Object.freeze({
        ...makePolicy({
          policyId: binding.assessmentPolicy.policyId,
          policyVersion: binding.assessmentPolicy.policyVersion,
          stallThresholdDays: binding.assessmentPolicy.stallThresholdDays,
          asOf: binding.assessmentPolicy.asOf,
          currency: binding.assessmentPolicy.currency,
        }),
        calculationMethodVersion: PRE_BUMP_METHOD,
      }),
      createdAt: "2026-09-01T00:00:00.000Z",
    });
    await recordFindingIfAbsent({
      finding,
      findingHash: await hashFinding(finding),
      producedBy: "journey-pre-bump-build",
    });
    for (const transition of ["CLAIMED", "COMPLETED"] as const) {
      await appendExecutionEvent({
        executionId,
        boundaryId,
        transition,
        code: null,
        byId: "journey-pre-bump@company",
        detail: `pre-bump ${transition.toLowerCase()}`,
      });
    }
  }

  // The journey reads this off stdout. Nothing else is printed, so a parse failure there is a real
  // failure rather than log noise the harness has to filter.
  process.stdout.write(
    JSON.stringify({
      executionId,
      method: PRE_BUMP_METHOD,
      termsVersion: PRE_BUMP_TERMS_VERSION,
      created,
    }),
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    await prisma.$disconnect();
    process.stderr.write(`${e instanceof Error ? e.stack : String(e)}\n`);
    process.exit(1);
  });

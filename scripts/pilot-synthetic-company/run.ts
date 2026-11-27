// THE FROZEN SYNTHETIC COMPANY THROUGH THE PRODUCTION STACK, END TO END.
//
// WHAT MAKES THIS DIFFERENT FROM EVERY EXISTING HARNESS. `e2e/journey.mjs` drives the production path
// on a THREE-candidate book and reaches PROVEN. `scripts/reconciliation-synthetic/run.ts` drives a
// realistic 600-row company but through `src/benchmark/reconciliationCore.ts`, which the V2 audit
// measured and recorded as having ZERO production callers. Neither answers the question this one
// asks: what does the PRODUCTION stack do with a REALISTIC company?
//
// Real throughout: `POST /pilot/pairs`, the real worker, the real reconciliation observer, the real
// review and promotion routes, the real baseline/intervention/evidence routes, the real
// `SourceVerifier` over Ed25519, and the real proof kernel. The only thing this file supplies is the
// signing key — and only the PUBLIC half reaches the app, so nothing here can mint an attestation the
// verifier would not have to check.
//
// AND THE AGGREGATE CASES ARE DRIVEN TO THE GATE ON PURPOSE. A harness that proved only what it
// expected to prove would report the provable fraction and never show the refusal. Every promoted
// case is taken all the way to `POST /proofs`; the ones the gate refuses are recorded WITH THEIR CODE,
// because the refusal is the finding.
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../server/app";
import { prisma } from "../../server/db";
import { SourceVerifier, sourceSigningPayload, type EvidenceClaim } from "../../server/services/sourceVerification";
import { configuredAgentHandlers } from "../../server/agents/activationDetector";
import { createAgentProcessFromEnvironment } from "../../server/agents/bootstrap";
import { projectFrozenPackage } from "./project";

const DIR = process.env.COMPANY_PACKAGE ?? "e2e/fixtures/reconciliation-obligation-ref";
const RUN = randomUUID().slice(0, 8);
const BOUNDARY = `SYNTHETIC-company-${RUN}`;

// DISPOSABLE OR NOTHING. The same refusal `syntheticPilot.ts` carries, for the same reason: this
// harness writes candidates, cases, baselines, evidence and proofs, and it must be impossible to
// point it at anything that is not plainly a throwaway.
const database = process.env.DATABASE_URL ?? "";
if (!/test|synthetic|pilot/.test(database)) {
  console.error("REFUSED: DATABASE_URL must name a disposable database (test/synthetic/pilot)");
  process.exit(2);
}

const OPERATOR = { "x-actor-id": `SYN-operator-${RUN}`, "x-actor-role": "operator", "x-actor-boundaries": BOUNDARY };
const AUTHOR = { "x-actor-id": `SYN-author-${RUN}`, "x-actor-role": "author", "x-actor-boundaries": BOUNDARY };
const APPROVER = { "x-actor-id": `SYN-approver-${RUN}`, "x-actor-role": "approver", "x-actor-boundaries": BOUNDARY };

function money(minor: number): string {
  return "$" + (minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ONLY THE PUBLIC HALF REACHES THE APP.
const keys = generateKeyPairSync("ed25519");
const KEY_ID = `SYNTHETIC-company-billing-${RUN}`;
const verifier = new SourceVerifier([{
  keyId: KEY_ID,
  sourceSystem: "billing",
  publicKey: keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
}]);
function attest(caseId: string, claim: EvidenceClaim) {
  const issuedAt = new Date().toISOString();
  return {
    ...claim,
    sourceAttestation: {
      keyId: KEY_ID,
      issuedAt,
      signature: sign(null, sourceSigningPayload(caseId, claim, issuedAt), keys.privateKey).toString("base64"),
    },
  };
}

interface Call { status: number; body: Record<string, unknown> }
async function call(
  app: FastifyInstance, method: "GET" | "POST", url: string,
  headers: Record<string, string>, payload?: object,
): Promise<Call> {
  const r = await app.inject({ method, url, headers, payload });
  let body: Record<string, unknown> = {};
  try { body = r.json() as Record<string, unknown>; } catch { body = { raw: r.body.slice(0, 300) }; }
  return { status: r.statusCode, body };
}

interface CaseOutcome {
  caseId: string;
  coverage: string;
  exposureMinor: number;
  proven: number | null;
  refusal: string | null;
}

async function main(): Promise<number> {
  const pair = projectFrozenPackage(DIR);
  const env = {
    ...process.env,
    NH_AGENTS_ENABLED: "true",
    NH_AGENT_BOUNDARIES: BOUNDARY,
    NH_AGENT_IDLE_DELAY_MS: "10",
    NH_RECONCILIATION_OBSERVER_ENABLED: "true",
    NH_RECONCILER_PSEUDONYM_KEY: randomUUID() + randomUUID(),
    // A THRESHOLD OF 1 MINOR UNIT, stated rather than hidden: the admission bar is deliberately set
    // so low that it excludes nothing, because this exercise measures the DETECTOR and the GATE, and a
    // threshold that quietly dropped small candidates would make the recall figure a figure about the
    // threshold.
    NH_AGENT_ADMISSION_POLICIES: "RevenueUnderBilled:1",
  };
  const app = buildApp({ sourceVerifier: verifier });
  const agents = createAgentProcessFromEnvironment(env, configuredAgentHandlers(env));
  const outcomes: CaseOutcome[] = [];
  let adversarialFailures = 0;
  const preApprovalProbes: [string, Call][] = [];
  let submitted: Call | null = null;

  try {
    agents.start();

    // ── 1 · the two files through the real door ────────────────────────────────────────────────────
    submitted = await call(app, "POST", "/pilot/pairs", OPERATOR, {
      boundaryId: BOUNDARY,
      expectationCsv: pair.expectationCsv,
      billingCsv: pair.billingCsv,
      currency: "USD",
    });
    console.log(`1 · POST /pilot/pairs → ${submitted.status}`);
    if (submitted.status !== 200) {
      console.error(`   REFUSED · ${JSON.stringify(submitted.body).slice(0, 400)}`);
      return 1;
    }
    console.log(`   taskId ${String(submitted.body.taskId ?? "-")}`);

    // ── 2 · the real worker ───────────────────────────────────────────────────────────────────────
    const deadline = Date.now() + 120_000;
    let candidateCount = 0;
    let taskStatus = "";
    while (Date.now() < deadline) {
      const task = await prisma.agentTaskRecord.findFirst({ where: { boundaryId: BOUNDARY } });
      taskStatus = task?.status ?? "";
      candidateCount = await prisma.agentCaseCandidateRecord.count({ where: { boundaryId: BOUNDARY } });
      if (taskStatus === "succeeded" || taskStatus === "failed") break;
      if (agents.readiness().status === "down") throw new Error("the worker stopped before finishing");
      await new Promise((r) => setTimeout(r, 250));
    }
    console.log(`2 · worker → task ${taskStatus || "(none)"} · ${candidateCount} candidate(s)`);
    if (taskStatus !== "succeeded") {
      const task = await prisma.agentTaskRecord.findFirst({ where: { boundaryId: BOUNDARY } });
      console.error(`   task did not succeed · ${JSON.stringify(task?.lastError ?? task?.status).slice(0, 400)}`);
      return 1;
    }

    // ── 3 · the review queue ──────────────────────────────────────────────────────────────────────
    const queue = await call(app, "GET", `/agent-candidates?boundaryId=${BOUNDARY}`, OPERATOR);
    // THE ROUTE RETURNS A BARE ARRAY. The first form guessed `{candidates: [...]}` and read zero from a
    // 200 that carried nine — a shape assumption that reports "nothing in the queue" is worse than an
    // error, because an empty queue is a legitimate state.
    const items = (Array.isArray(queue.body) ? queue.body : []) as Record<string, unknown>[];
    console.log(`3 · GET /agent-candidates → ${queue.status} · ${items.length} in the queue`);
    if (items.length === 0) {
      console.error(`   ${JSON.stringify(queue.body).slice(0, 400)}`);
      return 1;
    }

    // ── 4 · accept, promote, and drive EVERY case to the gate ─────────────────────────────────────
    for (const item of items) {
      const candidateId = String(item.candidateId ?? item.id ?? "");
      const signal = (item.signal ?? {}) as Record<string, unknown>;
      const exposureMinor = Number(signal.amountAtRiskMinor ?? item.amountAtRiskMinor ?? 0);
      // THE QUEUE AND THE REVIEW ARE THE OPERATOR'S, measured not assumed: reading as the approver
      // returned `candidate review requires the operator role`. Separation of duties is enforced where it
      // bears on the MONEY — author != approver on the proof — and the queue is a different surface.
      const review = await call(app, "POST", `/agent-candidates/${candidateId}/review`, OPERATOR, {
        boundaryId: BOUNDARY,
        decision: "accepted",
        reason: "synthetic validation exercise: the reconciler's residual is accepted for promotion",
      });
      if (review.status !== 200 && review.status !== 201) {
        outcomes.push({ caseId: `(not promoted) ${candidateId}`, coverage: "-", exposureMinor, proven: null,
          refusal: `review ${review.status}: ${JSON.stringify(review.body).slice(0, 160)}` });
        continue;
      }
      const promote = await call(app, "POST", `/agent-candidates/${candidateId}/promote`, OPERATOR, { boundaryId: BOUNDARY });
      if (promote.status !== 200 && promote.status !== 201) {
        outcomes.push({ caseId: `(not promoted) ${candidateId}`, coverage: "-", exposureMinor, proven: null,
          refusal: `promote ${promote.status}: ${JSON.stringify(promote.body).slice(0, 160)}` });
        continue;
      }

      const caseId = String(
        promote.body.recoveryCaseId ?? promote.body.caseId
        ?? (promote.body.recoveryCase as { recoveryCaseId?: string } | undefined)?.recoveryCaseId
        ?? (promote.body.root as { recoveryCaseId?: string } | undefined)?.recoveryCaseId ?? "",
      );
      // THE COVERAGE COMES FROM THE CANDIDATE'S OWN SIGNAL, which the queue already returned, because
      // that is the field `provenEligibility` reads (`recoveryCaseRead.ts:174-177`). Taking it from a
      // second response would be a second reading of one fact, and the two could disagree.
      const cov = (signal.obligationCoverage ?? {}) as Record<string, unknown>;
      const coverage = String(cov.kind ?? "(not stated)")
        + (cov.unitCount === undefined ? "" : `(${String(cov.unitCount)})`);
      // Still read, because the governed case record is what an auditor would read.
      const read = await call(app, "GET", `/recovery-cases/${caseId}`, APPROVER);  // AuditRead
      if (read.status !== 200) throw new Error(`GET /recovery-cases/${caseId} → ${read.status}`);

      // The lifecycle, in order, through the governed routes. A failure here is recorded rather than
      // thrown, because one case failing must not hide what the others do.
      const steps: [string, Call][] = [];
      steps.push(["author", await call(app, "POST", `/cases/${caseId}/author`, AUTHOR)]);
      const baselineId = `BL-${caseId}`;
      steps.push(["baseline", await call(app, "POST", `/cases/${caseId}/baseline`, AUTHOR, {
        baselineId,
        // STRICTLY BELOW THE EXPOSURE. A baseline at or above it leaves no room for a recovery and the
        // route refuses — asserted in the browser journey, so it is a known rule and not a guess.
        calculatedMinor: Math.max(1, Math.floor(exposureMinor * 0.1)),
        currency: "USD", method: "synthetic-flat-baseline", methodVersion: 1,
        sourceRefs: [`SYNTHETIC-company-${RUN}`], effectiveAt: new Date().toISOString(),
      })]);
      steps.push(["intervention", await call(app, "POST", `/cases/${caseId}/intervention`, AUTHOR)]);
      const fixId = `EV-FIX-${caseId}`;
      steps.push(["correction", await call(app, "POST", `/cases/${caseId}/evidence`, AUTHOR, attest(caseId, {
        evidenceId: fixId, sourceSystem: "billing", sourceRecordId: `CORRECTIVE-INVOICE-${caseId}`,
        evidenceType: "corrective_invoice_issued", observedAt: new Date().toISOString(),
        amountMinor: exposureMinor, currency: "USD",
      } as EvidenceClaim))]);
      const payId = `EV-PAID-${caseId}`;
      steps.push(["outcome", await call(app, "POST", `/cases/${caseId}/evidence`, AUTHOR, attest(caseId, {
        evidenceId: payId, sourceSystem: "billing", sourceRecordId: `INVOICE-PAID-${caseId}`,
        evidenceType: "invoice_paid", observedAt: new Date().toISOString(),
        amountMinor: exposureMinor, currency: "USD",
      } as EvidenceClaim))]);
      const failed = steps.find(([, c]) => c.status !== 200 && c.status !== 201);
      if (failed) {
        outcomes.push({ caseId, coverage, exposureMinor, proven: null,
          refusal: `${failed[0]} ${failed[1].status}: ${String((failed[1].body as { message?: string }).message ?? JSON.stringify(failed[1].body)).slice(0, 180)}` });
        continue;
      }
      // ── PRE-APPROVAL PROBES, on a case that does NOT yet have a proof ──────────────────────────
      //
      // THEY HAVE TO RUN HERE AND THE FIRST FORM OF THIS HARNESS GOT IT WRONG. Run after approval,
      // the over-claim probe and the vocabulary probe both came back 409 — "this case already has a
      // proof" — which fires BEFORE either check. A reader would have concluded that over-claiming is
      // blocked; what was demonstrated is that a second proof is blocked. *A probe refused for a
      // different reason is not a measurement of the thing it names.*
      if (coverage === "SINGLE_OBLIGATION" && preApprovalProbes.length === 0) {
        const probeBase = {
          recoveryCaseId: caseId, currency: "USD", excludedRecoveryMinor: 0,
          exclusionStatement: "adversarial probe", recoveryReason: "BillingCorrection",
          attribution: "adversarial probe", evidenceIds: [fixId, payId],
          baselineId, confidenceUsed: 85,
        };
        preApprovalProbes.push(["claiming MORE collected than the signatures substantiate",
          await call(app, "POST", "/proofs", APPROVER, { ...probeBase, proofId: `PF-OVER-${caseId}`, collectedMinor: exposureMinor * 10 })]);
        preApprovalProbes.push(["the AUTHOR approving their own case",
          await call(app, "POST", "/proofs", AUTHOR, { ...probeBase, proofId: `PF-SELF-${caseId}`, collectedMinor: exposureMinor })]);
        preApprovalProbes.push(["a recovery reason with no declared correction channel",
          await call(app, "POST", "/proofs", APPROVER, { ...probeBase, proofId: `PF-REASON-${caseId}`, collectedMinor: exposureMinor, recoveryReason: "UsageActivation" })]);
        preApprovalProbes.push(["a reason outside the closed vocabulary altogether",
          await call(app, "POST", "/proofs", APPROVER, { ...probeBase, proofId: `PF-BOGUS-${caseId}`, collectedMinor: exposureMinor, recoveryReason: "NotARealReason" })]);
      }

      // THE APPROVER, NEVER THE AUTHOR.
      const proof = await call(app, "POST", "/proofs", APPROVER, {
        proofId: `PF-${caseId}`, recoveryCaseId: caseId, currency: "USD",
        collectedMinor: exposureMinor, excludedRecoveryMinor: 0,
        exclusionStatement: "synthetic exercise: no excluded recovery is claimed for this case",
        recoveryReason: "BillingCorrection",
        attribution: "the reconciler's residual for this obligation, corrected and settled synthetically",
        evidenceIds: [fixId, payId], baselineId, confidenceUsed: 85,
      });
      if (process.env.COMPANY_DEBUG === "1" && (proof.status === 200 || proof.status === 201)) {
        console.log("   [debug] PROOF KEYS: " + Object.keys(proof.body).join(" "));
        console.log("   [debug] money-ish : " + JSON.stringify(Object.fromEntries(
          Object.entries(proof.body).filter(([k]) => /amount|return|collect|baseline|excluded/i.test(k)))));
      }
      if (proof.status === 200 || proof.status === 201) {
        // ON THE WIRE IT IS A MONEY OBJECT, not the plain number `src/domain/types.ts:90` declares —
        // measured from a real 201 rather than read off the domain type, which is why this reads
        // `{minor, currency}`. It is still ALWAYS computed as `collectedAmount - baselineAmount` and
        // never set by a caller.
        const rr = (proof.body as { revenueReturned?: { minor?: number } }).revenueReturned;
        const returned = Number(rr?.minor ?? NaN);
        outcomes.push({ caseId, coverage, exposureMinor, proven: Number.isNaN(returned) ? null : returned, refusal: null });
      } else {
        outcomes.push({ caseId, coverage, exposureMinor, proven: null,
          refusal: `proof ${proof.status}: ${String((proof.body as { message?: string }).message ?? "").slice(0, 200)}` });
      }
    }
    // ── 5 · ADVERSARIAL PROBES against a case that really reached PROVEN ─────────────────────────
    //
    // Run here rather than in a separate harness because the app, the worker, the keys and a frozen
    // proof are already standing — and because an adversarial test against a case that never reached
    // PROVEN proves nothing: the gate would refuse it for the ordinary reason.
    const provenCase = outcomes.find((o) => o.proven !== null);
    if (provenCase) {
      const id = provenCase.caseId;
      const base = {
        recoveryCaseId: id, currency: "USD", excludedRecoveryMinor: 0,
        exclusionStatement: "adversarial probe", recoveryReason: "BillingCorrection",
        attribution: "adversarial probe", evidenceIds: [`EV-FIX-${id}`, `EV-PAID-${id}`],
        baselineId: `BL-${id}`, confidenceUsed: 85,
      };
      const probes: [string, Call][] = [];
      // ONLY the probes whose subject genuinely requires an existing proof.
      probes.push(["a SECOND proof on a case that already has one",
        await call(app, "POST", "/proofs", APPROVER, { ...base, proofId: `PF-DUP-${id}`, collectedMinor: provenCase.exposureMinor })]);
      probes.push(["re-ingesting the SAME signed outcome evidence twice",
        await call(app, "POST", `/cases/${id}/evidence`, AUTHOR, attest(id, {
          evidenceId: `EV-PAID-${id}`, sourceSystem: "billing", sourceRecordId: `INVOICE-PAID-${id}`,
          evidenceType: "invoice_paid", observedAt: new Date().toISOString(),
          amountMinor: provenCase.exposureMinor, currency: "USD",
        } as EvidenceClaim))]);
      probes.push(["evidence whose amount was altered AFTER it was signed",
        await call(app, "POST", `/cases/${id}/evidence`, AUTHOR, (() => {
          const signed = attest(id, {
            evidenceId: `EV-TAMPER-${id}`, sourceSystem: "billing", sourceRecordId: `TAMPER-${id}`,
            evidenceType: "invoice_paid", observedAt: new Date().toISOString(),
            amountMinor: provenCase.exposureMinor, currency: "USD",
          } as EvidenceClaim);
          return { ...signed, amountMinor: provenCase.exposureMinor * 5 };
        })())]);
      console.log("\n5 · adversarial probes\n");
      for (const [what, r] of [...preApprovalProbes, ...probes]) {
        // A 2xx HERE IS THE FAILURE. Every one of these must be refused, so the pass condition is a
        // refusal and the harness says which status it got rather than only whether it liked it.
        const refused = r.status >= 400;
        console.log("   " + (refused ? "REFUSED " : "ACCEPTED") + " " + String(r.status).padEnd(4)
          + what + (refused ? "" : "   <<< THIS IS A DEFECT"));
        if (!refused) adversarialFailures += 1;
      }
    } else {
      console.log("\n5 · adversarial probes SKIPPED — no case reached PROVEN, so there is nothing to attack.");
      adversarialFailures += 1;
    }
  } finally {
    await agents.stop().catch(() => undefined);
    await app.close().catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
  }

  // ── 5 · the report ──────────────────────────────────────────────────────────────────────────────
  console.log("\n4 · every promoted case, driven to the gate\n");
  console.log("   coverage            exposure      proven       verdict");
  for (const o of outcomes) {
    console.log("   " + o.coverage.padEnd(19) + money(o.exposureMinor).padStart(12)
      + (o.proven === null ? "   NOT COMPUTED" : money(o.proven).padStart(12) + "  ")
      + "  " + (o.refusal ?? "PROVEN"));
  }
  const exposure = outcomes.reduce((t, o) => t + o.exposureMinor, 0);
  const provenCases = outcomes.filter((o) => o.proven !== null);
  const proven = provenCases.reduce((t, o) => t + (o.proven ?? 0), 0);
  console.log("\n   ── LEDGERS, NEVER BLENDED ──");
  console.log("   Revenue Opportunity (OBSERVED exposure) : " + money(exposure) + "   over " + outcomes.length + " case(s)");
  console.log("   Revenue Returned (PROVEN, synthetic)    : " + money(proven) + "   over " + provenCases.length + " case(s)");
  console.log("   cases the gate REFUSED                  : " + outcomes.filter((o) => o.refusal !== null).length);
  const byRefusal = new Map<string, number>();
  for (const o of outcomes) {
    if (o.refusal === null) continue;
    const code = o.refusal.match(/[A-Z][A-Z_]{6,}/)?.[0] ?? o.refusal.slice(0, 40);
    byRefusal.set(code, (byRefusal.get(code) ?? 0) + 1);
  }
  for (const [code, n] of [...byRefusal].sort((a, b) => b[1] - a[1])) {
    console.log("      " + String(n).padStart(3) + " × " + code);
  }
  console.log("\n   SYNTHETIC_VALIDATED, never REAL_CUSTOMER_PROVEN. Every figure above is generated data");
  console.log("   through the production stack. No customer, no real invoice, no real settlement, and no");
  console.log("   observed amount became real Revenue Returned.");
  if (adversarialFailures > 0) {
    console.error("\nADVERSARIAL FAILURES: " + adversarialFailures);
    return 1;
  }
  return 0;
}

main().then((c) => process.exit(c)).catch((e) => {
  console.error("HARNESS ERROR · " + ((e as Error)?.stack ?? String(e)));
  process.exit(2);
});

// CYCLE 2 (2026-09-27) · Drive the frozen synthetic datasets through NH's real governed path, and write
// NH's answer down verbatim.
//
// WHAT CHANGED FROM THE 2026-09-26 RUNNER, and why this file is the only one that had to change: the
// request shape did. `policy: { stallThresholdDays, asOf, currency }` no longer exists on either endpoint
// (EP-26b), so the definition is proposed as the operator, activated as the steward, and cited by
// reference; `declaredVersion` is the contract major the customer declares, now 2.0.0 (EP-28). Everything
// else — the generator, the ground truth, the prediction, the scoring, the reconciliation — is held fixed
// on purpose, so that a difference in NH's answer is attributable to the product and not to a new sample.
//
// This file makes no judgement about whether NH is right. It records what happened — admission,
// refusals, the finding, the execution list — into `raw-output.json`, which `score.mjs` then compares
// against the prediction frozen before this ran. Keeping the two apart is the point: a runner that also
// scored could quietly reinterpret a result.
//
// The path is the one the browser drives: propose the bar as the operator, activate it as a steward,
// upload, then schedule and poll. Nothing is bypassed. A stage that refuses is recorded as a refusal.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DIR = `${ROOT}/e2e/fixtures/synthetic-validation-2026-09-27`;
const PORT = Number(process.env.SV_API_PORT ?? 4100);
const BASE = `http://127.0.0.1:${PORT}/api`;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required — this runs against a real database on purpose.");
  process.exit(2);
}


// ── The freeze gate ───────────────────────────────────────────────────────────────────────────────
// Refuse to proceed unless the experiment is byte-for-byte the one that was frozen before any NH run.
// This is what makes "no adjusting the experiment after seeing the result" enforceable rather than
// promised: the datasets, the manifest, the prediction, every script and the commit are all covered.
function verifyFreeze(dir) {
  const frozen = JSON.parse(readFileSync(`${dir}/FROZEN.json`, "utf8"));
  const sha = (buf) => createHash("sha256").update(buf).digest("hex");
  const problems = [];
  const { compositeSha256, ...record } = frozen;
  if (sha(Buffer.from(JSON.stringify(record))) !== compositeSha256) problems.push("FROZEN.json itself was edited");
  for (const d of frozen.datasets) {
    if (sha(readFileSync(`${dir}/${d.name}.csv`)) !== d.sha256) problems.push(`${d.name}.csv changed since the freeze`);
  }
  if (sha(readFileSync(`${dir}/ground-truth.json`)) !== frozen.groundTruthSha256) problems.push("ground-truth.json changed since the freeze");
  if (sha(readFileSync(`${dir}/prediction.json`)) !== frozen.predictionSha256) problems.push("prediction.json changed since the freeze");
  for (const [file, want] of Object.entries(frozen.scriptSha256)) {
    if (sha(readFileSync(`scripts/synthetic-validation-2026-09-27/${file}`)) !== want) problems.push(`${file} changed since the freeze`);
  }
  if (problems.length) {
    console.error(`FREEZE VIOLATION — refusing to proceed:\n  ${problems.join("\n  ")}`);
    console.error("Re-freeze deliberately with verify.mjs if the change is intended, and say so in the report.");
    process.exit(3);
  }
  console.log(`freeze verified · composite=${compositeSha256.slice(0, 16)}… gitHead=${frozen.gitHead.slice(0, 8)}`);
  return frozen;
}

const frozen = verifyFreeze(DIR);
const truth = JSON.parse(readFileSync(`${DIR}/ground-truth.json`, "utf8"));
const prediction = JSON.parse(readFileSync(`${DIR}/prediction.json`, "utf8"));

const RUN_ID = randomUUID().slice(0, 8);
// Boundary A hosts the three datasets under the permissive bar — different bytes each time, so no
// submission collides. Boundary B hosts the strict-bar control, which re-uploads the SAME bytes as the
// main run and would otherwise be a duplicate submission.
const A = `synthetic-validation-${RUN_ID}`;
const B = `synthetic-validation-strict-${RUN_ID}`;

const OPERATOR = { "x-actor-id": "sv-operator@company", "x-actor-role": "operator" };
const STEWARD = { "x-actor-id": "sv-governance@company", "x-actor-role": "steward" };

const PROVENANCE = {
  sourceSystems: { contract: "synthetic-crm", billing: "synthetic-billing", product: "synthetic-telemetry" },
  dataOwnerRole: "synthetic-revenue-operations",
  extractionMethod: "deterministic synthetic generator, seed recorded in ground-truth.json",
  extractedAt: "2026-06-30T00:00:00.000Z",
  coverageStart: truth.provenanceCoverage.start,
  coverageEnd: truth.provenanceCoverage.end,
  assertedIndependentOfBeneficiary: true,
};

function startApi(boundaries) {
  const child = spawn(process.execPath, [resolve(ROOT, "node_modules/.bin/vite-node"), "server/index.ts"], {
    cwd: ROOT, detached: true, env: {
      ...process.env,
      PORT: String(PORT), HOST: "127.0.0.1",
      NH_AGENTS_ENABLED: "true",
      NH_AGENT_BOUNDARIES: boundaries.join(","),
      NH_AGENT_IDLE_DELAY_MS: "200",
      NH_PILOT_ASSESSMENT_AGENT_ENABLED: "true",
      NH_PILOT_INPUT_TERMINAL_GRACE_HOURS: "24",
      NH_PILOT_INPUT_ABANDONED_RETENTION_DAYS: "7",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (b) => process.env.SV_VERBOSE && console.log(`[api] ${b}`));
  child.stderr.on("data", (b) => process.env.SV_VERBOSE && console.error(`[api] ${b}`));
  return child;
}
const stop = (c) => { try { process.kill(-c.pid, "SIGTERM"); } catch { /* already gone */ } };

async function waitForApi() {
  for (let i = 0; i < 300; i += 1) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) return true; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

async function call(method, path, headers, body) {
  const res = await fetch(`${BASE}${path}`, {
    method, headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* keep the text */ }
  return { status: res.status, body: parsed, text: parsed ? undefined : text.slice(0, 600) };
}

async function activateBar(boundaryId, policyId, policy, label) {
  const steps = {};
  steps.propose = await call("POST", "/pilot/admission-policies", OPERATOR, {
    boundaryId,
    rationale: `synthetic end-to-end validation, ${label} bar, stated before the run`,
    policy: {
      policyId, policyVersion: "1.0.0", calculationMethodVersion: "admission-2026.1",
      minAcceptedRows: policy.minAcceptedRows, minDistinctEntities: policy.minDistinctEntities,
      maxRejectionRate: policy.maxRejectionRate, maxSingleReasonShare: policy.maxSingleReasonShare,
      maxDuplicateRate: policy.maxDuplicateRate, minCoverageDays: policy.minCoverageDays,
      requiredLifecycleStates: policy.requiredLifecycleStates,
      maxOrderingDefectRate: policy.maxOrderingDefectRate,
      maxMissingRecommendedColumns: policy.maxMissingRecommendedColumns,
      requireProvenanceDeclaration: policy.requireProvenanceDeclaration,
    },
  });
  steps.activate = await call("POST", "/pilot/admission-policies/activate", STEWARD, {
    boundaryId, policyId, policyVersion: "1.0.0", rationale: "activated for the synthetic validation run",
  });
  return steps;
}

// EP-26/26b · PUT A GOVERNED ASSESSMENT POLICY IN FORCE.
//
// The cut-off, the stall threshold and the currency are no longer the runner's to state — there is no wire
// format left that would carry them. So the runner does what a pilot does: the operator proposes the
// definition, and a DIFFERENT identity activates it. Both halves are recorded, refusals included. The
// values come from `FROZEN.json`, so the definition this run is read under was fixed before it ran.
async function activateAssessmentPolicy(boundaryId, terms, label) {
  const steps = {};
  steps.propose = await call("POST", "/pilot/analysis-terms", OPERATOR, {
    boundaryId,
    rationale: `synthetic end-to-end validation, ${label} definition, stated before the run`,
    terms: {
      termsId: terms.termsId, termsVersion: terms.termsVersion,
      asOf: terms.asOf, stallThresholdDays: terms.stallThresholdDays, currency: terms.currency,
    },
  });
  steps.activate = await call("POST", "/pilot/analysis-terms/activate", STEWARD, {
    boundaryId, termsId: terms.termsId, termsVersion: terms.termsVersion,
    rationale: "governance activates the definition for the synthetic validation run",
  });
  // The governed read, so the report can show WHO proposed and WHO activated rather than asserting it.
  steps.governance = await call(
    "GET",
    `/pilot/analysis-terms/governance?boundaryId=${encodeURIComponent(boundaryId)}`
      + `&termsId=${encodeURIComponent(terms.termsId)}&termsVersion=${encodeURIComponent(terms.termsVersion)}`,
    STEWARD,
  );
  steps.menu = await call("GET", `/pilot/analysis-terms/list?boundaryId=${encodeURIComponent(boundaryId)}`, OPERATOR);
  return steps;
}

async function uploadAndAssess(boundaryId, policyId, datasetName, label, terms, datasetIdSuffix = "") {
  const record = {
    label, dataset: datasetName, boundaryId, policyId, steps: {},
    assessmentPolicy: { termsId: terms.termsId, termsVersion: terms.termsVersion, asOf: terms.asOf, stallThresholdDays: terms.stallThresholdDays, currency: terms.currency },
  };
  const csvText = readFileSync(`${DIR}/${datasetName}.csv`, "utf8");
  const uploadBody = {
    boundaryId,
    // EP-28 · An operator-typed label, and no longer part of the submission identity. The duplicate
    // control below relies on exactly that: it changes this string and nothing else.
    datasetId: `sv-${datasetName}-${RUN_ID}${datasetIdSuffix}`,
    // EP-28 · contract 2.0.0. The previous cycle declared 1.1.0; the §10 two-major window (EP-27) means
    // a 1.x declaration would still be accepted, but declaring the current major is what a customer on
    // the current contract does, and it is the path under test.
    declaredVersion: "2.0.0",
    csvText,
    // EP-26b · No `policy` object. There is no field here that states what the assessment measures — only
    // a REFERENCE to a definition someone else put in force.
    analysisTermsId: terms.termsId, analysisTermsVersion: terms.termsVersion,
    provenance: PROVENANCE,
    admissionPolicyId: policyId, admissionPolicyVersion: "1.0.0",
  };
  record.steps.upload = await call("POST", "/pilot/datasets", OPERATOR, uploadBody);

  // The bytes are re-supplied so the fingerprint can be re-proved. No bar is named here: the execution
  // binds to the admission decision already recorded, never to a bar chosen at schedule time.
  const { admissionPolicyId: _a, admissionPolicyVersion: _b, ...scheduleBody } = uploadBody;
  record.steps.schedule = await call("POST", "/pilot/assessments", OPERATOR, scheduleBody);

  const executionId = record.steps.schedule.body?.executionId ?? null;
  if (executionId) {
    for (let i = 0; i < 400; i += 1) {
      const view = await call("GET", `/pilot/assessments/${encodeURIComponent(executionId)}?boundaryId=${encodeURIComponent(boundaryId)}`, OPERATOR);
      record.steps.execution = view;
      const state = view.body?.state;
      if (state && state !== "queued" && state !== "running") break;
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  return record;
}

const api = startApi([A, B]);
const out = {
  runId: RUN_ID, startedAt: new Date().toISOString(),
  frozen: { compositeSha256: frozen.compositeSha256, gitHead: frozen.gitHead, runParameters: frozen.runParameters },
  bars: {}, assessmentPolicies: {}, runs: [],
};
try {
  if (!await waitForApi()) throw new Error("the API never became ready");

  const TERMS = frozen.runParameters.governedAssessmentPolicies;

  // ── Boundary A · the permissive bar, and the primary governed definition ────────────────────────
  out.bars.permissive = await activateBar(A, `sv-bar-${RUN_ID}`, prediction.admissionPolicyPermissive, "permissive");
  out.assessmentPolicies.primaryInA = await activateAssessmentPolicy(A, TERMS.primary, "primary");
  for (const d of truth.datasets) {
    out.runs.push(await uploadAndAssess(A, `sv-bar-${RUN_ID}`, d.name, `permissive/${d.name}`, TERMS.primary));
  }

  // ── Boundary B · the strict bar, an adversarial control on the SAME bytes ───────────────────────
  out.bars.strict = await activateBar(B, `sv-strict-${RUN_ID}`, prediction.admissionPolicyStrict, "strict");
  out.assessmentPolicies.primaryInB = await activateAssessmentPolicy(B, TERMS.primary, "primary");
  out.runs.push(await uploadAndAssess(B, `sv-strict-${RUN_ID}`, "dataset", "strict/dataset", TERMS.primary));

  // ── Run 5 · THE GOVERNED RE-READING, a route that did not exist in the previous cycle ───────────
  // The same bytes, in the same boundary, under a SECOND activated definition with a later cut-off. The
  // constitution decision permits asking "and how does this look as of a later date?" precisely so that
  // nobody has to edit an export to ask a question about time — and EP-28 put the governed terms inside
  // the submission identity, which is what makes this a new submission rather than a duplicate.
  out.assessmentPolicies.laterCutoffInA = await activateAssessmentPolicy(A, TERMS.laterCutoff, "later cut-off");
  out.runs.push(await uploadAndAssess(
    A, `sv-bar-${RUN_ID}`, "dataset", "re-read/dataset@laterCutoff", TERMS.laterCutoff, "-reread",
  ));

  // ── Run 6 · THE DUPLICATE CONTROL, the negative half of the same identity change ────────────────
  // Same bytes, same boundary, same governed definition — and a different operator-typed `datasetId`.
  // Under contract 1.x that label WAS part of the identity, so renaming the file bought a second
  // assessment. Under 2.0.0 it is out, and this must be refused 409 NH-DC-4003. A control, not a defect:
  // it is stated in `prediction.json` before the run and is scored against that statement.
  out.runs.push(await uploadAndAssess(
    A, `sv-bar-${RUN_ID}`, "dataset", "duplicate-control/dataset@renamed", TERMS.primary, "-renamed",
  ));

  out.executionLists = {
    [A]: await call("GET", `/pilot/assessments?boundaryId=${encodeURIComponent(A)}`, OPERATOR),
    [B]: await call("GET", `/pilot/assessments?boundaryId=${encodeURIComponent(B)}`, OPERATOR),
  };
} catch (e) {
  out.harnessError = e instanceof Error ? e.stack : String(e);
} finally {
  stop(api);
}
out.finishedAt = new Date().toISOString();
writeFileSync(`${DIR}/raw-output.json`, `${JSON.stringify(out, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });

for (const [name, steps] of Object.entries(out.bars)) {
  console.log(`bar ${name}: propose=${steps.propose.status} activate=${steps.activate.status}`);
}
for (const [name, steps] of Object.entries(out.assessmentPolicies)) {
  const g = steps.governance.body ?? {};
  console.log(`assessment policy ${name}: propose=${steps.propose.status} activate=${steps.activate.status} state=${g.state ?? "n/a"} proposedBy=${g.registeredByActorId ?? g.proposedByActorId ?? "n/a"} activatedBy=${(g.events ?? []).find((e) => e.transition === "ACTIVATED")?.actorId ?? "n/a"}`);
}
for (const r of out.runs) {
  const u = r.steps.upload.body ?? {};
  const f = r.steps.execution?.body?.finding ?? null;
  console.log(`\n── ${r.label} ──`);
  console.log(`read under ${r.assessmentPolicy.termsId}@${r.assessmentPolicy.termsVersion} · asOf=${r.assessmentPolicy.asOf} N=${r.assessmentPolicy.stallThresholdDays} ${r.assessmentPolicy.currency}`);
  console.log(`upload=${r.steps.upload.status} accepted=${u.accepted} usable=${u.usableForAssessment} counts=${JSON.stringify(u.counts)}`);
  console.log(`admission=${u.admission?.outcome ?? "n/a"} policyState=${u.admissionPolicyState ?? "n/a"} govRefusal=${u.admissionGovernanceRefusal ?? "none"}`);
  console.log(`datasetFindings=${(u.datasetFindings ?? []).map((x) => x.code).join(",") || "none"}`);
  console.log(`schedule=${r.steps.schedule.status} scheduled=${r.steps.schedule.body?.scheduled} refusal=${r.steps.schedule.body?.refusal?.code ?? "none"} state=${r.steps.execution?.body?.state ?? "n/a"}`);
  if (f) {
    console.log(`  stalled=${f.stalledCount} undetermined=${f.undeterminedCount} reference=${f.referenceCount} accepted=${f.acceptedCycleCount} excludedCycles=${f.excludedCycleCount}`);
    console.log(`  observedUnpaid=${f.observedUnpaidMinor} partialOutstanding=${f.partialOutstandingMinor} excludedValue=${f.excludedValueMinor} unknownValue=${f.unknownValueMinor} grossEligible=${f.grossEligibleMinor}`);
  }
}
if (out.harnessError) {
  console.error(`\nharness error:\n${out.harnessError}`);
  process.exit(1);
}
console.log(`\nraw NH output written to ${DIR}/raw-output.json`);

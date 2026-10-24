# Constitution amendment proposal · obligation-grain identity

**Status: PROPOSAL FOR REVIEW. NOT ENACTED.** `CLAUDE.md` is untouched, no code implements anything in
this document, and nothing here may be built until the approval gates in §9 are recorded by the owner on
GitHub. Written 2026-10-24 on `claude/pilot-reconciler-demo-v1`. Everything referred to is synthetic.

`CLAUDE.md` requires that a discovered gap is *documented before editing* and that core-definition
changes *go through the constitution before code*. This is that document. It extends, and does not
replace, `RECONCILER_GOVERNANCE_PROPOSALS_V1.md` §B and `OBLIGATION_IDENTITY_MIGRATION_PLAN_V1.md`.

## 1 · The gap, stated once

Candidate identity is `digest([boundaryId, recoveryType, sourceRef])` (`server/agents/caseAdmission.ts`).
`sourceRef` is a pseudonym of the **account**, so the obligation is not in the key. Consequences already
measured (`OBLIGATION_MERGE_RISK_V1.md`, `obligationMergeExposure.test.ts`):

- two obligations of one account are one candidate and one Recovery Case;
- the second observation is **absorbed** (`ON CONFLICT (dedupe_key) DO NOTHING`), keeping the first amount;
- the case says so on every read surface (`ACCOUNT_GRAINED_POTENTIAL`, derived at read time, stored
  nowhere), and absorbed observations are reportable (`absorbedObservations`).

Disclosure makes the merge unmistakable. It does not make the money visible: an absorbed shortfall still
reaches no figure. For the reconciler lane the grain is *a choice of what to pseudonymise*, not a schema
question (`RECONCILER_GOVERNANCE_PROPOSALS_V1.md` §B); for the assessment/activation lane it is a primary
key (`PilotAssessmentEntityAttributionRecord @@id([executionId, sourceRef])`) and stays blocked.

## 2 · Proposed invariant (the text that would enter the constitution)

> **A Recovery Case's identity grain is a property of the DETECTOR that produced its candidate, stated in
> governed data — never a flag the producer sets on the candidate.** A case may be treated as
> obligation-grained only when (i) its detector version is listed in the governed identity-grain map as
> `OBLIGATION`, and (ii) its `sourceRef` was derived from a **source-stated** obligation reference, with a
> domain-separation tag, in a way the beneficiary cannot choose after the fact. Everything else — including
> every detector version absent from the map — is `ACCOUNT_GRAINED_POTENTIAL`. **Absent means account.**
>
> **One boundary and recovery type carries one grain at a time.** A grain is never mixed within a boundary
> for the same recovery type, and exposure at two grains is never summed.
>
> **A map change never re-labels history.** The grain that applies to a case is the one in force when its
> candidate was persisted.

Why a data map and not a candidate flag: a flag set by the producer is the producer vouching for its own
identity guarantee — the beneficiary-influences-the-number test, answered the wrong way. The map is changed
only by a recorded decision.

## 3 · `sourceRef` mapping (reconciler lane only)

| | Today (account grain) | Proposed (obligation grain) |
|---|---|---|
| detector version | `reconciliation-observer` current | a **new** version string; the old one stays in history |
| `sourceRef` | `HMAC(key, payer)` | `HMAC(key, frame("reconciliation-obligation", scheduleLineRef))` |
| candidates per payer | one, positives **summed** | one per under-billed **unit**, amount = that unit's residual, **no summing** |
| framing | — | length-framed components (as `digest` in `caseAdmission.ts` already does), so no concatenation ambiguity |

- The **domain-separation tag** means an obligation `sourceRef` can never equal an account pseudonym for the
  same key, so the two grains cannot collide in the dedupe table.
- A unit with **two live lines** is already `REFUSED_AMBIGUOUS_LIVE_LINES` and yields no candidate; a unit
  with **no** `schedule_line_ref` is withheld. **There is no silent fallback to account grain inside the new
  detector version** — falling back would put two grains under one version, which §2 forbids.
- The ref comes from the **expectation extract**, an independently sourced artefact (the standing rule that
  an expectation originates in a system other than the one that should act). It is not a field the
  reconciler invents, and NH never creates or infers one.

## 4 · Backward compatibility and migration

- **Reconciler lane: no database migration.** `agent_case_candidates.dedupe_key` and
  `RecoveryCaseRecord.sourceRef` are free strings; the new mapping is different *input* to the existing
  digest. The pinned dedupe digest in `caseGrainSafety.test.ts` must remain **byte-identical**, because the
  key formula does not change — that test is the proof that no stored key is re-identified.
- **Historical rows are untouched.** Every existing candidate and case has a detector version that is absent
  from the map, so it reads as account-grained, exactly as now.
- **Assessment/activation lane: unchanged and still blocked** by the primary-key migration in
  `OBLIGATION_IDENTITY_MIGRATION_PLAN_V1.md` §5. This amendment does not unblock it and must not be read as
  doing so. `OBLIGATION_IDENTITY_FIELDS = []` and contract `2.0.0` are not touched.
- **Disclosure** (`deriveCaseIdentityGrain`) must read the map instead of assuming the grain, and the UI
  wording ("account pseudonym", "account-level") must be derived from the disclosure rather than hardcoded.
  `OBLIGATION_UNIQUENESS_GUARANTEED` stays structurally unreachable for every detector not in the map.

## 5 · Duplicate-counting controls

The new risk this amendment creates is the same money represented at **two grains**. Controls, in the order
they would be implemented:

1. **Single grain per boundary and recovery type** (§2). The obligation-mode reconciler **refuses to run**
   in a boundary that already holds account-grained reconciler candidates or cases, and the reverse. This
   is fail-closed, not a warning.
2. **No cross-grain totals.** Opportunity totals sum distinct units within one run; the units are a
   partition of the book, so there is no overlap by construction. A batch in which two signals share a
   `sourceRef` is **rejected within the run** rather than silently absorbed.
3. **Existing proof-side controls stay as they are:** one counted proof-chain root per case
   (`chainRootExists`) and the single-use outcome-evidence index, so one payment cannot back two proofs.
   *Not verified in this document:* the exact scope of the single-use index. It is cited from the error
   handler's comment (`server/http/errors.ts`); the reviewer should read the index definition before relying
   on it.
4. **First observation wins** continues per obligation, with its documented limits: a corrected amount for
   an already-observed obligation is absorbed, and an obligation re-keyed in the source is a new reference
   unless the source keeps the old one.

## 6 · Affected tests (changed with **recomputed** expectations, never loosened)

| Area | Tests |
|---|---|
| grain derivation | `src/domain/caseIdentityGrain.test.ts` |
| wording on screens | `src/modules/CandidateReviewQueue.test.ts`, `src/modules/recoveryCaseCenter.test.ts`, `src/components/IdentityGrainNotice.tsx` consumers |
| server read paths | `server/agents/candidateReview.test.ts`, `server/services/recoveryCaseRead.test.ts` |
| merge behaviour | `server/services/caseGrainSafety.test.ts` (dedupe digest pin must **not** move), `server/agents/obligationMergeExposure.test.ts` |
| reconciler | `server/agents/reconciliationObserver` tests; the Postgres worker test (first observation wins on the production store) |
| end to end | `server/demo/syntheticDemo.postgres.test.ts`, `e2e/journey.mjs` §14 and §14b |

New tests required: two obligations of one payer yield **two** candidates; a unit with ambiguous live lines
yields **none**; a unit without a reference is withheld; a mixed-grain boundary refuses to run; a map change
does not re-label an already-persisted case; a detector absent from the map is account-grained.
*Hypothesis, to be verified, not claimed:* the demo book has three payers, so the $3,100 / $600 → $500
journey should be unchanged in its figures.

## 7 · Roll-out and rollback

- **Roll-out:** behind its own flag, **default off**; first and only in a **fresh synthetic boundary**.
  No production use exists or is proposed. Map entry added only after §9 approvals.
- **Rollback is forward-only after the first write**, stated plainly. Turning the flag off stops *new*
  obligation-grained candidates. Candidates and cases already created are append-only and stay, labelled by
  their detector version. Because of §2, a boundary that holds obligation-grained cases then **refuses**
  account-grained runs; the way back to account grain is a **new boundary**, not an edit.
- **Key rotation:** the pseudonym key is an input to every `sourceRef`. Rotating it would re-identify every
  candidate and defeat dedupe. A rotation procedure is out of scope here and must be decided before any
  non-synthetic use.

## 8 · Risks and open questions

1. **Stability of `schedule_line_ref` across reschedule, renewal and amendment is unproven.** It is
   supported only by synthetic measurement (`OBLIGATION_REF_COUNTERFACTUAL_V1.md`). A real billing system
   may not keep it stable.
2. **The map is a claim about the detector.** If a detector listed as `OBLIGATION` emits two signals for one
   reference, the map is wrong. The within-run rejection in §5(2) and a detector-level test are the guard.
3. **Can the beneficiary influence the number?** A source that splits one obligation into several
   references would create several Opportunity candidates. Opportunity is never counted as money, and proven
   dollars remain bounded by baseline and signed evidence, but the candidate count would inflate. Review
   item for the standing architecture test.
4. **The reverse direction of the BillingCorrection scope rule** (a `RevenueUnderBilled` case must use
   `BillingCorrection`) is a separate decision and is not part of this amendment.
5. **No retained evidence from real data** supports any of this; it rests on a frozen synthetic book.

## 9 · Approval gate — nothing proceeds without these, recorded on GitHub

| Gate | Who | Covers |
|---|---|---|
| G1 | constitution owner | the text in §2, as written or as amended |
| G2 | constitution owner | the identity-grain map as governed data, and who may change it |
| G3 | product owner | implementing the reconciler obligation mode (§3), behind the flag |
| G4 | product owner | the roll-out boundary and the rollback statement in §7 |

Until G1 and G2 are granted, this remains a proposal: no constitution edit, no map, no `sourceRef` change,
no flag, no test changed. A granted gate is the owner's own GitHub comment; an agent's statement that the
owner agreed is not one.

## 10 · What this does not change

`Collected − Baseline`, the confidence threshold, the two ledgers, separation of duties, the proof
vocabulary, contract `2.0.0`, both extract contracts, the assessment/activation lane, any migration, and any
production resource.

# Workstream B · Contract 2.1.0 — independent compatibility review

**Status: INVESTIGATION. No version constant moved, no field declared, no migration written.**
Contract remains **2.0.0**, expectation extract **1.1.0**, billing extract **1.0.0**.

Written 2026-10-20 against `04c190a`. The brief said not to assume MINOR is correct merely because the
`pds` hash is unchanged. It is not assumed below; every identity surface in the repository was checked
individually.

---

## 1 · Verdict

> **SCOPE OF THIS DOCUMENT: contract compatibility only.** On instruction, a contract decision may not
> rest on field-level compatibility alone — it must separately establish obligation-level identity,
> database-key migration safety, historical case continuity and rollout ordering. Those four are
> determined in [`OBLIGATION_MERGE_RISK_V1.md`](OBLIGATION_MERGE_RISK_V1.md) §4, and **two of them are
> open**. The verdict below is one input of five, and it is the least important of them.

> **MINOR is correct — `2.0.0` → `2.1.0` — for ONE OPTIONAL field with zero synonyms that is kept out of
> the cycle key.** It is safe on identity, on meaning and on historical reproduction.
>
> **But it is not sufficient, and it is not the first thing to do.** The blocker is a schema migration in
> the staged-attribution primary key (Workstream A §5). Declaring the field before that exists would be
> the `obligation_ref` revert of 2026-10-01 repeated: a field with nowhere to be stored.

Three conditions bound the verdict. Breach any one and MINOR stops being true:

1. **Tier is OPTIONAL, never RECOMMENDED** (§4).
2. **The field never enters the cycle key** (§3.4).
3. **The build ships before the customer-facing ask** (§5) — producer/consumer order is not symmetric.

## 2 · The claim that does hold, and why it is not the whole answer

`deriveIdempotencyKey` (`src/contract/validateDataset.ts:600`) hashes

```
IDEMPOTENCY_DERIVATION ‖ id@major-N ‖ boundaryId ‖ datasetFingerprint ‖ dateLocale ‖ amountFormat ‖ currency ‖ asOf ‖ stallThresholdDays
```

and `datasetFingerprint = sha256(csvText)` (`:230`). A customer who adds a column changes their bytes and
therefore their submission identity **automatically**, with no change to the derivation. The version
component is already narrowed to the **major**, so a minor bump resets nothing.

That settles `pds` and settles nothing else. The other seven surfaces follow.

## 3 · Every identity and meaning surface, checked individually

| surface | can an optional observation column move it? | evidence |
|---|---|---|
| `pds` submission identity | **only via the file's own bytes**, which is the existing rule | `validateDataset.ts:600`, `:230` |
| `PAX-` execution identity / `hashExecutionBinding` | **yes for NEW executions** — `canonicalBinding` includes the full `contractVersion` string — but **never for a historical one**: the binding reads `decision.contractVersion` from the immutable admission decision, not the build constant | `assessmentExecution.ts:167,177`; `pilotAssessmentService.ts:478,1012` |
| `bindingHash` stored on an execution | **no** — written once, read back for display, **never recomputed and compared** | `pilotAssessmentService.ts:784,1176` |
| `hashExecutionInput` / `execution_input_tampered` | **no** — the projection drops every attribute but `paid_timing`, so the field cannot enter the preimage | `assessmentExecution.ts:402`; test 10 |
| `canonicalFinding` / `findingHash` | **no, under condition 2** — the preimage is counts and money only. It *would* move if the field entered the cycle key, by changing which rows collide and therefore `acceptedCycleCount` | `assessmentExecution.ts:482` |
| `admissionPolicyHash` | **no** — hashed over the policy's own thresholds, which no customer column touches | `prisma/schema.prisma` `pilot_admission_policies.policy_hash` |
| `sourceResolutionHash` | **no** — over boundary, dataset fingerprint and the governed source lineage | `pilotAssessmentService.ts:777` |
| `expectationValidationWitness` | **no** — a sibling artefact with its own scheme; the observation contract is not its input | `src/contract/expectationExtract.ts` |

**The one genuine movement is `PAX-`, and it is correct that it moves.** A new execution under a new
contract version *is* a different execution. Nothing re-derives a historical `PAX-`, so no stored record
reads as changed — which is precisely the property the reference-first scheduling decision was built to
give, now paying for itself.

### 3.4 · The condition that carries the most weight

`CYCLE_KEY_SOURCE_COLUMNS` declares the five columns that may reach the cycle key, as data rather than as
a comment (`src/assessment/cycleKeyRule.ts:148`). Keeping `obligation_ref` out of that list is what keeps
`findingHash` unmoved. If a later slice adds it there, **the same historical input under the same governed
terms would produce a different `findingHash`** — the witness becoming a function of the build, which is
exactly what Detector #2 was redesigned to avoid. Test 7 pins the exclusion.

## 4 · Why OPTIONAL and never RECOMMENDED — a mechanical reason, not a stylistic one

A recommended column absent from an export raises `MISSING_RECOMMENDED_COLUMN` and is counted against
`policy.maxMissingRecommendedColumns` (`src/contract/admissionGate.ts:300`). That threshold is **persisted
per registered policy version and hash-committed** (`prisma/schema.prisma:545`), and admission policies are
append-only — the value was chosen when the recommended set was smaller.

So a RECOMMENDED addition can push an existing export over a bar **nobody moved**, making a dataset valid
yesterday invalid today. `COMPATIBILITY_POLICY` calls that *major* in its own words: *"Tighten a validation
rule so a previously valid dataset is now rejected."* An OPTIONAL field never enters that count.

Against the policy's **minor** list the addition is squarely legitimate: *"Add an optional or recommended
field"* and *"Relax a rule so that a dataset valid under X.Y is still valid under X.(Y+1)."* Today a
customer who includes an `obligation_ref` column is **rejected** — `UNDECLARED_COLUMN`, `NH-DC-1005`,
severity `dataset_rejected` (`src/contract/rejectionCodes.ts:74`). Declaring the field accepts a file that
was previously refused. That is relaxation, in the permitted direction.

## 5 · Rollout — the order is forced and asymmetric

`isSupportedContractVersion` (`src/contract/pilotDataContract.ts:644`):

```ts
if (d.minor > impl.minor) return false;   // declared 2.1.0 on a 2.0.0 build → REFUSED
...
return true;                              // declared 2.0.0 on a 2.1.0 build → ACCEPTED
```

with `acceptsNewerThanImplemented: false` as the published promise and `NH-DC-5001` as the refusal.

* **Consumer first.** Every build that may receive a submission must implement 2.1.0 **before** any
  customer is told to declare it. A customer declaring 2.1.0 against a still-deployed 2.0.0 build is
  refused outright.
* **Old declarations keep working**, indefinitely. No customer is forced to move.
* **No migration of stored data.** No `pds`, admission decision, execution, finding, case or proof changes
  meaning or identity.
* **The dual-major registry is not involved.** `previousMajorSupport` governs *majors*; 2.1.0 is the same
  major, so no entry and no ceiling changes.

### 5.1 · A finding: the declared version does not gate the column set

`UNDECLARED_COLUMN` compares headers against the **build's** field table via `contractField(trimmed)`
(`validateDataset.ts:328`) — not against the field table of the version the file declares. So on a 2.1.0
build, a file declaring **2.0.0** and carrying `obligation_ref` is **accepted**.

This is harmless for an additive optional field and is reported rather than patched, because it is a
pre-existing property of the validator and changing it would tighten a rule. It is worth knowing before
anyone reasons that "the declared version controls what we read". It does not.

### 5.2 · A finding: no generated document renders the observation contract

`PILOT_DATA_CONTRACT_FIELDS` has exactly **two** production consumers — `pilotDataContract.ts` itself and
`validateDataset.ts`. The pilot-intake package generator renders `EXPECTATION_EXTRACT_FIELDS` and
`BILLING_EXTRACT_FIELDS` only.

So `docs/CUSTOMER_PILOT_DATA_CONTRACT_V1.md` is **hand-authored**, and nothing asserts it matches the
field table. A 2.1.0 bump therefore requires a manual customer-document edit that no test would catch if
it were forgotten — the drift the dependency probe exists to prevent, on the one contract it does not
cover. **Named as a prerequisite**, not fixed here.

## 6 · What a 2.1.0 slice must contain, if authorised

Producer and consumer that must ship **together**, in one slice, per the revert rule:

1. The field in `PILOT_DATA_CONTRACT_FIELDS` — OPTIONAL, zero synonyms, not in `CYCLE_KEY_SOURCE_COLUMNS`.
2. The adapter carrying the value onto the accepted cycle's `attributes`.
3. **Its consumer**: `deriveStagedAttributions` reading it pre-projection — which requires the staged
   table's primary key to admit an obligation component **first** (Workstream A §5).
4. `OBLIGATION_IDENTITY_FIELDS` extended, which is what flips `leakInstanceIdentityStatus()`.
5. The hand-authored customer contract document updated, and §5.2's gap closed or explicitly accepted.
6. `PILOT_DATA_CONTRACT_VERSION` → `2.1.0`, last.

## 7 · What remains NOT ESTABLISHED

* Whether `PAX-` moving for new executions has any operational consequence beyond identity — no evidence
  was found that anything compares a historical `PAX-` to a recomputed one, but absence of a caller is
  weaker evidence than a guard that forbids one.
* Whether any deployed environment other than this repository's CI runs an older build. The rollout gate
  in §5 is only as good as the answer, and that is an operational fact, not a code fact.

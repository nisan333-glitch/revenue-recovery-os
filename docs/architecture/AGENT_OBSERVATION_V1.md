# Agent observation — the refused figure leaves the handler

Issue #18, owner-approved widening of `AgentHandler`. Baseline `e2e65ed`.

**The defect, in one sentence.** `reconciliationObserver` computed a refused-exposure figure and `run`
could return only `CandidateSignal[]`, so the figure was discarded at the handler boundary and reached no
record, no API and no screen — **a governed number that existed and could not be read.**

And it could not be closed any other way. A refused unit deliberately produces **no candidate** —
crediting a malformed reference is exactly what the refusal prevents — so the signal array was
structurally the wrong channel; and no read-side derivation could have recovered it, because the fact
never reached the database at all. That is what made this a contract change rather than a query.

---

## 1 · The rules this slice establishes

> **The return type is a UNION, and that is the whole compatibility story.** A handler that returns a
> bare array is unchanged and untouched — every existing one does — and a handler with something to
> record returns `{ signals, observation }`. The runtime normalises in one place, so neither form is
> privileged and **no handler had to be edited for this to exist.**

> **The compatibility cost is on CALLERS of `run`, not on authors of it** — and it was measured before
> the change, not discovered after. `runtime.ts` is the **only production caller**, and exactly **one
> test file** called it directly. That is what bounded the blast radius; had there been a dozen, this
> would have been a migration.

> **The observation is a closed, validated shape, not a free-form bag.** An unknown key is a contract
> violation rather than data, the same treatment `obligationCoverage` gets. A detector's output is less
> dangerous than a request's — the beneficiary does not author it — but an unvalidated channel into
> persisted metadata is still a channel, and this one is read by a financial report.

> **It cannot express money the business got back.** There is no collected, recovered or returned field,
> and a test asserts that adding one is refused. What it carries is what a detector **refused** to claim.

> **A state that contradicts its own counts is refused**, so the three states stay distinguishable in
> practice and not merely in their names: `UNDETERMINED` with no refused units, or `NONE_REFUSED` with
> units, would make the vocabulary meaningless at the first careless writer.

> **It is namespaced under one metadata key.** The event metadata merge is
> `{ ...metadata, ...additionalMetadata }`, and `absorbedObservations` and `caseProvenGate` read
> `admittedCount`/`createdCount` **by name** — so an un-namespaced field would be one rename away from
> shadowing a financial control. Omitted entirely when there is no observation: a `null` under that key
> would invite a reader to treat it as *examined, nothing found*.

> **No prose is stored.** `plan.refusedExposure.headline` is our wording, and a stored sentence drifts
> from the code that renders it. The facts travel; the reader builds its own sentence.

---

## 2 · Four states on the read side, and not one of them is a bare zero

| state | means | `refusedExpectedMinor` |
|---|---|---|
| `NOT_RECORDED` | **no run recorded an observation.** Either no detector that can refuse has run here, or its runs predate handlers being able to record one. | no field at all |
| `NOT_EXAMINED` | a run recorded that it could not read the extract. Nobody looked. | `null` |
| `NONE_REFUSED` | the units were examined and none was refused. **This zero is a finding.** | the stated total |
| `UNDETERMINED` | units were refused, so what they withhold cannot be stated. | the contract side's figure |

**`NOT_RECORDED` and `NONE_REFUSED` are the pair that must never be confused** — both would render as
"nothing refused" to a careless reader, and only one of them examined anything. They are separate
*shapes*, not one nullable number, so `establishable` cannot be skipped on the way to a figure: the
union narrowing makes a reader establish that a figure exists before reaching it.

**Across several runs the WORST state wins**, never the latest and never an average. `UNDETERMINED` on
any run means something was refused in this boundary and a later clean run cannot undo it;
`NOT_EXAMINED` on any run means part of the book was never read. A mutation taking the latest run fails.

**`refusedExpectedMinor` is NOT exposure** and is never summed into any monetary total. It is what the
**contract** side stated on refused units, which is not in doubt; the residual is absent by design,
because the residual is exactly what the refusal is about and publishing one would be the authored figure
the refusal exists to prevent. Where `refusedWithoutExpected` is above zero the expected total is a
**lower bound**, and the count is carried so a reader can see that.

---

## 3 · Measured

On the four-case book, with a refusal recorded through the **real** `PostgresAgentTaskStore` — the
production code that composes the event metadata, not a hand-built INSERT:

- `UNDETERMINED`, 1 refused unit, `refusedExpectedMinor` **$1,200.00**, 1 run carrying an observation
- detected exposure **$1,400.00** and open balance **$1,400.00**, both unchanged
- $2,600.00 — their sum — appears nowhere, and no row's exposure equals the refused figure
- the metadata object holds exactly `["observation", "signalCount"]`, so `admittedCount`/`createdCount`
  are untouched and the proven case still reads `ELIGIBLE`

**Eight mutations prove the tests can fail:** skipping validation in the runtime (1), allowing an unknown
key (2), letting `UNDETERMINED` carry zero units (1), un-namespacing the metadata (5), the observer
ceasing to record (3), reading `NOT_RECORDED` as `NONE_REFUSED` (4), taking the latest run instead of the
worst (1), and summing the refused figure into exposure (4). Each reverted and green again.

---

## 4 · One pre-existing test was edited, and why that was the honest move

`runtime.contract.test.ts` asserted a non-array return fails with `/must be an array/i`. **The property
it protects is unchanged** — the task is refused, no partial result is recorded, the failure is
non-terminal — but a bare object is no longer automatically invalid, because one of the two legal forms
*is* an object. So the refusal now comes from the normaliser with its own message. The assertion was
updated and the reason recorded in the test; bending the message to fit the old regex would have been the
alternative, and that is making the code lie to keep a test quiet. A second test was added for the case
the old one also covered implicitly: an **array** whose entries are not signals still fails through the
batch assertion.

---

## 5 · What this does NOT do

It does not change what the detector refuses — S-ID-1's Option A stands, and no beneficiary-favourable
lever was opened. It does not split an aggregate into per-unit candidates — S-DUP-2's Option B remains an
owner decision. It creates no candidate, no case and no proof from a refusal. And it turns no observed
amount into Revenue Returned: the figure it carries is money a detector **declined to claim**.

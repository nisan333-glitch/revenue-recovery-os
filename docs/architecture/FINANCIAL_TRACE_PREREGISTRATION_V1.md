# Financial trace — pre-registered expectations

Issue #18, Priority 3, item 1. Baseline `99d091c` (CI 6/6 green, run 42177005443).

## The freeze

| | |
|---|---|
| Pre-registration | [`financial-trace-preregistration.json`](financial-trace-preregistration.json) |
| sha256 | `241a39f7fd7d14507db8e5a26d71c5849b70e461c963ac39385246cdd092b46f` |
| Size | 8106 bytes |
| Written | before any line of `financialTrace.ts` existed, and before the first run |

**The expectations are IMPORTED by the tests, not transcribed beside them.** Prose would have let an
expectation and an assertion drift apart silently; this repository has already paid for that twice —
the self-healing freeze record the generator rewrote on every run, and the scorer edited after the
first result was visible. The pre-registration is data, the tests read it, and a frozen hash in
`financialTrace.preregistration.test.ts` fails loudly the moment the data moves.

**The freeze is in git's commit order, not in a lock the covered thing writes.** This file and the JSON
land in a commit of their own, *before* the implementation commit. A lock written by the artefact it
covers always agrees with it — *a gate that updates itself cannot detect the only thing it exists to
detect* — so the evidence that the expectations pre-date the result is the history, which no later edit
can reorder.

## What is pre-registered

**Ten stages**, source obligation → detection → candidate → review → case → baseline → proposed
correction → correction record → settlement evidence → proof. Each carries the table its facts came
from, so a reader can go and look.

**Two class fields per stage, never one.** `executionClass` says whether real production code ran;
`inputClass` says who produced the input. A stage can be `EXECUTED` and `SIMULATED` at once, and the
whole point of reporting both is that saying only the first half is how a demo gets mistaken for a
pilot. The owner's three words map on as: *simulated* → `inputClass: SIMULATED`, *executed* →
`executionClass: EXECUTED`, *attested* → `inputClass: ATTESTED`, which **nothing in this build
reaches**.

**Six global properties** (G1–G6) and **six deliberate failure scenarios** (F1–F6). G1 is the one the
owner's requirement 5 asks for directly, and it is pre-registered as a prediction that can be wrong:

> `revenueReturned.established` is **false for every case in this build**, with code
> `REVENUE_RETURNED_NOT_INDEPENDENTLY_ATTESTED`.

**Derived, not asserted.** The verdict comes from the *shape of the record*: the Ed25519 receipt
(`SourceReceipt`) and the trust registry entry (`SourceTrustKey`) carry **no field recording who holds
the private key**, so an NH-generated fixture key and a customer system's key are indistinguishable
once verification has succeeded. It is explicitly **not** derived from the keyId string — the journey's
key happens to be named `SYNTHETIC-DEMO-billing-…`, and *a term is not a claim*. A test asserts neither
type carries a provenance field, so the verdict rests on a structural fact and flips on its own the day
one is added.

**One lane boundary is kept rather than borrowed.** `PROVENANCE_CHANNELS` in
`src/contract/sourceFactAuthority.ts` already records that the four channels reaching
`AUTHORITY_VERIFIED` are all unimplemented — but that catalogue governs the *customer-data readiness*
lane, and settlement-evidence verification is the *proof* lane. Reading one lane's fact as the other's
is the mistake already on record twice in this repository (the pre-registration framing copied onto
`DATA_OWNER_ATTESTATION`; the calculation-method gate sentence borrowed into the benchmark harness). So
the proof lane's verdict is derived from the proof lane's own types, and the readiness catalogue is
reported beside it as corroboration, clearly labelled as a different lane.

## What it does not claim

That a billing correction was issued — no mechanism exists and none is built here. That money was
collected — no independent source has ever signed anything. That any observed amount became Revenue
Returned. Every figure is synthetic.

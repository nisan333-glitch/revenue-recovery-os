# Governed benchmark revision · V1 → V2

**The business data did not change. Only the ruler did.**

## 1 · V1 · HISTORICAL MEASUREMENT · INVALIDATED FOR DECISION USE

**Reason for invalidation:** the scorer **double-counted monetary attribution across co-located
mechanisms at payer grain**. Six payers in the frozen package carry more than one planted mechanism, so
a residual on a shared payer-period unit was charged to every case that touched it.

**V1's reported figures, preserved as evidence of the measurement defect — not as a benchmark result:**

| V1 figure (payer-period candidate) | Reported |
|---|---|
| detected positive | $86,258.30 |
| true positive | $56,858.30 |
| **false-positive money** | **$22,598.80** |
| …of which on zero-truth cases | $12,798.80 |
| false negative | $9,483.70 |
| recall / precision | 66.16% / 65.92% |

The governed V2 figure for the **same bytes** is **$9,800.00** of false-positive money. The $12,798.80
difference is the double-count, and it is exactly the M12 pause figure charged twice — once to
`M11-missed-after-amendment` and once to `M12-pause-resume`, which share `syn-acct-017`.

### How V1 came to need reconstructing, which is part of the finding

**V1's bytes were never committed.** The scorer was corrected in the working tree after its first run,
and only the corrected form reached git. The preserved artefact
(`scripts/reconciliation-synthetic/history/score.v1.invalidated.mjs`) is therefore a **reconstruction**,
produced by reversing the two recorded patches, and validated the only way a reconstruction can be: it
reproduces V1's reported **$22,598.80** and **$12,798.80** exactly against the byte-identical package.

That it had to be reconstructed is the compounding half of the original disclosure. The freeze lock now
covers the scorer precisely so this cannot recur.

## 2 · Business-data byte identity · proved three ways

| Artefact | SHA-256 |
|---|---|
`expectation.csv` | `31992d23dc8cd86d25aca9cb993d760d396f78e15294e88be5f17ce912959939` |
`observation.csv` | `0ef21e4097f488877a09f35ab9fa8f1c7ac61e167bc4163dce1b5199a6dfb186` |
`ground-truth.csv` | `024f69237bc0521c8d8420eb52a51d3b78389952841a7164588eae1b9ad3c264` |
`planted-register.json` | `111db9d180c43fe46939d2889538cd9f5cb2e4c6d7676317f2f34ea6129aab9f` |

1. **Unchanged across regeneration** — the four hashes are identical before and after re-running the
   generator, so the data is a deterministic function of its source.
2. **The generator is unchanged since its first commit** — `git diff 20c3755 HEAD` on
   `generate.mjs` is **empty**. The data's source has not moved since before the first scoring run.
3. **They match the lock committed at `dd09354`**, which predates this revision.

So the planted cases, monetary amounts, identities, mechanisms, expected outcomes and denominators are
all demonstrably untouched. **Nothing about the experiment was tuned; the measurement was corrected.**

## 3 · Scorer hashes and the diff

| | SHA-256 |
|---|---|
**V1** (reconstructed, invalidated) | `ed654f1a0783e86bd39e2bc510938f9d79df9019101f761a6fec9f573d466c89` |
**V2** (governed, in the freeze lock) | `060359f5e70cb2541c22c4c5468de8cce53d18f450ea5d7192f3f297c207b4e8` |

Exact source diff: `scripts/reconciliation-synthetic/history/score.v1-to-v2.diff` (132 lines, covering
both the attribution correction and the move from the self-healing record to the tracked lock).

**The correction, in one sentence:** cases whose unit keys intersect are grouped into **attribution
clusters** and scored once per cluster against the cluster's summed planted truth, instead of once per
case against its own.

## 4 · Which metrics the revision affects

**Affected — and only on the payer-period candidate, which is the only grain where two mechanisms can
share a unit key:**

* false-positive money ($22,598.80 → **$9,800.00**)
* false-positive money on zero-truth cases ($12,798.80 → **$0.00**)
* per-mechanism money attribution, which is now reported as **NOT ATTRIBUTABLE** for the 12 of 19 cases
  whose keys collide, rather than as a figure

**Unaffected — identical under both rulers:**

* total authoritative planted money · $85,942.00
* every figure for `A_SUBSCRIPTION` and `E_SUBSCRIPTION_WITH_LEGACY_ALIAS` (entitlement grain gives every
  case its own key, so no cluster forms and nothing could be double-counted)
* `B_CONTRACT` and `C_SCHEDULE_LINE` · NOT CONSTRUCTIBLE
* detected positive, true positive, false negative, recall and precision on **all** candidates
* UNKNOWN cases (3), refusals, unpriced units, gross negative, paired held out

The headline finding is therefore **unchanged by the revision**: the correction touched one candidate's
false-positive accounting and its attribution reporting, and moved no recall figure anywhere.

## 5 · The official PRE-FIX baseline · V2 · unmodified core

Core `c80b35c5ee929293264c61397f62aee77140454d22b663641753ce6fc50018ea` — **unmodified**.
Baseline `5a951e406350d2a6b3c6d0d3cb3dde0fd154da230cd12e374826f0fdd5a82fef`.

| Candidate | Detected | TP | FP | FN | Recall | Precision | Refusals (unwarranted) | Attribution |
|---|---|---|---|---|---|---|---|---|
| **A** entitlement ↔ subscription | $0.00 | $0.00 | $0.00 | $66,342.00 | **0.00%** | null | 107 (**9**) | 19/19 attributable |
| **B** contract | — | — | — | — | — | — | — | NOT CONSTRUCTIBLE |
| **C** schedule line | — | — | — | — | — | — | — | NOT CONSTRUCTIBLE |
| **D** payer × period | $86,258.30 | $56,858.30 | **$9,800.00** | $9,483.70 | 66.16% | 65.92% | 9 (2) | **12 of 19 NOT attributable** |
| **E** A + legacy alias | $0.00 | $0.00 | $0.00 | $66,342.00 | **0.00%** | null | 51 (**8**) | 19/19 attributable |

Planted: **$85,942.00** · 16 priced · 3 UNKNOWN · 3 must-refuse · 4 unpriced units on every candidate.

### The precise statement of what this baseline shows

Not "the core detects nothing". Two distinct findings, which must stay distinct:

1. **The intended entitlement/subscription reconciliation path detected $0.00** against the frozen
   package **because dataset-global unmatched-identity taint poisoned every positive residual.** The
   path itself is sound; one guard's scope defeats it. 9 of its 107 refusals are unwarranted by the
   ground truth's own classification.
2. **The payer-period aggregate candidate did detect money** — $56,858.30 true positive at 66.16%
   recall — **with unacceptable false positives ($9,800.00 fabricated) and attribution collapse (12 of
   19 cases unattributable).** It is not a candidate for the reconciliation grain and must not ship as
   one.

**No core change was made before this baseline was recorded.**

---

# Governed benchmark revision · V2 → V3 · the transport defect

**V2 is superseded, not invalidated.** Its monetary truth was correct; its *transport* lost a field, and
the loss corrupted one figure. V1 remains `INVALIDATED FOR DECISION USE` for a different reason, and
both earlier records above stand unedited.

## 1 · The defect

`ground-truth.csv` derived its header from `Object.keys(rows[0])`. Any field present only on a **later**
row was dropped, and one was: `sibling_entitlements` exists on the M20 truth row and in
`planted-register.json`, but never reached the CSV the scorer reads. The scorer therefore could not see
that `syn-ent-0001` belongs to M20, and charged **$89.70** of correctly-detected money — a real 30%
under-bill, $299.00 → $209.30 — as fabricated.

**The worst kind of measurement defect, because it was invisible:** nothing errored, nothing was
malformed, and the corrupted figure looked exactly like a real result.

## 2 · The fix is generic · no special case for M20

`csv(rows)` → `csv(rows, declaredColumns)`:

* the column schema is **required and explicit**; nothing is inferred from any row;
* the writer **throws** on any key not in the schema, so a late field can no longer be lost *silently*
  — it now fails loudly;
* `GROUND_TRUTH_COLUMNS` declares the governed ground-truth schema, `sibling_entitlements` included,
  as a stated artefact rather than a side effect of row order.

## 3 · Proof obligations · all eight discharged

| # | Claim | Evidence |
|---|---|---|
| 1 | expectation export byte-identical | SHA-256 `31992d23…` ✅ |
| 2 | billing export byte-identical | SHA-256 `0ef21e40…` ✅ |
| 3 | ground-truth **semantics** identical | cell-by-cell: **19 rows × 15 pre-existing columns, zero differences**; one column added, none removed ✅ |
| 4 | planted amounts identical | **$85,942.00**, 16 priced, 3 UNKNOWN ✅ |
| 5 | mechanisms identical | 19 names identical, 19 cohort sizes identical ✅ |
| 6 | only the transport changed | `planted-register.json` **unchanged** at `111db9d1…` — the authoritative register never lost the field, which is precisely what makes this a transport defect and not a truth defect ✅ |
| 7 | field survives serialisation **and reload** | re-parsed CSV returns `syn-ent-0001 syn-ent-0002`, **matching the register** ✅ |
| 8 | no other late field can be lost | a field injected on the final row only now raises `field "…" is not in the declared schema — it would have been silently dropped` ✅ |

`ground-truth.csv`: `024f69237bc0521c8d8420eb52a51d3b78389952841a7164588eae1b9ad3c264` →
`0f5558e402912047783d06d171e2cbfa674ab262de660f9832907f99eb71f074`. **The only artefact permitted to
move, and the only one that moved.**

## 4 · The official V3 baseline · post-taint, pre-ambiguity core

Core `831b2dab3767b01aeb7d33e79034712fa5403efe7a5506955d784762be3b6430` — **unmodified in this phase.**

| `A_SUBSCRIPTION` | V2 post-fix | **V3 baseline** | Δ |
|---|---|---|---|
| detected positive | $90,925.40 | $90,925.40 | — |
| **true positive** | $62,356.30 | **$62,446.00** | **+$89.70** |
| **false positive** | $8,969.10 | **$8,879.40** | **−$89.70** |
| …on zero/unknown-truth cases | $8,879.40 | $8,879.40 | — |
| false negative | $3,985.70 | $3,896.00 | −$89.70 |
| monetary recall | 72.56% | **72.66%** | +0.10pp |
| monetary precision | 68.58% | **68.68%** | +0.10pp |
| refusals (unwarranted) | 77 (1) | 77 (1) | — |

**Exactly $89.70 moved, in exactly one direction, and nothing else changed** — which is what a pure
measurement correction should look like. The practical consequence is that **100% of the remaining
false-positive money is now M17**, with no residue to explain away, so the next correction has a clean
target.

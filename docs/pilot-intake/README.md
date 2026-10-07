# Start here

We are looking for revenue that was owed and never billed, or billed for less than it should have been.
To do that honestly we need **two exports from two different systems**, and we need them unaltered.

This folder contains everything you need.

## What to send us

| | Export | Normally comes from | Template |
|---|---|---|---|
| **A** | **What was owed** — one row per expected billing obligation | your contract, CRM or CLM system; sometimes a revenue or order-management module | `expectation_template.csv` |
| **B** | **What was charged** — one row per **invoice line** (not payments) | your billing platform or ERP; sometimes the invoicing module of your finance system | `settlement_template.csv` |

They must come from **different** systems. Asking the billing system what billing should have done cannot
find billing's own omission — if the failure erased an invoice, it may have erased the schedule with it.

**Period:** 6–12 months of history, the same months in both files.

## The one field worth a conversation

**`obligation_ref`** on export B: the identifier your **contract** system issued for an obligation, carried
by billing onto the invoice line that settles it.

It is the join between the two files. In a controlled synthetic experiment it was the single highest-value
field we tested — the only one that increased the money we could claim, and it did so with no fabricated
findings. Without it we fall back on whatever key the two systems happen to share, which a re-key or a
platform migration destroys.

**If billing does not carry it, say so.** That is a true answer we can work with and plan around. A
reference assembled from the payer, the amount, the date or the invoice number is one we cannot detect, and
it would produce confident findings that are wrong.

## How to fill them in

1. Open the two templates. The headers are exactly what we validate — please do not rename, reorder or add.
2. Export straight from the source system to CSV where you can. It avoids the spreadsheet problems in the
   checklist.
3. Look at `expectation_example.csv` and `settlement_example.csv`. Between them they show a normal month,
   an amendment, a pause, an ended entitlement, an obligation nobody can price, a consolidated invoice, a
   credit, and a re-keyed subscription. Those are the cases that usually need a decision.
4. Read `PSEUDONYMIZATION_GUIDE.md` **before** replacing identifiers. The join has to survive it.
5. Work through `PRE_SUBMISSION_CHECKLIST.md`.

## What NOT to change

- Amounts, currencies and timestamps — exactly as recorded.
- Identifiers — your system's own values, nothing composed.
- Blanks — leave them blank. Never `0`, `-`, `N/A` or `NULL`.
- The two files — do not join, match, dedupe or reconcile them for us. We do that, and we need to be able
  to check it.

## What happens next

1. **Readiness.** We report what your data can support and what it cannot — with no money in it. See
   `WHAT_NH_WILL_DO.md`.
2. **If something is missing**, you get the exact fact, the system that owns it, and what it blocks. Often
   it is one column from one team.
3. **Once readiness passes**, we agree the scope of a first retrospective analysis and what a finding will
   and will not claim — before we run it, not after.

## The rest of this folder

| File | What it is |
|---|---|
| `PILOT_DATA_REQUEST_V1.md` | the full request, field by field, with what each one is for |
| `FIELD_DICTIONARY.md` | every field: meaning, owner, format, example, and what breaks without it |
| `PSEUDONYMIZATION_GUIDE.md` | how to anonymise without breaking the join |
| `PRE_SUBMISSION_CHECKLIST.md` | 13 checks before you send |
| `WHAT_NH_WILL_DO.md` | what we may identify, and what we will not claim |
| `*_template.csv` | headers only, ready to fill |
| `*_example.csv` | small fictional examples of the tricky cases |

Questions on any single field are welcome and usually faster than guessing.

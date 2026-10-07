# Pseudonymising identifiers without breaking the analysis

We do not need to know who your customers are. We **do** need the relationships between rows to survive,
because the whole analysis is a join: an obligation in export **A** matched to the settlement in export
**B** that claims to settle it. Pseudonymising carelessly destroys that join silently — the files still
load, and every obligation reads as unbilled.

So: **replace the values, preserve the relationships.**

## The rules

1. **One original value → one pseudonym, everywhere.** If account `A-99` becomes `PAYER-0007` in one
   row, it must be `PAYER-0007` in **every** row of **both** files, for the whole period.

2. **Never re-pseudonymise per file, per batch or per row.** A fresh mapping for the billing export
   guarantees that nothing matches. If the two exports are produced by different teams, agree the mapping
   **once** and share it.

3. **Keep the mapping yourself.** We neither want nor need it. Keep it so you can trace any finding we
   report back to the real account.

4. **Preserve referential relationships.** An amendment that supersedes another line must still point at
   that line's pseudonym. A settlement that settles an obligation must still carry that obligation's
   pseudonym. If a reference points at something that no longer exists after pseudonymisation, the
   relationship was broken, not hidden.

5. **Do not alter monetary values.** Not rounded, not rebased, not scaled, not converted. The amounts are
   the measurement.

6. **Do not alter currencies.** Leave the original code on every row. We hold no exchange rate and will
   never convert — a converted figure is a number we authored.

7. **Do not alter timestamps.** No timezone shifting, no coarsening to month, no re-basing to a reporting
   calendar. Timing is what distinguishes a late invoice from a missing one.

8. **Never derive a missing `obligation_ref`.** If billing does not carry the contract system's obligation
   identifier, **leave the column out** and tell us. A reference assembled from the payer, the amount, the
   date, the invoice number or a row position is one we cannot detect and will trust — and it will produce
   confident findings that are wrong.

9. **Never substitute a zero or a default for a missing fact.** Leave the cell blank. A blank is a fact we
   handle correctly; `0` asserts that nothing was owed.

10. **Avoid direct personal data entirely.** No names, emails, phone numbers or addresses. If an
    identifier you must preserve happens to contain a person's name, pseudonymise it like any other
    identifier — the rules above still apply.

## A worked example

| Original | Pseudonym | Appears in |
|---|---|---|
| `Acme Northern Division (acct 4471)` | `PAYER-NORTH` | both exports, every row for that account |
| `SUB-4471-PREMIUM` | `ENT-1001` | export A |
| `SCHED-LINE-88213` | `SL-7781` | export A, **and** export B's `obligation_ref` |
| `INV-2026-0100045` | `INV-55010` | export B |

The third row is the one that matters: the same original value becomes the same pseudonym in **both**
files, which is what keeps the join intact.

## How to check you got it right

Take any five obligations from export A. For each one, find the settlement in export B whose
`obligation_ref` equals that obligation's `schedule_line_ref`. If you cannot, the mapping diverged —
and the `PRE_SUBMISSION_CHECKLIST` has this as its own line for that reason.

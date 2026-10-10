# Export attestation

One page. It is what lets us say more about your data than *"the columns are the right shape"* —
and it is deliberately short, because a long form gets delegated and a delegated form gets guessed at.

**Please send this with the exports**, so we can read the two together. We are not claiming that
sending them together proves anything about the files — you hold both until they reach us, so a row
count that matches shows the two are consistent and nothing more. It is still worth having: it
catches the ordinary mix-up, and it puts an accountable role against the submission.

## Who is signing

**The role or team inside our organisation that owns these exports is named in the table.**

| | |
|---|---|
| Role or team | |
| Date | |

> Presence only. We ask for a ROLE and not a person — the pilot does not need anyone's name.
> If your process needs a named signatory, that belongs in the contract, not in the data.

## About each export

Fill this in **twice** — once for Export A (expectation / contract) and once for Export B (billing).

| | Export A | Export B |
|---|---|---|
| System it came from | | |
| How it was produced | | |
| Date taken (`YYYY-MM-DD`) | | |
| Window it covers, from | | |
| Window it covers, to | | |
| **Number of rows** | | |

**How it was produced** — one of: `direct_query` · `standard_report_export` · `warehouse_view` · `vendor_api_export` · `other_described`.
If `other_described`, add one line saying what it was. We ask because a warehouse view means a
transformation layer sits between the source system and the file, which changes what we can conclude.

> **What the row count does and does not do.** We compare it against the rows we actually receive.
> If they disagree, something went wrong between the export and us, and we will tell you rather than
> proceeding. If they agree, that shows the two things you sent are consistent with each other — it
> does **not** show the file is complete, because you hold both the file and this form until they
> reach us. We are not going to describe it as more than that.

## What you are confirming

- [ ] Export A was produced from the system named in the table, which is our system of record for contracted obligations.
      *What we do with it:* We check that a system is named and that the extraction method is one of the listed kinds. We cannot check that the file came from it.
- [ ] Export B was produced from the billing or ERP system named in the table.
      *What we do with it:* As above: the name and the method are checked for shape. The origin itself is your assertion.
- [ ] Each export was taken on or after the last day of the window it covers.
      *What we do with it:* Date comparison. An export taken before its window closed cannot be a complete statement for it.
- [ ] Each export contains exactly the number of rows stated in the table, counted at the moment of export.
      *What we do with it:* We count the rows we received and compare them with your number. A match shows the two things you sent us are consistent; it does NOT show the file is complete, because you send us both and could change both. A mismatch is reported as a contradiction.
- [ ] Each export covers the inclusive window stated in the table, and contains no rows anchored outside it.
      *What we do with it:* We check every row's anchor date — the invoice raise date on B, the period start on A — falls inside the declared window. A period that EXTENDS past the window is normal and is not a contradiction.
- [ ] The identifiers in these files are the source systems' own, carried through unchanged except for pseudonymisation.
      *What we do with it:* We check the two sides still share payer identities, and that the obligation join forms. These are necessary evidence and never a proof: a file can pass them and still have been re-keyed.
- [ ] Where `obligation_ref` is supplied, it is the contract system's own obligation identifier as billing received it — not created for this exercise.
      *What we do with it:* We check no reference equals, contains or is contained by another cell on its own row, which is what a composed key looks like. We cannot prove the positive — only rule out the obvious fabrication.
- [ ] If identifiers were pseudonymised, the same real identifier became the same token in BOTH exports.
      *What we do with it:* We check the joins actually form across the two files. Pseudonymising each file independently — the common mistake — produces no overlap at all, and that we would see.

## What you are asserting, and we cannot check

These four matter and we have no way to test them. We record them against the role above
and they **do not raise how far we say your data can be relied on**. Saying so is the point: a form that
implied we had checked these would be collecting a signature against work we never do.

- [ ] No amount, currency or date in these files was estimated, rounded for presentation, back-filled or reconstructed by hand.
      *What we do with it:* NOTHING. We cannot distinguish a real amount from a carefully estimated one. This is your assertion, recorded against the role above, and it does not raise the authority we report.
- [ ] No identifier was replaced by a value derived from an amount, a date or a row position.
      *What we do with it:* NOTHING in general. A pseudonym that happens to encode an amount is indistinguishable from an opaque one.
- [ ] Neither export had rows removed, filtered out or held back after it was taken from the source system.
      *What we do with it:* NOTHING, and this is the one most worth understanding. The declaration and the file arrive together from the same party, so a row count that matches proves only that the two agree. Establishing completeness needs something we do not have: a record of what the source system actually held, made where you could not revise it.
- [ ] These files are the output of the systems named, and were not assembled, merged or edited in a spreadsheet afterwards.
      *What we do with it:* NOTHING. Only a signed export or a fetch NH performs itself could establish this, and neither exists yet.

## What this does and does not buy

**Does:** we can report that your exports were declared and that everything we can check agrees with
the declaration. If a row count or a join disagrees, we tell you rather than proceeding quietly.

**Does not:** it does not make the data independently verified, and we will not describe it that way.
Only a signed export from the source system, or a connection where we read the data ourselves, could
do that — and neither exists yet. **Everything we report stays marked provisional until it does.**

You can send the exports without this form. We will still tell you what they support; we will simply
be able to say less about where they came from.

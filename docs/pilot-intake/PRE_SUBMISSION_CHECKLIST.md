# Before you send · a 13-point check

Ten minutes with this list will save a round trip. Each line is something that has broken a real-world
export somewhere.

- [ ] **Window** — the exports cover the same **6–12 months**, and the same months in both files.
- [ ] **Both files present** — the expectation/contract export **and** the billing/settlement export. One
      file alone cannot be reconciled against anything.
- [ ] **Headers unchanged** — exactly the column names from the templates, spelled and ordered as given.
      Extra columns are refused rather than ignored, so we never claim to have read something we did not.
- [ ] **Stable pseudonyms** — the same original value became the same pseudonym in **both** files, for the
      whole period. Spot-check five obligations end to end.
- [ ] **Source-native identifiers** — every identifier is your system's own value. Nothing composed,
      concatenated, renumbered or generated for this export.
- [ ] **`obligation_ref` provenance** — it carries the identifier the **contract** system issued for the
      obligation, as billing received it. Not billing's subscription key, not the invoice number, and not
      built from the payer, amount, date or row order. If billing does not hold it, **omit the column and
      tell us** — that is a usable answer.
- [ ] **Original amounts** — not rounded, rebased, scaled or aggregated.
- [ ] **Original currencies** — the code each row actually carries. No conversion.
- [ ] **Original timestamps** — `YYYY-MM-DD`, no timezone shifting or coarsening.
- [ ] **Blanks stayed blank** — no `0`, `0.00`, `-`, `N/A` or `NULL` standing in for a fact you do not
      have. This matters most for `expected_amount`.
- [ ] **No estimates or defaults** — nothing filled in to make a column look complete.
- [ ] **No manual joins** — do not merge, match, dedupe or reconcile the two files for us. We perform the
      join ourselves; a join you perform first is one we cannot check.
- [ ] **No spreadsheet damage** — check that a tool has not silently changed anything: leading zeros
      stripped from identifiers, long references turned into scientific notation, dates reformatted to
      local order, or amounts given thousands separators. Exporting straight to CSV from the source system
      avoids all four.

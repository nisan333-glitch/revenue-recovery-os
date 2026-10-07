# Pilot data request · the minimum for a first retrospective money-discovery run

**Generated from the governed definitions** — `scripts/data-readiness/emit-pilot-request.ts`. Do not
edit by hand: a test asserts this document equals a fresh render, so an edit here fails the build
rather than quietly diverging from what the validators actually require.

Contracts: `nh.expectation-extract@1.1.0` and `nh.billing-extract@1.0.0`.

---

## What we are asking for, and why it is two files

Two exports, from **two different systems**:

**A · EXPECTATION / CONTRACT** — what your contract system says was *owed*: one row per expected
billing obligation.

**B · BILLING** — what your billing system says was *charged*: **one row per invoice line**.

### Export B is INVOICES, not payments — please read this before exporting

**What we need:** A CHARGE WAS RAISED — an invoice line issued by the billing system.

**What we do NOT need, and must not receive instead:**

* a payment
* a cash receipt or collection
* a bank or processor clearing event
* a settlement in the payments sense of the word

If your finance team hears "settlement" and reaches for the payments or cash-application system,
that is the wrong file. We want the invoice lines your billing system raised — whether or not anyone
has paid them yet. **An unpaid invoice is exactly as useful to us as a paid one**, because we are
comparing what was *charged* against what was *owed*, not tracking cash.

> **So the two columns that carry it are named for it.** `invoice_raised_at` is
> the date the billing system RAISED the line, as that system holds it. `invoice_line_amount` is
> the amount CHARGED on that line, not an amount received. Neither is a payment field, and we have no payment field:
> if your export has one, leave it out.

They must come from different systems, and that is the whole architecture rather than a preference.
Asking the billing system what billing *should* have done cannot detect billing's own omission,
because the failure that erased an invoice may have erased the schedule with it.

## Scope

| | |
|---|---|
| Period | **6–12 months** of history. Shorter still works; it narrows what can be found. |
| Identifiers | **Pseudonymised**, and *stable across both files and across the whole period*. |
| Personal data | **None.** No names, emails, addresses or contact details. We do not need them and will not use them. |
| Source identifiers | **Preserved as your systems hold them.** Do not re-key, re-number or normalise. |
| Amounts | **Raw**, as recorded. Do not round, convert, aggregate or net credits against charges. |
| Currency | **Original**, per row. We never convert and hold no exchange rate. |
| Timestamps | **Original**, as `YYYY-MM-DD`. Do not shift to a reporting timezone. |
| Format | CSV, one header row, one row per obligation / per invoice line. |

> **The single most important instruction:** if you cannot supply a field, **leave the column out or
> leave the cell blank**. Do not substitute a default, a zero, an estimate or a derived value. A blank
> is a fact we can handle correctly; a fabricated value is one we cannot detect and will trust.

---

## MANDATORY FOR MONEY DISCOVERY

Without these there is no reconciliation unit at all, and the file is refused rather than partially
read.

### A · Expectation / contract export

| Column | Tier | Owned by | What it establishes |
|---|---|---|---|
| `entitlement_ref` | required | Contract / CRM / CLM | WHAT owes money, stably named by the source. |
| `period_start` | required | Contract / CRM / CLM | WHEN the obligation begins — half of the governed period. |
| `period_end` | required | Contract / CRM / CLM | WHEN the obligation ends — the other half of the governed period. |
| `expected_amount` | required | Contract / CRM / CLM | HOW MUCH is owed, where the source can state it authoritatively. |
| `currency` | required | Contract / CRM / CLM | The UNIT of the amount. |

### B · Billing export — invoice lines

| Column | Tier | Owned by | What it establishes |
|---|---|---|---|
| `invoice_ref` | required | Billing / ERP | Which document raised the charge. |
| `invoice_line_ref` | required | Billing / ERP | Which charge on that document this row is. |
| `invoice_raised_at` | required | Billing / ERP | WHEN THE CHARGE WAS RAISED — the invoice-line issue date. Not when money arrived. |
| `invoice_line_amount` | required | Billing / ERP | HOW MUCH WAS CHARGED on this line. Not how much was paid. |
| `currency` | required | Billing / ERP | The unit the amount is denominated in. |
| `payer_ref` | required | Billing / ERP | Who was charged. |

### And two more, which are MANDATORY IN PRACTICE

These two are *formally* optional or conditional — leaving them out refuses no row. But the
cross-system join is **unreachable without either of them**, and that is measured rather than
asserted: with both present our readiness check reaches
**reconcilable, every obligation priced**, and dropping either one takes it down to
**a valid file we cannot reconcile**.

| Column | Export | Formal tier | Who supplies it | Without it |
|---|---|---|---|---|
| `obligation_ref` | B · billing | conditional | Billing / ERP | a valid file we cannot reconcile — no join |
| `schedule_line_ref` | A · expectation | optional | Contract / CRM / CLM | a valid file we cannot reconcile — nothing for the join to resolve against |

They are a **pair**: `obligation_ref` on the billing line names an obligation, and
`schedule_line_ref` on the contract row is the thing it names. Supplying one without the other buys
nothing — every reference would point at an obligation we cannot see. **Please treat both as
required**, even though our validators will accept a file without them.

`obligation_ref` is formally *conditional* — its absence refuses no row — but it is the field the
whole exercise turns on. It must carry **the identifier your CONTRACT system issued for the
obligation**, as billing received it at provisioning. It is **not** billing's internal subscription
key, **not** the invoice number, and **never** a value composed from payer, amount, date or row
order.

In a controlled experiment on **synthetic data** it was the **highest-value field we tested** — the
only one that increased the money we could claim, and it did so with **no fabricated findings**. We
deliberately do not quote the figure here: it came from data we generated, and a number from a
synthetic run would read as a forecast for your book, which it is not. Without this field, real
missing money is held out pending attribution rather than claimed.

**If billing genuinely does not carry it, tell us.** That is a true answer we can work with. A
reference assembled to fill the column is one we cannot detect, and it would produce confident
findings that are wrong.

---

## OPTIONAL / CAPABILITY ENHANCING

Each absence closes exactly **one named capability** and **refuses nothing**. The file stays valid and
still measures money through every capability that remains.

### A · Expectation / contract export

| Column | Tier | Owned by | What it establishes |
|---|---|---|---|
| `payer_ref` | conditional | Contract / CRM / CLM | WHO is billed, so a counterpart on a sibling entitlement can be recognised. |
| `terminated_at` | conditional | Contract / CRM / CLM | The DATED fact that the obligation ceased. |
| `pause_start` | conditional | Contract / CRM / CLM | The DATED start of a suspension. |
| `pause_end` | conditional | Contract / CRM / CLM | The DATED end of the suspension, which bounds it. |
| `supersedes_ref` | conditional | Contract / CRM / CLM | THAT this line replaces that line — lineage, stated rather than guessed. |
| `amended_at` | conditional | Contract / CRM / CLM | WHEN the replacement took effect, which orders the lineage. |
| `schedule_line_ref` | optional | Contract / CRM / CLM | WHICH obligation this row is, distinctly from its siblings. |

### B · Billing export — invoice lines

| Column | Tier | Owned by | What it establishes |
|---|---|---|---|
| `is_credit` | conditional | Billing / ERP | That this line reverses money rather than billing it. |
| `period_start` | conditional | Billing / ERP | What the charge is for, in time. |
| `period_end` | conditional | Billing / ERP | The closing bound of what the charge is for. |
| `legacy_subscription_ref` | optional | Billing / ERP | That two billing identities are the same thing across a migration — stated by billing, not inferred. |
| `source_system` | optional | Billing / ERP | Provenance within the billing estate. |

### What each closed capability costs you

| Capability | If the fact is missing |
|---|---|
| BILLING_OBLIGATION_LINK_AVAILABLE | The cross-system join itself. Without it the two sides can only be matched on a key billing happens to share with the contract system, which a re-key or a migration destroys — and a timing-displacement hypothesis cannot be refuted, so real missing money stays held out pending attribution rather than claimed. |
| CREDIT_DISTINCTION_AVAILABLE | Billed money is overstated, because a credit reads as a charge — which UNDERSTATES exposure. The conservative direction, and still wrong. |
| BILLING_PERIOD_AVAILABLE | The reconciliation unit. An issue date says when the invoice was raised, not what it covers, so a late invoice and a missing one become indistinguishable and no period-level residual exists to compute. |
| MIGRATION_LINEAGE_AVAILABLE | A re-keyed or migrated identity cannot be matched by the weaker fallback route. NOT a substitute for the obligation link: an authoritative obligation reference survives a re-key because it was never billing's internal key. |
| EXPECTED_SETTLEMENT_COUNT_AVAILABLE | EVENT-level proof only. Two lines settling one obligation stay indistinguishable from two instalments of it, so NH reports MULTIPLE SETTLEMENTS OBSERVED and never a duplicate. On the synthetic evidence it unlocks NO additional money. |

## NOT mandatory for money discovery, and we want to be explicit about why

**Expected settlement count** — how many settlement events an obligation expected. It is the only
thing standing between us and *event-level* proof: without it, two lines settling one obligation are
indistinguishable from two instalments of it, so we report **multiple settlements observed** and never
**duplicate**. In the synthetic experiment described above, adding it improved **event-level proof
without increasing monetary coverage** — a result about that experiment, which we do not extend to
your data. So we are not asking for it in the first pilot. Supply it if it is cheap; it is an upgrade,
not a prerequisite.

---

## What we will NOT ask you for

Each of these was considered and deliberately refused. Several are refused *because* supplying them
would let the number be influenced by whoever benefits from it being larger.

| Not requested | On which export | Why |
|---|---|---|
| cadence / billing_frequency | A · expectation | A finite history of past invoices is not an obligation — cancellation, expiry, pause, amendment, a free period and a term simply ending are all normal. Worse, a cadence NH could EXPAND INTO ROWS would make NH the author of the expectation, which is the beneficiary problem one level up. The source enumerates obligations; pattern may corroborate a declared cadence and may never be its source. |
| status (active / churned / ...) | A · expectation | A state label is a free-text lever held by the party who benefits from the number, where a DATED fact is checkable against a period. The observation side already stopped on exactly this: `status` is optional there with an empty enum and no declared meaning. Lifecycle is admitted here only as dated facts. |
| expected_amount_estimated / proration_basis | A · expectation | An estimate is a number NH authored. Where an authoritative amount cannot be established the finding is real and its exposure is UNKNOWN — counted, never zero, never averaged from prior invoices, never taken from a plan price. Estimation would be a separately governed product in the Revenue Opportunity ledger, never on the OBSERVED surface. |
| invoice_ref / allocation | A · expectation | Observation-side facts. Carrying them here would let the expectation side assert what billing did, and the whole point of a second extract is that the expectation originates in a system other than the one that was supposed to act. |
| any composite or NH-derived identity | A · expectation | Explicitly not authorised, and the reason is not merely procedural: every derived key breaks on re-keying and migration, which are the two events most likely to produce a six-figure false finding. |
| a row-grain flag | A · expectation | It would hand grain authority to the beneficiary. An aggregate row stays structurally invisible, stated as a limitation rather than solved by a field the customer controls. |
| expected_amount / amount_due | B · billing | The exact mirror of the expectation extract's stopped `invoice_ref`. It would let the BILLING system assert what was OWED, and the whole architecture rests on the expectation originating in a system other than the one that was supposed to act. Billing stating the expectation is billing auditing itself. |
| is_duplicate / is_erroneous / write_off | B · billing | A beneficiary-controlled flag over which lines count. Whoever wants a larger recovery number marks the inconvenient lines erroneous. Duplication is a CONCLUSION NH must reach from evidence, never a field the customer supplies. |
| settlement_count / expected_attempts | B · billing | Billing cannot state how many settlements an obligation EXPECTED — that is a fact about the contract, not about what billing did. It belongs to the expectation side if anywhere, and is declared here only as the unavailable capability EXPECTED_SETTLEMENT_COUNT_AVAILABLE so the gap has a name and an owner. It upgrades event-level proof and unlocks no additional money on the synthetic evidence. |
| any NH-derived or composite obligation_ref | B · billing | Explicitly not authorised. Never from payer, amount, date, invoice number, subscription id, row position or any composite of them. Every derived key breaks on re-keying and migration — the two events most likely to produce a six-figure false finding — and a reference NH authored is not a fact the source stated. |
| a row-grain flag (line / invoice / aggregate) | B · billing | It would hand grain authority to the beneficiary. An aggregate line stays structurally invisible at obligation grain, stated as a limitation rather than solved by a field the customer controls. |
| payment_status / dunning_state | B · billing | Not stopped on principle — it is the Detector #3 family, approved and deprioritised because it EXPLAINS dollars an existing detector already counts rather than finding new ones. Declaring it here would collect it before any consumer reads it, which is the defect the obligation_ref revert established. |

*(Our own design record also carries conclusions we have since revised on evidence. Those are kept and
marked as superseded rather than rewritten, and they are deliberately not repeated here — a conclusion
we no longer hold has no business instructing you.)*

---

## What we will tell you back, and what we will not

From these two files alone we produce a **readiness report**: how many rows were accepted, which were
rejected and why, which capabilities your data supports, and for each one it does not — **what fact is
missing, which of your systems owns it, and what that blocks**.

**The readiness report contains no money.** Not a recovered figure, not an estimate, not a projection
of how much is blocked. Estimating money before reconciliation has run on your data would be a
forecast presented as a finding, and we keep those apart by construction.

## One limit, stated plainly

A readiness result is **PROVISIONAL**. We can check that your files have the right shape and that
their identifiers are your systems' own; we cannot yet verify that the bytes left those systems
unaltered. Until one of the following exists, readiness is a statement about **shape**, never about
**trustworthiness**:

* **DATA_OWNER_ATTESTATION** — That the customer's data-owning role committed to each export's origin, extraction method, coverage window and ROW COUNT before the result was known, and that every claim NH can check against the files agrees. *(THEY PARTLY CAN, and that is why this channel reaches SOURCE_ATTESTED and never AUTHORITY_VERIFIED. What it does buy is real: a pre-committed row count makes a later trim visible, and a broken cross-file join makes independent pseudonymisation visible. What it cannot buy is the origin of the bytes, because the party that wrote the attestation can revise it and the file together.)*
* **SIGNED_EXPORT** — That these bytes left the named source system unaltered. *(The signature is made by the source system's key, which the party assembling the submission does not hold. Editing a row invalidates it.)*
* **SYSTEM_OF_RECORD_ATTESTATION** — That the system of record ITSELF asserts this extract is its own complete statement for the period. *(The attestation names the period and the row count before the result is known, so a later trim is detectable — the same pre-registration shape the admission bar uses.)*
* **NH_PERFORMED_FETCH** — That NH read the facts from the source system itself rather than receiving a file. *(There is no intermediate step in which a row can be changed.)*
* **THIRD_PARTY_RECONCILIATION** — That a settled amount agrees with an independent record such as a payment processor or bank. *(The third party is not party to the recovery claim.)*

No parameter you send us can raise that. A file cannot vouch for itself, and neither can the party
submitting it — including us.

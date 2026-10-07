# Field dictionary

**Generated from the governed field specifications.** Every column NH validates appears here, and
nothing else does.

Two exports, and the distinction matters more than any single field: **A** is what your contract
system says was *owed*, **B** is what your billing system says was *billed*. They must come from
different systems — asking the billing system what billing should have done cannot find billing's own
omission.

## A · Expectation / contract export

### `entitlement_ref`

| | |
|---|---|
| **Export** | A · expectation |
| **What it means** | Stable identifier of the thing that owes money — the subscription, entitlement or schedule it belongs to. An internal key, never a person. |
| **Business fact it establishes** | WHAT owes money, stably named by the source. |
| **Who normally owns it** | Contract / CRM / CLM |
| **Tier** | **REQUIRED** |
| **May a cell be blank?** | No |
| **Must be your system's own value?** | **Yes** — source-native, never composed by you or by us |
| **Format** | text, as your system holds it |
| **Example** | `ENT-1001` |
| **What is lost without it** | No reconciliation unit can be formed at all, so there is no answer of any kind. |
| **Capability affected** | all of them — this is a required fact |
| **Effect of absence** | **Rejects the row** (or the file, if the column is absent) |

### `period_start`

| | |
|---|---|
| **Export** | A · expectation |
| **What it means** | First day the obligation covers. |
| **Business fact it establishes** | WHEN the obligation begins — half of the governed period. |
| **Who normally owns it** | Contract / CRM / CLM |
| **Tier** | **REQUIRED** |
| **May a cell be blank?** | No |
| **Must be your system's own value?** | n/a |
| **Format** | `YYYY-MM-DD` |
| **Example** | `2026-01-01` |
| **What is lost without it** | NH would have to infer a period boundary, which it never does. |
| **Capability affected** | all of them — this is a required fact |
| **Effect of absence** | **Rejects the row** (or the file, if the column is absent) |

### `period_end`

| | |
|---|---|
| **Export** | A · expectation |
| **What it means** | Last day the obligation covers. |
| **Business fact it establishes** | WHEN the obligation ends — the other half of the governed period. |
| **Who normally owns it** | Contract / CRM / CLM |
| **Tier** | **REQUIRED** |
| **May a cell be blank?** | No |
| **Must be your system's own value?** | n/a |
| **Format** | `YYYY-MM-DD` |
| **Example** | `2026-01-31` |
| **What is lost without it** | Same: a manufactured boundary, and the two sides could not be shown to disagree. |
| **Capability affected** | all of them — this is a required fact |
| **Effect of absence** | **Rejects the row** (or the file, if the column is absent) |

### `expected_amount`

| | |
|---|---|
| **Export** | A · expectation |
| **What it means** | Gross obligated amount for this period, in major units, positive. LEAVE BLANK where the source cannot state it authoritatively — a blank is a declared UNKNOWN, not an error and never a zero. |
| **Business fact it establishes** | HOW MUCH is owed, where the source can state it authoritatively. |
| **Who normally owns it** | Contract / CRM / CLM |
| **Tier** | **REQUIRED** |
| **May a cell be blank?** | **Yes** — a blank is a declared UNKNOWN |
| **Must be your system's own value?** | n/a |
| **Format** | plain decimal, max 2 dp, no symbols or separators |
| **Example** | `2400.00` |
| **What is lost without it** | The entire monetary surface. And a blank silently read as 0 is the UNKNOWN-becomes-zero defect: it would make an unpriced obligation look satisfied. |
| **Capability affected** | all of them — this is a required fact |
| **Effect of absence** | **Rejects the row** (or the file, if the column is absent) |

### `currency`

| | |
|---|---|
| **Export** | A · expectation |
| **What it means** | ISO 4217 code of the expected amount. Never converted. |
| **Business fact it establishes** | The UNIT of the amount. |
| **Who normally owns it** | Contract / CRM / CLM |
| **Tier** | **REQUIRED** |
| **May a cell be blank?** | No |
| **Must be your system's own value?** | n/a |
| **Format** | ISO 4217, three letters |
| **Example** | `USD` |
| **What is lost without it** | Amounts in different currencies would be compared or summed as though equal, and NH holds no governed rate with which to do so honestly. |
| **Capability affected** | all of them — this is a required fact |
| **Effect of absence** | **Rejects the row** (or the file, if the column is absent) |

### `payer_ref`

| | |
|---|---|
| **Export** | A · expectation |
| **What it means** | Stable identifier of the party billed for this entitlement. An internal key, never a person. |
| **Business fact it establishes** | WHO is billed, so a counterpart on a sibling entitlement can be recognised. |
| **Who normally owns it** | Contract / CRM / CLM |
| **Tier** | conditional |
| **May a cell be blank?** | Yes |
| **Must be your system's own value?** | **Yes** — source-native, never composed by you or by us |
| **Format** | text, as your system holds it |
| **Example** | `PAYER-NORTH` |
| **What is lost without it** | A residual whose counterpart sits on a sibling entitlement of the same payer cannot be attributed, so it stays in the headline as unexplained exposure. An attribution loss, not a money error. |
| **Capability affected** | `PAYER_RELATION_AVAILABLE` |
| **Effect of absence** | **Reduces capability only** — nothing is rejected |

### `terminated_at`

| | |
|---|---|
| **Export** | A · expectation |
| **What it means** | Date the entitlement ended. Blank means it has not ended — which is why declaring the column is itself the capability. |
| **Business fact it establishes** | The DATED fact that the obligation ceased. |
| **Who normally owns it** | Contract / CRM / CLM |
| **Tier** | conditional |
| **May a cell be blank?** | Yes |
| **Must be your system's own value?** | n/a |
| **Format** | `YYYY-MM-DD` |
| **Example** | `2026-01-31` |
| **What is lost without it** | A terminated entitlement reads as live and its periods read as unbilled — a false positive. |
| **Capability affected** | `LIFECYCLE_TERMINATION_AVAILABLE` |
| **Effect of absence** | **Reduces capability only** — nothing is rejected |

### `pause_start`

| | |
|---|---|
| **Export** | A · expectation |
| **What it means** | First day of a suspension during which nothing is owed. |
| **Business fact it establishes** | The DATED start of a suspension. |
| **Who normally owns it** | Contract / CRM / CLM |
| **Tier** | conditional |
| **May a cell be blank?** | Yes |
| **Must be your system's own value?** | n/a |
| **Format** | `YYYY-MM-DD` |
| **Example** | `2026-02-01` |
| **What is lost without it** | A paused period reads as unbilled — a false positive. |
| **Capability affected** | `LIFECYCLE_PAUSE_AVAILABLE` |
| **Effect of absence** | **Reduces capability only** — nothing is rejected |

### `pause_end`

| | |
|---|---|
| **Export** | A · expectation |
| **What it means** | Last day of the suspension. Required WITH pause_start — an unbounded pause is refused. |
| **Business fact it establishes** | The DATED end of the suspension, which bounds it. |
| **Who normally owns it** | Contract / CRM / CLM |
| **Tier** | conditional |
| **May a cell be blank?** | Yes |
| **Must be your system's own value?** | n/a |
| **Format** | `YYYY-MM-DD` |
| **Example** | `2026-02-28` |
| **What is lost without it** | An open-ended pause would void every later period — the largest single false NEGATIVE a lifecycle fact can cause. |
| **Capability affected** | `LIFECYCLE_PAUSE_AVAILABLE` |
| **Effect of absence** | **Reduces capability only** — nothing is rejected |

### `supersedes_ref`

| | |
|---|---|
| **Export** | A · expectation |
| **What it means** | The schedule_line_ref this row replaces. Present only on an amendment. |
| **Business fact it establishes** | THAT this line replaces that line — lineage, stated rather than guessed. |
| **Who normally owns it** | Contract / CRM / CLM |
| **Tier** | conditional |
| **May a cell be blank?** | Yes |
| **Must be your system's own value?** | **Yes** — source-native, never composed by you or by us |
| **Format** | text, as your system holds it |
| **Example** | `SL-7783` |
| **What is lost without it** | A superseded obligation reads as still owed alongside its replacement, so one period claims two amounts and the larger is manufactured. |
| **Capability affected** | `AMENDMENT_LINEAGE_AVAILABLE` |
| **Effect of absence** | **Reduces capability only** — nothing is rejected |

### `amended_at`

| | |
|---|---|
| **Export** | A · expectation |
| **What it means** | Date the amendment took effect. Required WITH supersedes_ref. |
| **Business fact it establishes** | WHEN the replacement took effect, which orders the lineage. |
| **Who normally owns it** | Contract / CRM / CLM |
| **Tier** | conditional |
| **May a cell be blank?** | Yes |
| **Must be your system's own value?** | n/a |
| **Format** | `YYYY-MM-DD` |
| **Example** | `2026-02-20` |
| **What is lost without it** | Two lines claim one period with nothing to order them, so NH cannot say which is in force. |
| **Capability affected** | `AMENDMENT_LINEAGE_AVAILABLE` |
| **Effect of absence** | **Reduces capability only** — nothing is rejected |

### `schedule_line_ref`

| | |
|---|---|
| **Export** | A · expectation |
| **What it means** | Per-obligation identity WITHIN this extract. Not a cross-system join key: the two sides identify at different grains and that question is open. |
| **Business fact it establishes** | WHICH obligation this row is, distinctly from its siblings. |
| **Who normally owns it** | Contract / CRM / CLM |
| **Tier** | optional |
| **May a cell be blank?** | Yes |
| **Must be your system's own value?** | **Yes** — source-native, never composed by you or by us |
| **Format** | text, as your system holds it |
| **Example** | `SL-7781` |
| **What is lost without it** | Event reconciliation and correlation cannot run, so the leak class that nets to zero money — a duplicate invoice masking an omission — stays invisible at every monetary grain. |
| **Capability affected** | `EXPECTATION_EVENT_IDENTITY_AVAILABLE` |
| **Effect of absence** | **Reduces capability only** — nothing is rejected |

## B · Billing / settlement export

### `invoice_ref`

| | |
|---|---|
| **Export** | B · settlement |
| **What it means** | The billing system's own identifier for the invoice this line belongs to. |
| **Business fact it establishes** | Which document raised the charge. |
| **Who normally owns it** | Billing / ERP |
| **Tier** | **REQUIRED** |
| **May a cell be blank?** | No |
| **Must be your system's own value?** | **Yes** — source-native, never composed by you or by us |
| **Format** | text, as your system holds it |
| **Example** | `INV-55010` |
| **What is lost without it** | Two lines of one invoice cannot be told from two separate invoices, so a consolidated invoice reads as duplicate billing. |
| **Capability affected** | all of them — this is a required fact |
| **Effect of absence** | **Rejects the row** (or the file, if the column is absent) |

### `invoice_line_ref`

| | |
|---|---|
| **Export** | B · settlement |
| **What it means** | The line's identifier WITHIN its invoice. A position is acceptable here precisely because it is scoped to the invoice and is never used as a cross-system key. |
| **Business fact it establishes** | Which charge on that document this row is. |
| **Who normally owns it** | Billing / ERP |
| **Tier** | **REQUIRED** |
| **May a cell be blank?** | No |
| **Must be your system's own value?** | **Yes** — source-native, never composed by you or by us |
| **Format** | text, as your system holds it |
| **Example** | `1` |
| **What is lost without it** | Two charges on one invoice collapse into one, and a partial settlement reads as a full one. |
| **Capability affected** | all of them — this is a required fact |
| **Effect of absence** | **Rejects the row** (or the file, if the column is absent) |

### `settled_at`

| | |
|---|---|
| **Export** | B · settlement |
| **What it means** | The date the billing system raised or settled this line, as it holds it. |
| **Business fact it establishes** | When the settlement event occurred. |
| **Who normally owns it** | Billing / ERP |
| **Tier** | **REQUIRED** |
| **May a cell be blank?** | No |
| **Must be your system's own value?** | n/a |
| **Format** | `YYYY-MM-DD` |
| **Example** | `2026-01-05` |
| **What is lost without it** | Nothing can be placed inside or outside the period under analysis, so the population is undefined. |
| **Capability affected** | all of them — this is a required fact |
| **Effect of absence** | **Rejects the row** (or the file, if the column is absent) |

### `settled_amount`

| | |
|---|---|
| **Export** | B · settlement |
| **What it means** | The amount of this line in its own currency, as a plain decimal. REQUIRED as a value, not merely as a column — unlike `expected_amount` on the other side. |
| **Business fact it establishes** | How much was billed. |
| **Who normally owns it** | Billing / ERP |
| **Tier** | **REQUIRED** |
| **May a cell be blank?** | No |
| **Must be your system's own value?** | n/a |
| **Format** | plain decimal, max 2 dp, no symbols or separators |
| **Example** | `2400.00` |
| **What is lost without it** | No residual can be computed at all. |
| **Capability affected** | all of them — this is a required fact |
| **Effect of absence** | **Rejects the row** (or the file, if the column is absent) |

### `currency`

| | |
|---|---|
| **Export** | B · settlement |
| **What it means** | ISO 4217 alphabetic code, as the billing system holds it. |
| **Business fact it establishes** | The unit the amount is denominated in. |
| **Who normally owns it** | Billing / ERP |
| **Tier** | **REQUIRED** |
| **May a cell be blank?** | No |
| **Must be your system's own value?** | n/a |
| **Format** | ISO 4217, three letters |
| **Example** | `USD` |
| **What is lost without it** | Amounts in different currencies would be compared as if commensurable. |
| **Capability affected** | all of them — this is a required fact |
| **Effect of absence** | **Rejects the row** (or the file, if the column is absent) |

### `payer_ref`

| | |
|---|---|
| **Export** | B · settlement |
| **What it means** | The account the line was billed to, pseudonymised. |
| **Business fact it establishes** | Who was charged. |
| **Who normally owns it** | Billing / ERP |
| **Tier** | **REQUIRED** |
| **May a cell be blank?** | No |
| **Must be your system's own value?** | **Yes** — source-native, never composed by you or by us |
| **Format** | text, as your system holds it |
| **Example** | `PAYER-NORTH` |
| **What is lost without it** | A misallocation between siblings of one payer cannot be distinguished from missing money. |
| **Capability affected** | all of them — this is a required fact |
| **Effect of absence** | **Rejects the row** (or the file, if the column is absent) |

### `obligation_ref`

| | |
|---|---|
| **Export** | B · settlement |
| **What it means** | The CONTRACT system's obligation identifier, as billing received it at provisioning and carries it onto the settling line. It is the counterpart of the expectation extract's `schedule_line_ref`. It is NOT billing's internal subscription key and NOT the invoice number. |
| **Business fact it establishes** | WHICH OBLIGATION this settlement claims to settle — the cross-system join. |
| **Who normally owns it** | Billing / ERP |
| **Tier** | conditional |
| **May a cell be blank?** | Yes |
| **Must be your system's own value?** | **Yes** — source-native, never composed by you or by us |
| **Format** | text, as your system holds it |
| **Example** | `SL-7781` |
| **What is lost without it** | The join falls back to whatever key billing happens to share with the contract system, which a re-key or a whole-book migration destroys. A timing-displacement hypothesis then cannot be refuted, so real missing money is held out pending attribution rather than claimed — the measured effect, not a predicted one. |
| **Capability affected** | `SETTLEMENT_OBLIGATION_LINK_AVAILABLE` |
| **Effect of absence** | **Reduces capability only** — nothing is rejected |

### `is_credit`

| | |
|---|---|
| **Export** | B · settlement |
| **What it means** | Whether the line is a credit rather than a charge. Declaring the column is itself the capability: a blank then means 'not a credit', which is a fact. |
| **Business fact it establishes** | That this line reverses money rather than billing it. |
| **Who normally owns it** | Billing / ERP |
| **Tier** | conditional |
| **May a cell be blank?** | Yes |
| **Must be your system's own value?** | n/a |
| **Format** | `true` / `false` |
| **Example** | `false` |
| **What is lost without it** | Credits read as settlements, overstating billed money and understating exposure. |
| **Capability affected** | `CREDIT_DISTINCTION_AVAILABLE` |
| **Effect of absence** | **Reduces capability only** — nothing is rejected |

### `period_start`

| | |
|---|---|
| **Export** | B · settlement |
| **What it means** | First day of the service period this line covers — not the date it was issued. |
| **Business fact it establishes** | What the charge is for, in time. |
| **Who normally owns it** | Billing / ERP |
| **Tier** | conditional |
| **May a cell be blank?** | Yes |
| **Must be your system's own value?** | n/a |
| **Format** | `YYYY-MM-DD` |
| **Example** | `2026-01-01` |
| **What is lost without it** | No period-level reconciliation unit exists, and a late settlement is indistinguishable from a missing one. |
| **Capability affected** | `SETTLEMENT_PERIOD_AVAILABLE` |
| **Effect of absence** | **Reduces capability only** — nothing is rejected |

### `period_end`

| | |
|---|---|
| **Export** | B · settlement |
| **What it means** | Last day of the service period this line covers, inclusive. |
| **Business fact it establishes** | The closing bound of what the charge is for. |
| **Who normally owns it** | Billing / ERP |
| **Tier** | conditional |
| **May a cell be blank?** | Yes |
| **Must be your system's own value?** | n/a |
| **Format** | `YYYY-MM-DD` |
| **Example** | `2026-01-31` |
| **What is lost without it** | The unit's bounds are open, so two adjacent periods cannot be told apart. |
| **Capability affected** | `SETTLEMENT_PERIOD_AVAILABLE` |
| **Effect of absence** | **Reduces capability only** — nothing is rejected |

### `legacy_subscription_ref`

| | |
|---|---|
| **Export** | B · settlement |
| **What it means** | The identity this line's subscription carried BEFORE a billing migration, where billing retained one. |
| **Business fact it establishes** | That two billing identities are the same thing across a migration — stated by billing, not inferred. |
| **Who normally owns it** | Billing / ERP |
| **Tier** | optional |
| **May a cell be blank?** | Yes |
| **Must be your system's own value?** | **Yes** — source-native, never composed by you or by us |
| **Format** | text, as your system holds it |
| **Example** | `SUB-OLD-4471` |
| **What is lost without it** | A migrated book reads as unmatched identity unless the obligation link carries it instead. |
| **Capability affected** | `MIGRATION_LINEAGE_AVAILABLE` |
| **Effect of absence** | **Reduces capability only** — nothing is rejected |

### `source_system`

| | |
|---|---|
| **Export** | B · settlement |
| **What it means** | Which billing instance or platform emitted the row, where more than one did. |
| **Business fact it establishes** | Provenance within the billing estate. |
| **Who normally owns it** | Billing / ERP |
| **Tier** | optional |
| **May a cell be blank?** | Yes |
| **Must be your system's own value?** | n/a |
| **Format** | text, as your system holds it |
| **Example** | `BILL-CORE` |
| **What is lost without it** | A migration boundary is invisible, so a re-key cannot be told from a data error. |
| **Capability affected** | `MIGRATION_LINEAGE_AVAILABLE` |
| **Effect of absence** | **Reduces capability only** — nothing is rejected |

## One thing we deliberately do not ask for

**A component breakdown for two obligation lines covering the same period.** If your contract system
legitimately carries two co-existing lines for one entitlement and one month — a base charge and an
overage, say — **tell us, and we will discuss it.** Today NH **refuses to price that unit** rather than
add the two together, because adding them would state an amount neither line claims.

We are not asking you to add a field to unlock it. A flag that declares two lines "separate" would
*increase* the exposure we report, which makes it exactly the kind of fact that must be governed before
it is believed — not invented during a data export.

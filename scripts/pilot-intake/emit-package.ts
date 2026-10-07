// RENDER THE CUSTOMER-FACING PILOT DATA REQUEST FROM THE GOVERNED DEFINITIONS.
//
// It is GENERATED rather than written, and a test asserts the committed document equals a fresh render.
// The reason is the one the $89.70 transport defect taught: a customer-facing artefact derived from a
// governed definition by hand drifts from it silently, and the drift is only visible once someone has
// already acted on the stale version. Here the stale version would be a DATA REQUEST — the customer
// would gather the wrong columns and discover it at reconciliation.
//
// MANDATORY vs OPTIONAL is read from the field TIERS, not from judgement at writing time. One
// consequence is stated rather than smoothed over: `expected settlement count` sits in OPTIONAL,
// because the measured evidence is that it upgrades EVENT-level proof and unlocks no additional money.
import { mkdirSync, writeFileSync } from "node:fs";
import {
  EXPECTATION_EXTRACT_FIELDS, EXPECTATION_EXTRACT_REF, STOPPED_FIELDS,
} from "../../src/contract/expectationExtract";
import {
  SETTLEMENT_CAPABILITIES, SETTLEMENT_EXTRACT_FIELDS, SETTLEMENT_EXTRACT_REF,
  SETTLEMENT_STOPPED_FIELDS,
} from "../../src/contract/settlementExtract";
import { PROVENANCE_CHANNELS } from "../../src/contract/sourceFactAuthority";
import { SETTLEMENT_EVENT_DEFINITION } from "../../src/contract/settlementExtract";
import { CORRECTED_CANDIDATES } from "../../src/contract/expectationExtractCorrections";
import { BASELINE_LEVEL, dependencyFor, type Side } from "./dependency";

/** Readiness levels in the customer's language. The codes are ours; the sentence is theirs. */
const levelLabel = (level: string): string => ({
  L0_NOT_READABLE: "unreadable",
  L1_STRUCTURALLY_VALID: "a valid file we cannot reconcile",
  L2_MONETARY_RECONCILIATION_POSSIBLE: "reconcilable",
  L3_EXACT_MONEY: "reconcilable, every obligation priced",
  L4_EVENT_PROOF: "reconcilable with event-level proof",
}[level] ?? level);

const DIR = "docs/pilot-intake";
const OUT = `${DIR}/PILOT_DATA_REQUEST_V1.md`;

const row = (name: string, tier: string, owner: string, why: string) =>
  `| \`${name}\` | ${tier} | ${owner} | ${why} |`;

const owner = (o: string) => (o === "contract_or_clm" ? "Contract / CRM / CLM" : "Billing / ERP");

/** Expectation fields carry no `owningSourceSystem`; by construction they are the contract system's. */
const eRows = (tier: string) => EXPECTATION_EXTRACT_FIELDS
  .filter((f) => f.tier === tier)
  .map((f) => row(f.name, tier, "Contract / CRM / CLM", f.establishes));

const sRows = (tier: string) => SETTLEMENT_EXTRACT_FIELDS
  .filter((f) => f.tier === tier)
  .map((f) => row(f.name, tier, owner(f.owningSourceSystem), f.establishes));

const lines: string[] = [];
const w = (s = "") => lines.push(s);

w("# Pilot data request · the minimum for a first retrospective money-discovery run");
w();
w("**Generated from the governed definitions** — `scripts/data-readiness/emit-pilot-request.ts`. Do not");
w("edit by hand: a test asserts this document equals a fresh render, so an edit here fails the build");
w("rather than quietly diverging from what the validators actually require.");
w();
w(`Contracts: \`${EXPECTATION_EXTRACT_REF}\` and \`${SETTLEMENT_EXTRACT_REF}\`.`);
w();
w("---");
w();
w("## What we are asking for, and why it is two files");
w();
w("Two exports, from **two different systems**:");
w();
w("**A · EXPECTATION / CONTRACT** — what your contract system says was *owed*: one row per expected");
w("billing obligation.");
w();
w("**B · BILLING** — what your billing system says was *charged*: **one row per invoice line**.");
w();
w("### Export B is INVOICES, not payments — please read this before exporting");
w();
w(`**What we need:** ${SETTLEMENT_EVENT_DEFINITION.theEvent}`);
w();
w("**What we do NOT need, and must not receive instead:**");
w();
SETTLEMENT_EVENT_DEFINITION.isNot.forEach((x) => w(`* ${x}`));
w();
w("If your finance team hears \"settlement\" and reaches for the payments or cash-application system,");
w("that is the wrong file. We want the invoice lines your billing system raised — whether or not anyone");
w("has paid them yet. **An unpaid invoice is exactly as useful to us as a paid one**, because we are");
w("comparing what was *charged* against what was *owed*, not tracking cash.");
w();
w(`> **A note on two of our column names.** ${SETTLEMENT_EVENT_DEFINITION.nameCaveat}`);
w(`> \`settled_at\` is ${SETTLEMENT_EVENT_DEFINITION.dateMeans}, and \`settled_amount\` is`);
w(`> ${SETTLEMENT_EVENT_DEFINITION.amountMeans}. The names are ours and they are misleading; the`);
w("> definitions above are what we validate against.");
w();
w("They must come from different systems, and that is the whole architecture rather than a preference.");
w("Asking the billing system what billing *should* have done cannot detect billing's own omission,");
w("because the failure that erased an invoice may have erased the schedule with it.");
w();
w("## Scope");
w();
w("| | |");
w("|---|---|");
w("| Period | **6–12 months** of history. Shorter still works; it narrows what can be found. |");
w("| Identifiers | **Pseudonymised**, and *stable across both files and across the whole period*. |");
w("| Personal data | **None.** No names, emails, addresses or contact details. We do not need them and will not use them. |");
w("| Source identifiers | **Preserved as your systems hold them.** Do not re-key, re-number or normalise. |");
w("| Amounts | **Raw**, as recorded. Do not round, convert, aggregate or net credits against charges. |");
w("| Currency | **Original**, per row. We never convert and hold no exchange rate. |");
w("| Timestamps | **Original**, as `YYYY-MM-DD`. Do not shift to a reporting timezone. |");
w("| Format | CSV, one header row, one row per obligation / per invoice line. |");
w();
w("> **The single most important instruction:** if you cannot supply a field, **leave the column out or");
w("> leave the cell blank**. Do not substitute a default, a zero, an estimate or a derived value. A blank");
w("> is a fact we can handle correctly; a fabricated value is one we cannot detect and will trust.");
w();
w("---");
w();
w("## MANDATORY FOR MONEY DISCOVERY");
w();
w("Without these there is no reconciliation unit at all, and the file is refused rather than partially");
w("read.");
w();
w("### A · Expectation / contract export");
w();
w("| Column | Tier | Owned by | What it establishes |");
w("|---|---|---|---|");
eRows("required").forEach(w);
w();
w("### B · Billing export — invoice lines");
w();
w("| Column | Tier | Owned by | What it establishes |");
w("|---|---|---|---|");
sRows("required").forEach(w);
w();
w("### And two more, which are MANDATORY IN PRACTICE");
w();
w("These two are *formally* optional or conditional — leaving them out refuses no row. But the");
w("cross-system join is **unreachable without either of them**, and that is measured rather than");
w("asserted: with both present our readiness check reaches");
w(`**${levelLabel(BASELINE_LEVEL)}**, and dropping either one takes it down to`);
w(`**${levelLabel(dependencyFor("obligation_ref", "settlement").levelWithoutColumn)}**.`);
w();
w("| Column | Export | Formal tier | Who supplies it | Without it |");
w("|---|---|---|---|---|");
w(`| \`obligation_ref\` | B · billing | conditional | Billing / ERP | ${levelLabel(dependencyFor("obligation_ref", "settlement").levelWithoutColumn)} — no join |`);
w(`| \`schedule_line_ref\` | A · expectation | optional | Contract / CRM / CLM | ${levelLabel(dependencyFor("schedule_line_ref", "expectation").levelWithoutColumn)} — nothing for the join to resolve against |`);
w();
w("They are a **pair**: `obligation_ref` on the billing line names an obligation, and");
w("`schedule_line_ref` on the contract row is the thing it names. Supplying one without the other buys");
w("nothing — every reference would point at an obligation we cannot see. **Please treat both as");
w("required**, even though our validators will accept a file without them.");
w();
w("`obligation_ref` is formally *conditional* — its absence refuses no row — but it is the field the");
w("whole exercise turns on. It must carry **the identifier your CONTRACT system issued for the");
w("obligation**, as billing received it at provisioning. It is **not** billing's internal subscription");
w("key, **not** the invoice number, and **never** a value composed from payer, amount, date or row");
w("order.");
w();
w("In a controlled experiment on **synthetic data** it was the **highest-value field we tested** — the");
w("only one that increased the money we could claim, and it did so with **no fabricated findings**. We");
w("deliberately do not quote the figure here: it came from data we generated, and a number from a");
w("synthetic run would read as a forecast for your book, which it is not. Without this field, real");
w("missing money is held out pending attribution rather than claimed.");
w();
w("**If billing genuinely does not carry it, tell us.** That is a true answer we can work with. A");
w("reference assembled to fill the column is one we cannot detect, and it would produce confident");
w("findings that are wrong.");
w();
w("---");
w();
w("## OPTIONAL / CAPABILITY ENHANCING");
w();
w("Each absence closes exactly **one named capability** and **refuses nothing**. The file stays valid and");
w("still measures money through every capability that remains.");
w();
w("### A · Expectation / contract export");
w();
w("| Column | Tier | Owned by | What it establishes |");
w("|---|---|---|---|");
eRows("conditional").forEach(w);
eRows("optional").forEach(w);
w();
w("### B · Billing export — invoice lines");
w();
w("| Column | Tier | Owned by | What it establishes |");
w("|---|---|---|---|");
sRows("conditional").filter((r) => !r.startsWith("| `obligation_ref`")).forEach(w);
sRows("optional").forEach(w);
w();
w("### What each closed capability costs you");
w();
w("| Capability | If the fact is missing |");
w("|---|---|");
SETTLEMENT_CAPABILITIES.forEach((c) => w(`| ${c.capability} | ${c.lossWhenClosed} |`));
w();
w("## NOT mandatory for money discovery, and we want to be explicit about why");
w();
w("**Expected settlement count** — how many settlement events an obligation expected. It is the only");
w("thing standing between us and *event-level* proof: without it, two lines settling one obligation are");
w("indistinguishable from two instalments of it, so we report **multiple settlements observed** and never");
w("**duplicate**. In the synthetic experiment described above, adding it improved **event-level proof");
w("without increasing monetary coverage** — a result about that experiment, which we do not extend to");
w("your data. So we are not asking for it in the first pilot. Supply it if it is cheap; it is an upgrade,");
w("not a prerequisite.");
w();
w("---");
w();
w("## What we will NOT ask you for");
w();
w("Each of these was considered and deliberately refused. Several are refused *because* supplying them");
w("would let the number be influenced by whoever benefits from it being larger.");
w();
// EACH REFUSAL NAMES ITS EXPORT, which is a readability fix and not a formality. Three of these entries
// refuse a column on ONE side that we genuinely ask for on the OTHER — `expected_amount` is requested on
// the contract export and refused on the billing export, `invoice_ref` the mirror image. Rendered without
// the side, a customer reads "not requested" three sections after being asked for it and cannot tell
// which of us is confused.
w("| Not requested | On which export | Why |");
w("|---|---|---|");
// SUPERSEDED REASONING IS EXCLUDED, not reworded.
//
// The semantic audit found this table telling a customer that "obligation_ref as a cross-system join
// key" is NOT requested — three sections after the document requests exactly that and calls it the field
// the exercise turns on. The entry is real and is PRESERVED UNCHANGED in `STOPPED_FIELDS`, because it is
// the record of what was concluded and why; it is also SUPERSEDED IN PART, and a superseded conclusion
// may be referenced as history but must never instruct a customer.
//
// So the filter is driven by the append-only erratum rather than by a hand-maintained exclusion list: any
// candidate carrying a correction drops out of the customer-facing table automatically, and a future
// correction needs no change here.
const superseded = new Set(CORRECTED_CANDIDATES);
const current = [
  ...STOPPED_FIELDS.map((x) => ({ ...x, on: "A · expectation" })),
  ...SETTLEMENT_STOPPED_FIELDS.map((x) => ({ ...x, on: "B · billing" })),
].filter((x) => !superseded.has(x.candidate));
current.forEach((x) => w(`| ${x.candidate} | ${x.on} | ${x.why} |`));
w();
w("*(Our own design record also carries conclusions we have since revised on evidence. Those are kept and");
w("marked as superseded rather than rewritten, and they are deliberately not repeated here — a conclusion");
w("we no longer hold has no business instructing you.)*");
w();
w("---");
w();
w("## What we will tell you back, and what we will not");
w();
w("From these two files alone we produce a **readiness report**: how many rows were accepted, which were");
w("rejected and why, which capabilities your data supports, and for each one it does not — **what fact is");
w("missing, which of your systems owns it, and what that blocks**.");
w();
w("**The readiness report contains no money.** Not a recovered figure, not an estimate, not a projection");
w("of how much is blocked. Estimating money before reconciliation has run on your data would be a");
w("forecast presented as a finding, and we keep those apart by construction.");
w();
w("## One limit, stated plainly");
w();
w("A readiness result is **PROVISIONAL**. We can check that your files have the right shape and that");
w("their identifiers are your systems' own; we cannot yet verify that the bytes left those systems");
w("unaltered. Until one of the following exists, readiness is a statement about **shape**, never about");
w("**trustworthiness**:");
w();
PROVENANCE_CHANNELS.forEach((c) => w(`* **${c.channel}** — ${c.whatItWouldEstablish} *(${c.whyTheBeneficiaryCannotAlterIt})*`));
w();
w("No parameter you send us can raise that. A file cannot vouch for itself, and neither can the party");
w("submitting it — including us.");
w();

const text = `${lines.join("\n")}`;
mkdirSync(DIR, { recursive: true });
writeFileSync(OUT, text.endsWith("\n") ? text : `${text}\n`);
process.stdout.write(`  ${OUT} · ${lines.length} lines\n`);

// ── THE REST OF THE PACKAGE ───────────────────────────────────────────────────────────────────────
//
// Everything below is rendered from the SAME governed field arrays, so a column cannot appear in a
// template, a dictionary entry or an example without appearing in the contract that validates it. The
// verifier re-derives all of it and refuses any difference.

import { EXPECTATION_EXTRACT_COLUMNS } from "../../src/contract/expectationExtract";
import { SETTLEMENT_EXTRACT_COLUMNS } from "../../src/contract/settlementExtract";
import { EXPECTATION_EXAMPLE, SETTLEMENT_EXAMPLE } from "./examples";

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const csv = (cols: readonly string[], rows: readonly Readonly<Record<string, string>>[]) =>
  [cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c] ?? "")).join(","))].join("\n");

const write = (name: string, body: string) => {
  const text = body.endsWith("\n") ? body : `${body}\n`;
  writeFileSync(`${DIR}/${name}`, text);
  process.stdout.write(`  ${DIR}/${name} · ${text.split("\n").length - 1} lines\n`);
};

// ── 2-3 · templates · headers only, exact governed order ────────────────────────────────────────
write("expectation_template.csv", EXPECTATION_EXTRACT_COLUMNS.join(","));
write("settlement_template.csv", SETTLEMENT_EXTRACT_COLUMNS.join(","));

// ── 4-5 · examples ──────────────────────────────────────────────────────────────────────────────
write("expectation_example.csv", csv(EXPECTATION_EXTRACT_COLUMNS, EXPECTATION_EXAMPLE));
write("settlement_example.csv", csv(SETTLEMENT_EXTRACT_COLUMNS, SETTLEMENT_EXAMPLE));

// ── 6 · FIELD_DICTIONARY.md ─────────────────────────────────────────────────────────────────────
const FORMAT: Readonly<Record<string, string>> = Object.freeze({
  identifier: "text, as your system holds it",
  date: "`YYYY-MM-DD`",
  money_decimal: "plain decimal, max 2 dp, no symbols or separators",
  currency_code: "ISO 4217, three letters",
  boolean_flag: "`true` / `false`",
});

const firstExample = (rows: readonly Readonly<Record<string, string>>[], col: string): string => {
  const hit = rows.find((r) => (r[col] ?? "") !== "");
  return hit ? `\`${hit[col]}\`` : "*(blank in the example — that is the point)*";
};

// ── THE COLUMN / CELL DISTINCTION, WHICH THE FIRST FORM COLLAPSED ────────────────────────────────
//
// The semantic audit found `expected_amount` documented as "may a cell be blank? YES — blank = UNKNOWN"
// and, three rows below, "effect of absence: REJECTS THE ROW". Both lines came from the same tier, and
// the tier cannot answer both questions: a MISSING COLUMN and a BLANK CELL are different events with
// different consequences, and `expected_amount` is the field where they diverge most.
//
// So neither answer is derived from the tier any more. Both are PROBED — the real validators and the real
// readiness evaluator, run with the column removed and again with every cell blank — and the dictionary
// states what actually happened. `is_credit` turns out to be the mirror case: a blank is HARMLESS there
// (it means "not a credit", which is the declared meaning), while a blank `obligation_ref` forfeits the
// join entirely. One sentence could never have covered all three.
const columnAbsent = (name: string, side: Side): string => {
  const d = dependencyFor(name, side);
  if (d.levelWithoutColumn === "L0_NOT_READABLE") {
    // The real code, per side. A `?` placeholder in a customer-facing document is not a code, and the
    // first form of this line emitted one.
    const code = side === "expectation" ? "NH-EX-1002" : "NH-SX-1002";
    return `**The file cannot be read.** A missing required column is an extract-level fault — \`${code}\` — and no row is processed.`;
  }
  if (d.costsALevel) return `**No row is rejected**, and readiness falls to *${levelLabel(d.levelWithoutColumn)}*.`;
  return "**No row is rejected** and readiness is unaffected.";
};

const cellBlank = (name: string, side: Side, tier: string): string => {
  const d = dependencyFor(name, side);
  if (name === "expected_amount") {
    return `**Permitted, and meaningful.** The row is **ACCEPTED** with its monetary amount recorded as UNKNOWN — never as 0 and never estimated. Readiness reaches *${levelLabel(d.levelWithBlankCells)}*: everything but the exact-money level still holds.`;
  }
  if (tier === "required") return "**Not permitted.** The row is rejected — this is a row-level fault, not a file-level one.";
  if (d.blankCostsALevel) return `**Permitted but costly.** No row is rejected, and readiness falls to *${levelLabel(d.levelWithBlankCells)}* — a blank here forfeits the capability, so a partly-filled column buys nothing.`;
  return "**Permitted and harmless.** A blank is read as the declared default for this field, which is itself a fact.";
};

const mandatoryInPractice = (name: string, side: Side, tier: string): string => {
  const d = dependencyFor(name, side);
  if (tier === "required") return "n/a — it is formally required";
  if (!d.costsALevel) return "No — genuinely optional";
  return `**YES** — without it readiness is only *${levelLabel(d.levelWithoutColumn)}*, so please treat it as required even though our validators accept a file without it`;
};

/**
 * WHO ISSUES THE VALUE, as distinct from who sends us the file.
 *
 * The audit's fourth class. `obligation_ref` arrives in the BILLING export, so billing is who we ask —
 * but the value is the CONTRACT system's identifier, which is the whole point of it. Listing only "owned
 * by: Billing / ERP" invites a billing team to supply their own key, which is precisely the failure the
 * field exists to avoid. Declared rather than inferred, and the verifier asserts no identifier field that
 * names another system in its description is missing from this map.
 */
const VALUE_ISSUED_BY: Readonly<Record<string, string>> = Object.freeze({
  obligation_ref: "**Contract / CRM / CLM** — billing only carries it",
});

const dict: string[] = [];
const d = (s = "") => dict.push(s);
d("# Field dictionary");
d();
d("**Generated from the governed field specifications.** Every column NH validates appears here, and");
d("nothing else does.");
d();
d("Two exports, and the distinction matters more than any single field: **A** is what your contract");
d("system says was *owed*, **B** is what your billing system says was *charged*. They must come from");
d("different systems — asking the billing system what billing should have done cannot find billing's own");
d("omission.");
d();
d(`**Export B records one event only: ${SETTLEMENT_EVENT_DEFINITION.theEvent}** It is not ${SETTLEMENT_EVENT_DEFINITION.isNot.join(", not ")}.`);
d("An unpaid invoice belongs in it exactly as much as a paid one — we compare what was *charged* against");
d("what was *owed*, and we are not tracking cash.");
d();
d(`> ${SETTLEMENT_EVENT_DEFINITION.nameCaveat}`);
d();
for (const [label, cols, fields, rows] of [
  ["A · Expectation / contract export", EXPECTATION_EXTRACT_COLUMNS, EXPECTATION_EXTRACT_FIELDS, EXPECTATION_EXAMPLE],
  ["B · Billing export — invoice lines", SETTLEMENT_EXTRACT_COLUMNS, SETTLEMENT_EXTRACT_FIELDS, SETTLEMENT_EXAMPLE],
] as const) {
  d(`## ${label}`);
  d();
  for (const col of cols) {
    const f = (fields as readonly { name: string }[]).find((x) => x.name === col) as unknown as {
      name: string; tier: string; kind: string; piiClass: string; description: string;
      establishes: string; neededBy: string; withoutIt: string; whenAbsent: string;
      owningSourceSystem?: string;
    };
    const ownerLabel = f.owningSourceSystem === "contract_or_clm" || f.owningSourceSystem === undefined
      ? "Contract / CRM / CLM" : "Billing / ERP";
    d(`### \`${f.name}\``);
    d();
    d(`| | |`);
    d(`|---|---|`);
    d(`| **Export** | ${label.startsWith("A") ? "A · expectation" : "B · billing"} |`);
    d(`| **What it means** | ${f.description} |`);
    if (f.name === "settled_at" || f.name === "settled_amount") {
      // The name leans towards payment timing and the meaning does not. Stated at the field rather than
      // once in a preamble, because a data owner reads the row for the column they are filling in.
      d(`| **⚠ The name is misleading** | ${SETTLEMENT_EVENT_DEFINITION.nameCaveat} This is **${f.name === "settled_at" ? SETTLEMENT_EVENT_DEFINITION.dateMeans : SETTLEMENT_EVENT_DEFINITION.amountMeans}**. |`);
    }
    d(`| **Business fact it establishes** | ${f.establishes} |`);
    const side: Side = label.startsWith("A") ? "expectation" : "settlement";
    d(`| **Who sends it to us** | ${ownerLabel} |`);
    d(`| **Who issues the value** | ${VALUE_ISSUED_BY[f.name] ?? (f.piiClass === "identifier_pseudonymous" ? `${ownerLabel} — its own identifier` : "n/a")} |`);
    d(`| **Formal tier** | ${f.tier === "required" ? "**REQUIRED**" : f.tier === "conditional" ? "conditional" : "optional"} |`);
    d(`| **Mandatory in practice?** | ${mandatoryInPractice(f.name, side, f.tier)} |`);
    d(`| **If the COLUMN is absent** | ${columnAbsent(f.name, side)} |`);
    d(`| **If a CELL is blank** | ${cellBlank(f.name, side, f.tier)} |`);
    d(`| **Must be your system's own value?** | ${f.piiClass === "identifier_pseudonymous" ? "**Yes** — source-native, never composed by you or by us" : "n/a"} |`);
    d(`| **Format** | ${FORMAT[f.kind] ?? "text"} |`);
    d(`| **Example** | ${firstExample(rows, f.name)} |`);
    d(`| **What is lost without it** | ${f.withoutIt} |`);
    d(`| **Capability affected** | ${f.neededBy === "every_unit" || f.neededBy === "every_settlement" ? "all of them — this is a required fact" : `\`${f.neededBy}\``} |`);
    d();
  }
}
d("## One thing we deliberately do not ask for");
d();
d("**A component breakdown for two obligation lines covering the same period.** If your contract system");
d("legitimately carries two co-existing lines for one entitlement and one month — a base charge and an");
d("overage, say — **tell us, and we will discuss it.** Today NH **refuses to price that unit** rather than");
d("add the two together, because adding them would state an amount neither line claims.");
d();
d("We are not asking you to add a field to unlock it. A flag that declares two lines \"separate\" would");
d("*increase* the exposure we report, which makes it exactly the kind of fact that must be governed before");
d("it is believed — not invented during a data export.");
write("FIELD_DICTIONARY.md", dict.join("\n"));

// ── 7 · PSEUDONYMIZATION_GUIDE.md ───────────────────────────────────────────────────────────────
write("PSEUDONYMIZATION_GUIDE.md", `# Pseudonymising identifiers without breaking the analysis

We do not need to know who your customers are. We **do** need the relationships between rows to survive,
because the whole analysis is a join: an obligation in export **A** matched to the settlement in export
**B** that claims to settle it. Pseudonymising carelessly destroys that join silently — the files still
load, and every obligation reads as unbilled.

So: **replace the values, preserve the relationships.**

## The rules

1. **One original value → one pseudonym, everywhere.** If account \`A-99\` becomes \`PAYER-0007\` in one
   row, it must be \`PAYER-0007\` in **every** row of **both** files, for the whole period.

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

8. **Never derive a missing \`obligation_ref\`.** If billing does not carry the contract system's obligation
   identifier, **leave the column out** and tell us. A reference assembled from the payer, the amount, the
   date, the invoice number or a row position is one we cannot detect and will trust — and it will produce
   confident findings that are wrong.

9. **Never substitute a zero or a default for a missing fact.** Leave the cell blank. A blank is a fact we
   handle correctly; \`0\` asserts that nothing was owed.

10. **Avoid direct personal data entirely.** No names, emails, phone numbers or addresses. If an
    identifier you must preserve happens to contain a person's name, pseudonymise it like any other
    identifier — the rules above still apply.

## A worked example

| Original | Pseudonym | Appears in |
|---|---|---|
| \`Acme Northern Division (acct 4471)\` | \`PAYER-NORTH\` | both exports, every row for that account |
| \`SUB-4471-PREMIUM\` | \`ENT-1001\` | export A |
| \`SCHED-LINE-88213\` | \`SL-7781\` | export A, **and** export B's \`obligation_ref\` |
| \`INV-2026-0100045\` | \`INV-55010\` | export B |

The third row is the one that matters: the same original value becomes the same pseudonym in **both**
files, which is what keeps the join intact.

## How to check you got it right

Take any five obligations from export A. For each one, find the settlement in export B whose
\`obligation_ref\` equals that obligation's \`schedule_line_ref\`. If you cannot, the mapping diverged —
and the \`PRE_SUBMISSION_CHECKLIST\` has this as its own line for that reason.
`);

// ── 8 · PRE_SUBMISSION_CHECKLIST.md ─────────────────────────────────────────────────────────────
write("PRE_SUBMISSION_CHECKLIST.md", `# Before you send · a 13-point check

Ten minutes with this list will save a round trip. Each line is something that has broken a real-world
export somewhere.

- [ ] **Window** — the exports cover the same **6–12 months**, and the same months in both files.
- [ ] **Both files present** — the expectation/contract export **and** the billing export (invoice lines). One
      file alone cannot be reconciled against anything.
- [ ] **Headers unchanged** — exactly the column names from the templates, spelled and ordered as given.
      Extra columns are refused rather than ignored, so we never claim to have read something we did not.
- [ ] **Stable pseudonyms** — the same original value became the same pseudonym in **both** files, for the
      whole period. Spot-check five obligations end to end.
- [ ] **Source-native identifiers** — every identifier is your system's own value. Nothing composed,
      concatenated, renumbered or generated for this export.
- [ ] **\`obligation_ref\` provenance** — it carries the identifier the **contract** system issued for the
      obligation, as billing received it. Not billing's subscription key, not the invoice number, and not
      built from the payer, amount, date or row order. If billing does not hold it, **omit the column and
      tell us** — that is a usable answer.
- [ ] **Original amounts** — not rounded, rebased, scaled or aggregated.
- [ ] **Original currencies** — the code each row actually carries. No conversion.
- [ ] **Original timestamps** — \`YYYY-MM-DD\`, no timezone shifting or coarsening.
- [ ] **Blanks stayed blank** — no \`0\`, \`0.00\`, \`-\`, \`N/A\` or \`NULL\` standing in for a fact you do not
      have. This matters most for \`expected_amount\`.
- [ ] **No estimates or defaults** — nothing filled in to make a column look complete.
- [ ] **No manual joins** — do not merge, match, dedupe or reconcile the two files for us. We perform the
      join ourselves; a join you perform first is one we cannot check.
- [ ] **No spreadsheet damage** — check that a tool has not silently changed anything: leading zeros
      stripped from identifiers, long references turned into scientific notation, dates reformatted to
      local order, or amounts given thousands separators. Exporting straight to CSV from the source system
      avoids all four.
`);

// ── 9 · WHAT_NH_WILL_DO.md ──────────────────────────────────────────────────────────────────────
write("WHAT_NH_WILL_DO.md", `# What we will do with these files, and what we will not claim

## First, one question only

Before looking for a single dollar, we check whether your two exports **contain the facts a trustworthy
reconciliation needs**. You get a short readiness report: how many rows were accepted, which were not and
why, which capabilities your data supports, and for each one it does not — **what fact is missing, which of
your systems owns it, and what that blocks**.

**The readiness report contains no money.** Not a recovered figure, not an estimate, not a projection of
how much might be blocked. We would rather tell you what we can and cannot do than put a number in front
of you that we cannot stand behind.

## What we MAY then identify

Where your facts support it, **observed monetary discrepancies** — an obligation your contract system says
was owed with no settlement against it, or settled for less than it states. Observed, and attributable to
a specific obligation.

## What we will NOT claim, initially or on this evidence alone

- **Recovered revenue.** Finding a discrepancy is not collecting it. Money becomes recovered when it
  arrives, measured against a baseline fixed beforehand — and that is a separate exercise with its own
  evidence.
- **Causal attribution.** That a discrepancy exists is one claim; *why* it happened is another, and we
  will not assert the second from these two files.
- **Duplicate billing.** Where two settlements name one obligation, we report **multiple settlements
  observed** and stop there. Two instalments of one obligation look identical to one obligation billed
  twice, and distinguishing them needs a fact neither export carries today.
- **Money where the amount is UNKNOWN.** An obligation your contract system cannot price is reported as
  unpriced and **counted**, never valued at zero and never estimated from past invoices or a plan price.
- **Exact reconciliation where currency or identity is unresolved.** Rows in a currency we have no governed
  rate for, and obligations we cannot match to a settlement, are reported as such rather than folded into a
  total.
- **A priced answer where two obligation lines cover one period.** We refuse that unit rather than add
  them together.

## And one limit about trust itself

A readiness result is **provisional**. We can confirm your files have the right shape and that their
identifiers are your systems' own. We cannot yet confirm that the data left those systems unaltered —
that needs something like a signed export or a system-of-record attestation, which does not exist between
us today.

No setting, flag or parameter you send can change that, and neither can we. A file cannot vouch for
itself, and the party that benefits from a larger number is never the party that gets to certify it.
`);

// ── 10 · README.md ──────────────────────────────────────────────────────────────────────────────
write("README.md", `# Start here

We are looking for revenue that was owed and never billed, or billed for less than it should have been.
To do that honestly we need **two exports from two different systems**, and we need them unaltered.

This folder contains everything you need.

## What to send us

| | Export | Normally comes from | Template |
|---|---|---|---|
| **A** | **What was owed** — one row per expected billing obligation | your contract, CRM or CLM system; sometimes a revenue or order-management module | \`expectation_template.csv\` |
| **B** | **What was charged** — one row per **invoice line** (not payments) | your billing platform or ERP; sometimes the invoicing module of your finance system | \`settlement_template.csv\` |

They must come from **different** systems. Asking the billing system what billing should have done cannot
find billing's own omission — if the failure erased an invoice, it may have erased the schedule with it.

**Period:** 6–12 months of history, the same months in both files.

## The one field worth a conversation

**\`obligation_ref\`** on export B: the identifier your **contract** system issued for an obligation, carried
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
3. Look at \`expectation_example.csv\` and \`settlement_example.csv\`. Between them they show a normal month,
   an amendment, a pause, an ended entitlement, an obligation nobody can price, a consolidated invoice, a
   credit, and a re-keyed subscription. Those are the cases that usually need a decision.
4. Read \`PSEUDONYMIZATION_GUIDE.md\` **before** replacing identifiers. The join has to survive it.
5. Work through \`PRE_SUBMISSION_CHECKLIST.md\`.

## What NOT to change

- Amounts, currencies and timestamps — exactly as recorded.
- Identifiers — your system's own values, nothing composed.
- Blanks — leave them blank. Never \`0\`, \`-\`, \`N/A\` or \`NULL\`.
- The two files — do not join, match, dedupe or reconcile them for us. We do that, and we need to be able
  to check it.

## What happens next

1. **Readiness.** We report what your data can support and what it cannot — with no money in it. See
   \`WHAT_NH_WILL_DO.md\`.
2. **If something is missing**, you get the exact fact, the system that owns it, and what it blocks. Often
   it is one column from one team.
3. **Once readiness passes**, we agree the scope of a first retrospective analysis and what a finding will
   and will not claim — before we run it, not after.

## The rest of this folder

| File | What it is |
|---|---|
| \`PILOT_DATA_REQUEST_V1.md\` | the full request, field by field, with what each one is for |
| \`FIELD_DICTIONARY.md\` | every field: meaning, owner, format, example, and what breaks without it |
| \`PSEUDONYMIZATION_GUIDE.md\` | how to anonymise without breaking the join |
| \`PRE_SUBMISSION_CHECKLIST.md\` | 13 checks before you send |
| \`WHAT_NH_WILL_DO.md\` | what we may identify, and what we will not claim |
| \`*_template.csv\` | headers only, ready to fill |
| \`*_example.csv\` | small fictional examples of the tricky cases |

Questions on any single field are welcome and usually faster than guessing.
`);

process.stdout.write(`\npilot intake package written to ${DIR}\n`);

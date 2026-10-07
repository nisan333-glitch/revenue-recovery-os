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
import { writeFileSync } from "node:fs";
import {
  EXPECTATION_EXTRACT_FIELDS, EXPECTATION_EXTRACT_REF, STOPPED_FIELDS,
} from "../../src/contract/expectationExtract";
import {
  SETTLEMENT_CAPABILITIES, SETTLEMENT_EXTRACT_FIELDS, SETTLEMENT_EXTRACT_REF,
  SETTLEMENT_STOPPED_FIELDS,
} from "../../src/contract/settlementExtract";
import { PROVENANCE_CHANNELS } from "../../src/contract/sourceFactAuthority";

const OUT = "docs/PILOT_DATA_REQUEST_V1.md";

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
w("**B · BILLING / SETTLEMENT** — what your billing system says was *billed*: one row per invoice line.");
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
w("### B · Billing / settlement export");
w();
w("| Column | Tier | Owned by | What it establishes |");
w("|---|---|---|---|");
sRows("required").forEach(w);
w();
w("### And one more, which is mandatory in practice");
w();
w("| Column | Tier | Owned by | What it establishes |");
w("|---|---|---|---|");
SETTLEMENT_EXTRACT_FIELDS.filter((f) => f.name === "obligation_ref").forEach((f) => w(row(f.name, "conditional", owner(f.owningSourceSystem), f.establishes)));
w();
w("`obligation_ref` is formally *conditional* — its absence refuses no row — but it is the field the");
w("whole exercise turns on. It must carry **the identifier your CONTRACT system issued for the");
w("obligation**, as billing received it at provisioning. It is **not** billing's internal subscription");
w("key, **not** the invoice number, and **never** a value composed from payer, amount, date or row");
w("order. Measured on a controlled synthetic experiment, supplying it moved claimable money by");
w("**+32.5%** with **zero** fabricated money; without it, real missing money is held out pending");
w("attribution rather than claimed.");
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
w("### B · Billing / settlement export");
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
w("**duplicate**. On the synthetic evidence it unlocks **no additional money**, so we are not asking for");
w("it in the first pilot. Supply it if it is cheap; it is an upgrade, not a prerequisite.");
w();
w("---");
w();
w("## What we will NOT ask you for");
w();
w("Each of these was considered and deliberately refused. Several are refused *because* supplying them");
w("would let the number be influenced by whoever benefits from it being larger.");
w();
w("| Not requested | Why |");
w("|---|---|");
[...STOPPED_FIELDS, ...SETTLEMENT_STOPPED_FIELDS].forEach((s) => w(`| ${s.candidate} | ${s.why} |`));
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
writeFileSync(OUT, text.endsWith("\n") ? text : `${text}\n`);
process.stdout.write(`wrote ${OUT} · ${lines.length} lines, rendered from the governed field specs\n`);

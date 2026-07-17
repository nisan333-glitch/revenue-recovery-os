# Engineering Register

> **Status:** Living operational asset · **Not part of the Product Constitution.**
> Engineering-Driven items recognized but **not yet justified to build**, each parked with structured
> **overturn triggers** so they are neither built prematurely nor lost. Types:
> - **KI (Known Item):** existence is a *fact* (confirmed defect/gap), deferred on **priority**.
> - **HYP (Hypothesis):** existence or impact is *unproven*, deferred pending **evidence**.
> - **DEF (Deferred candidate):** real option whose incremental value is currently below the bar.
>
> An entry leaves here (→ implemented) only when its trigger fires AND it clears the Constitution's
> milestone bar (clear immediate consumer · materially strengthens a listed quality · non-duplicative ·
> proportional). Customer-evidence-gated items live in `DP_VALIDATION_KIT.md`.

---

## KI-PAIDAMT — `paid_amount` sign/zero validation
- **Type:** KI (confirmed fact) · **Status:** Deferred (low severity) · **Owner:** Founder (nisan333@gmail.com)
- **Date Created:** 2026-07-17 · **Last Reviewed:** 2026-07-17
- **Reason Deferred:** `adapters/saasActivation.ts` reads `paid_amount` via `fromDecimal` with **no
  positivity gate** (unlike `next_invoice_amount`). Error directions are **Trust-safe** — `$0` paid-with-
  date → `PartiallyPaid` (understates); negative → inflates only non-headline `partialOutstanding`. **No
  Observed-Unpaid headline inflation** (closed by `df8ab78`). Low frequency, no immediate consumer.
- **Overturn triggers:**
  - *Triggering evidence:* a real export with negative/zero `paid_amount`, or a readout misled by the understatement / inflated `partialOutstanding`.
  - *Evidence source:* DP CSV / readout session / Friction Log.
  - *Minimum threshold:* ≥1 real occurrence.
  - *Decision reopened:* add a sign/zero gate on `paid_amount` (exclude/ignore a non-positive settled amount with an explicit reason).
  - *Business impact if validated:* Low–moderate (protects readout credibility).
- **Decision:** Do not implement now. · **Final Outcome:** Pending (open).

## H-ENC — Encoding Robustness
- **Type:** HYP · **Status:** Deferred hypothesis · **Owner:** Founder (nisan333@gmail.com)
- **Date Created:** 2026-07-17 · **Last Reviewed:** 2026-07-17
- **Reason Deferred:** No customer evidence · not required for the first DP session · modern exports are
  predominantly UTF-8 · probability/impact to be validated via the Friction Log.
- **Overturn triggers:**
  - *Triggering evidence:* a real non-UTF-8 export with non-ASCII content → mojibake / garbled headers / all-rows-excluded.
  - *Evidence source:* DP session / Friction Log.
  - *Minimum threshold:* ≥1 real occurrence, or recurring across sessions.
  - *Decision reopened:* zero-guess detect-and-reject (`U+0000`/`U+FFFD`) in `parseCsv`; no transcoding.
  - *Business impact if validated:* Moderate (a broken/garbled first session is high-cost).
- **Decision:** Do not implement now. · **Final Outcome:** Pending (open).
- *Preserved design:* `File.text()` always UTF-8-decodes; pure `encodingValidationError(text)` in `parse.ts`, thrown after BOM-strip.

## HYP-LARGECSV — Large-CSV responsiveness
- **Type:** HYP · **Status:** Deferred hypothesis · **Owner:** Founder (nisan333@gmail.com)
- **Date Created:** 2026-07-17 · **Last Reviewed:** 2026-07-17
- **Reason Deferred:** Parse + SHA-256 run on the main thread (10 MB cap). Size-dependent, speculative,
  weak immediate consumer.
- **Overturn triggers:**
  - *Triggering evidence:* a real CSV that janks/freezes the UI during a live session.
  - *Evidence source:* DP session / performance observation.
  - *Minimum threshold:* ≥1 session with noticeably degraded responsiveness.
  - *Decision reopened:* move parse/SHA off the main thread (worker / chunked yield).
  - *Business impact if validated:* Moderate (prevents a frozen tab mid-readout).
- **Decision:** Do not implement now. · **Final Outcome:** Pending (open).

## DEF-GOLDEN — Domain-level golden integration test
- **Type:** DEF · **Status:** Deferred candidate · **Owner:** Founder (nisan333@gmail.com)
- **Date Created:** 2026-07-17 · **Last Reviewed:** 2026-07-17
- **Reason Deferred:** Granular unit tests + the committed E2E smoke already cover the pipeline; a domain
  golden would partly duplicate the smoke and add marginal value with no immediate consumer.
- **Overturn triggers:**
  - *Triggering evidence:* an integration regression escapes unit tests + smoke, or a substantial new pipeline stage lands.
  - *Evidence source:* a real regression incident / code growth.
  - *Minimum threshold:* ≥1 escaped integration regression, or a major new stage.
  - *Decision reopened:* add a multi-scenario domain golden locking the integrated Observed result.
  - *Business impact if validated:* Low–moderate (engineering velocity/safety).
- **Decision:** Do not implement now. · **Final Outcome:** Pending (open).

## DEF-RECWIRE — Assessment-record wiring (needs an internal consumer)
- **Type:** DEF · **Status:** Deferred candidate · **Owner:** Founder (nisan333@gmail.com)
- **Date Created:** 2026-07-17 · **Last Reviewed:** 2026-07-17
- **Reason Deferred:** The tamper-evident record primitive (`src/assessment/record.ts`) exists but has
  **no concrete internal consumer**; wiring it now would be "infra because the foundation exists."
- **Overturn triggers:**
  - *Triggering evidence:* a concrete internal consumer emerges (assessment history/persistence, or an approved Verifiable Attestation milestone).
  - *Evidence source:* product decision / approved customer-facing milestone.
  - *Minimum threshold:* a real consumer exists.
  - *Decision reopened:* wire record build/verify into that consumer.
  - *Business impact if validated:* Depends on the consumer.
- **Decision:** Do not implement now. · **Final Outcome:** Pending (open).
- **Cross-reference:** the Verifiable Attestation decision (this item's primary consumer) is governed by `DP_VALIDATION_KIT.md` §6 + §7. Do not wire until an approved consumer exists.

## DEF-RUNPATH — Run-path build (a DP running their real CSV)
- **Type:** DEF · **Status:** Deferred candidate · **Owner:** Founder (nisan333@gmail.com)
- **Date Created:** 2026-07-17 · **Last Reviewed:** 2026-07-17
- **Reason Deferred:** No qualified DP has reached the CSV-commitment stage, so the run-path is not yet
  the binding constraint. Building any run-path (hosted URL / offline HTML / …) ahead of that is
  build-ahead-of-demand.
- **Governing procedure (NOT duplicated here):** the whether/how decision is the **Run-Path Decision
  Framework** in `DP_VALIDATION_KIT.md` §7 — gated V0 (business) → V0.5 (scope) → V1–V6 (technical).
  **Do not select a model or build until V0 is satisfied.**
- **Decision:** Do not implement now. · **Final Outcome:** Pending (open).

---

_(Add new entries above using the same structure. Customer-evidence-gated items → `DP_VALIDATION_KIT.md`.)_

## Change log
| Version | Date | Change |
|---|---|---|
| 0.1 | 2026-07-17 | Register created; KI-PAIDAMT and H-ENC recorded. |
| 0.2 | 2026-07-17 | Added structured overturn triggers to all entries; added HYP-LARGECSV, DEF-GOLDEN, DEF-RECWIRE. |
| 0.3 | 2026-07-17 | Added DEF-RUNPATH (pointer to DP_VALIDATION_KIT §7); cross-referenced DEF-RECWIRE to the kit's Attestation / run-path decision. No framework duplicated. |

# Engineering Register

> **Status:** Living operational asset · **Not part of the Product Constitution.**
> Engineering-Driven items that are recognized but **not yet justified to build**, parked with an
> explicit review trigger so they are neither built prematurely nor lost. Two kinds:
> - **Known Item (KI):** existence is a *fact* (confirmed defect/gap), deferred on **priority**.
> - **Hypothesis (H):** existence or impact is *unproven*, deferred pending **evidence**.
>
> An entry leaves here (→ implemented) only when its **Next Review Trigger** fires and it clears the
> Constitution's milestone bar. Fields: Status · Owner · Date Created · Last Reviewed · Reason Deferred ·
> Evidence Required · Next Review Trigger · Decision · Final Outcome.

---

## KI-PAIDAMT — `paid_amount` sign/zero validation

- **Status:** Known Item — deferred (low severity; existence is a fact)
- **Owner:** Founder (nisan333@gmail.com)
- **Date Created:** 2026-07-17
- **Last Reviewed:** 2026-07-17
- **Reason Deferred:** Real asymmetry — `adapters/saasActivation.ts` reads `paid_amount` via `fromDecimal`
  with **no positivity gate**, unlike `next_invoice_amount` (which rejects negative/zero). But the error
  directions are **Trust-safe**: a `$0` paid-with-date → `PartiallyPaid` (understates unpaid); a negative
  paid inflates only the non-headline `partialOutstanding`. **No Observed-Unpaid headline inflation** (the
  Trust-critical direction is already closed by the dateless-`paidAmount` fix, `df8ab78`). Low frequency,
  no immediate consumer → does not clear the milestone bar.
- **Evidence Required:** A real Design Partner export carrying a malformed / negative / zero `paid_amount`,
  or a case where the understatement or inflated `partialOutstanding` materially affects a readout.
- **Next Review Trigger:** A real export surfaces a bogus `paid_amount`, or a Friction-Log signal.
- **Decision:** Do not implement now. Record as a known low-severity gap.
- **Final Outcome:** Pending (open).
- **Fix-ready note:** add a sign/zero gate on `paid_amount` in the adapter mirroring `next_invoice_amount`
  (exclude or ignore a non-positive settled amount with an explicit reason). ~a few lines + tests.

---

## H-ENC — Encoding Robustness (deferred hypothesis)

- **Status:** Deferred (Engineering Hypothesis)
- **Owner:** Founder (nisan333@gmail.com)
- **Date Created:** 2026-07-17
- **Last Reviewed:** 2026-07-17
- **Reason Deferred:** No customer evidence · not required for the first DP session · modern export
  pipelines are predominantly UTF-8 · probability and impact should first be validated via the Friction Log.
- **Evidence Required:** A real DP export that is non-UTF-8 WITH non-ASCII content producing mojibake /
  garbled headers / all-rows-excluded — or a recurring Friction-Log signal across sessions.
- **Next Review Trigger:** After several DP sessions, OR immediately if a real customer hits an encoding
  problem.
- **Decision:** Do not implement now. Preserve with the technical design below.
- **Final Outcome:** Pending (open).
- **Preserved design:** `File.text()` always UTF-8-decodes (invalid bytes → `U+FFFD`, UTF-16 → `U+0000`).
  Zero-guess detection: any `U+0000`/`U+FFFD` → reject; no auto-transcoding (charset detection = guessing).
  Smallest impl: pure `encodingValidationError(text)` in `parse.ts`, thrown in `parseCsv` after BOM-strip.

---

_(Add new entries above using the same field set. KI = confirmed fact, deferred on priority; H =
unproven, deferred pending evidence.)_

## Change log
| Version | Date | Change |
|---|---|---|
| 0.1 | 2026-07-17 | Register created; KI-PAIDAMT recorded; H-ENC (Encoding) recorded. |

-- EP-26b · `currency` joins the governed definition.
--
-- WHY IT BELONGS WITH THE OTHER TWO. A row whose currency differs from the policy's is EXCLUDED
-- OUTRIGHT — never converted — so the currency decides which rows count at all, not how a total is
-- displayed. The same file read as USD and read as EUR are two different populations and two different
-- figures. Anything that can change which rows count is part of the definition the figure is measured
-- under, and therefore belongs to the proposer and the approver rather than to the request.
--
-- A SENTINEL, NOT A GUESS, for any row registered before this migration. 'XXX' is ISO 4217's "no
-- currency", and it is deliberately NOT in the supported list: the domain constructor refuses it, so a
-- pre-EP-26b row reads as unusable and is REFUSED rather than silently assessed as dollars. Inventing
-- 'USD' here would be exactly the thing this feature exists to prevent — a definition nobody decided.
-- The table is append-only, so such a row cannot be corrected; a new version must be proposed, which is
-- the intended answer.
ALTER TABLE "pilot_analysis_terms"
    ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'XXX';
ALTER TABLE "pilot_analysis_terms" ALTER COLUMN "currency" DROP DEFAULT;

-- Shape only. WHICH codes are supported is a domain decision (`src/domain/money.ts`) and stays there:
-- duplicating the list in SQL would give two answers that can drift, and the constructor is the one
-- that runs on every read out of this table.
ALTER TABLE "pilot_analysis_terms"
    ADD CONSTRAINT "pilot_analysis_terms_currency_shape" CHECK ("currency" ~ '^[A-Z]{3}$');

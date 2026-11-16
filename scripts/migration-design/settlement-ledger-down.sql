-- G5 · rollback of the settlement ledger.
--
-- A CLEAN DROP IS CORRECT because this migration adds ONE NEW TABLE and alters nothing.
--
-- IT IS ALSO THE MOST DESTRUCTIVE ROLLBACK IN THIS DESIGN SET, and that must be stated plainly rather
-- than discovered. Dropping this table does not merely discard history: it RELEASES EVERY ARRIVAL OF
-- MONEY TO BE COUNTED AGAIN. The uniqueness it holds is the one-arrival-counted-once rule, so the table
-- is not a log of the rule's enforcement, it IS the enforcement. Run it only on a database where no
-- settlement was ever consumed in earnest.
DROP TRIGGER IF EXISTS settlement_consumptions_no_truncate ON "settlement_consumptions";
DROP TRIGGER IF EXISTS settlement_consumptions_no_delete   ON "settlement_consumptions";
DROP TRIGGER IF EXISTS settlement_consumptions_no_update   ON "settlement_consumptions";
DROP TABLE IF EXISTS "settlement_consumptions";
DROP SEQUENCE IF EXISTS "settlement_consumptions_seq";

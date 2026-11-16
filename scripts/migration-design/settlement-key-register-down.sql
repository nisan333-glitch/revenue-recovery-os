-- G2 · rollback of the settlement-key register.
--
-- A CLEAN DROP IS CORRECT HERE AND WOULD NOT BE FOR THE ATTRIBUTION MIGRATION. That one reshaped a
-- primary key over rows that already existed, so its rollback had to REFUSE while a collision existed,
-- because collapsing two rows means choosing which obligation's figure survives. This migration adds
-- two NEW tables and alters nothing, so rolling it back destroys only what it created.
--
-- IT IS STILL DESTRUCTIVE OF GOVERNANCE EVIDENCE. Dropping these tables discards every registration,
-- activation and revocation ever recorded, and no frozen proof can be re-checked against a key whose
-- row no longer exists. Run it only on a database where the register was never used in earnest.
DROP TRIGGER IF EXISTS settlement_key_events_no_truncate ON "settlement_signing_key_events";
DROP TRIGGER IF EXISTS settlement_key_events_no_delete   ON "settlement_signing_key_events";
DROP TRIGGER IF EXISTS settlement_key_events_no_update   ON "settlement_signing_key_events";
DROP TRIGGER IF EXISTS settlement_keys_no_truncate ON "settlement_signing_keys";
DROP TRIGGER IF EXISTS settlement_keys_no_delete   ON "settlement_signing_keys";
DROP TRIGGER IF EXISTS settlement_keys_no_update   ON "settlement_signing_keys";
DROP TABLE IF EXISTS "settlement_signing_key_events";
DROP TABLE IF EXISTS "settlement_signing_keys";
DROP SEQUENCE IF EXISTS "settlement_signing_key_events_seq";

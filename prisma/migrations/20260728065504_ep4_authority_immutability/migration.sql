-- EP-4 · Append-only immutability for the authority ledger.
-- Authority decisions (who authored/approved/verified/flagged/halted a case) are
-- historical facts and must never be overwritten or deleted, even by direct SQL.
CREATE TRIGGER authorityevent_no_update   BEFORE UPDATE   ON "AuthorityEvent" FOR EACH ROW       EXECUTE FUNCTION nh_reject_mutation();
CREATE TRIGGER authorityevent_no_delete   BEFORE DELETE   ON "AuthorityEvent" FOR EACH ROW       EXECUTE FUNCTION nh_reject_mutation();
CREATE TRIGGER authorityevent_no_truncate BEFORE TRUNCATE ON "AuthorityEvent" FOR EACH STATEMENT EXECUTE FUNCTION nh_reject_mutation();

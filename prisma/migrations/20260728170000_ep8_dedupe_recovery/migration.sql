-- EP-8 · Duplicate-count prevention at the persistence layer.
-- Enforces the FROZEN domain rule (src/domain/approval.ts appendApprovedProof; proven by
-- approval.test.ts R2): a recoveryCaseId is one atomic governed claim, counted once — at
-- most ONE proof-chain root per case. Linked revisions set previousProofId and are unaffected.
CREATE UNIQUE INDEX "Proof_one_chain_root_per_case"
  ON "Proof" ("recoveryCaseId")
  WHERE "previousProofId" IS NULL;

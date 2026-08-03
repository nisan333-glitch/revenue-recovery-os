-- EP-8.1 · H1 concurrency backstop against proof-chain forking.
-- Reproduces (and permanently closes) the adversarial probe: two concurrent revision
-- requests against the same original proof both succeeding, producing two rows at the
-- same (chainId, proofVersion). Two complementary constraints:
--
-- 1. UNIQUE(chainId, proofVersion) — the exact invariant effectiveProofs()
--    (src/domain/proof.ts) already assumes: "exactly one record per chain per version."
-- 2. UNIQUE(previousProofId) WHERE previousProofId IS NOT NULL — a proof may be
--    superseded at most once (chain roots, where previousProofId IS NULL, are exempt;
--    Postgres unique indexes already treat NULLs as distinct from one another, but this
--    partial index makes that explicit and matches the linked-revision semantics precisely).

ALTER TABLE "Proof" ADD CONSTRAINT "Proof_chainId_proofVersion_key" UNIQUE ("chainId", "proofVersion");

CREATE UNIQUE INDEX "Proof_previousProofId_single_revision"
  ON "Proof" ("previousProofId")
  WHERE "previousProofId" IS NOT NULL;

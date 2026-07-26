-- CreateTable
CREATE TABLE "Proof" (
    "proofId" TEXT NOT NULL,
    "recoveryCaseId" TEXT NOT NULL,
    "chainId" TEXT NOT NULL,
    "proofVersion" INTEGER NOT NULL,
    "previousProofId" TEXT,
    "status" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "collectedMinor" BIGINT NOT NULL,
    "baselineMinor" BIGINT NOT NULL,
    "revenueReturnedMinor" BIGINT NOT NULL,
    "excludedRecoveryMinor" BIGINT NOT NULL,
    "exclusionStatement" TEXT NOT NULL,
    "recoveryReason" TEXT NOT NULL,
    "attribution" TEXT NOT NULL,
    "evidenceRefs" TEXT[],
    "baselineId" TEXT NOT NULL,
    "baselineMethodId" TEXT NOT NULL,
    "baselineVersion" INTEGER NOT NULL,
    "baselineLockPolicy" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "confidenceMethodologyVersion" TEXT NOT NULL,
    "proofThresholdUsed" DOUBLE PRECISION NOT NULL,
    "confidenceUsed" DOUBLE PRECISION NOT NULL,
    "approvedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL,
    "persistedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Proof_pkey" PRIMARY KEY ("proofId")
);

-- CreateTable
CREATE TABLE "EvidenceRecord" (
    "evidenceId" TEXT NOT NULL,
    "recoveryCaseId" TEXT NOT NULL,
    "proofId" TEXT,
    "ref" TEXT NOT NULL,
    "note" TEXT,
    "persistedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceRecord_pkey" PRIMARY KEY ("evidenceId")
);

-- CreateIndex
CREATE INDEX "Proof_chainId_idx" ON "Proof"("chainId");

-- CreateIndex
CREATE INDEX "Proof_recoveryCaseId_idx" ON "Proof"("recoveryCaseId");

-- CreateIndex
CREATE INDEX "Proof_previousProofId_idx" ON "Proof"("previousProofId");

-- CreateIndex
CREATE INDEX "EvidenceRecord_recoveryCaseId_idx" ON "EvidenceRecord"("recoveryCaseId");

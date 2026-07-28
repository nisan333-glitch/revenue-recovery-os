-- CreateTable
CREATE TABLE "AuthorityEvent" (
    "id" TEXT NOT NULL,
    "recoveryCaseId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthorityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuthorityEvent_recoveryCaseId_idx" ON "AuthorityEvent"("recoveryCaseId");

-- CreateIndex
CREATE INDEX "AuthorityEvent_actorId_idx" ON "AuthorityEvent"("actorId");

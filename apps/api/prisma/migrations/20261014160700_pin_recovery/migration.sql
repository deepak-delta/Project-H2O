-- CreateTable
CREATE TABLE "TotpFactor" (
    "userId" TEXT NOT NULL,
    "secretEnc" TEXT,
    "enabledAt" TIMESTAMP(3),
    "lastUsedStep" INTEGER,
    "pendingSecretEnc" TEXT,
    "pendingExpiresAt" TIMESTAMP(3),
    "pendingFailedAttempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TotpFactor_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "RecoveryCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecoveryCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssistedResetCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "issuedBy" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssistedResetCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PinResetSession" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "userId" TEXT,
    "ip" TEXT NOT NULL,
    "method" TEXT,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "verifiedAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PinResetSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "userId" TEXT,
    "phone" TEXT,
    "ip" TEXT,
    "method" TEXT,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecoveryCode_userId_idx" ON "RecoveryCode"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "RecoveryCode_userId_codeHash_key" ON "RecoveryCode"("userId", "codeHash");

-- CreateIndex
CREATE INDEX "AssistedResetCode_userId_idx" ON "AssistedResetCode"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AssistedResetCode_userId_codeHash_key" ON "AssistedResetCode"("userId", "codeHash");

-- CreateIndex
CREATE UNIQUE INDEX "PinResetSession_tokenHash_key" ON "PinResetSession"("tokenHash");

-- CreateIndex
CREATE INDEX "PinResetSession_userId_idx" ON "PinResetSession"("userId");

-- CreateIndex
CREATE INDEX "PinResetSession_expiresAt_idx" ON "PinResetSession"("expiresAt");

-- CreateIndex
CREATE INDEX "AuthEvent_phone_type_createdAt_idx" ON "AuthEvent"("phone", "type", "createdAt");

-- CreateIndex
CREATE INDEX "AuthEvent_ip_type_createdAt_idx" ON "AuthEvent"("ip", "type", "createdAt");

-- CreateIndex
CREATE INDEX "AuthEvent_userId_createdAt_idx" ON "AuthEvent"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "TotpFactor" ADD CONSTRAINT "TotpFactor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecoveryCode" ADD CONSTRAINT "RecoveryCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistedResetCode" ADD CONSTRAINT "AssistedResetCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PinResetSession" ADD CONSTRAINT "PinResetSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthEvent" ADD CONSTRAINT "AuthEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

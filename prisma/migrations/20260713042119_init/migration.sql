-- CreateEnum
CREATE TYPE "Provider" AS ENUM ('google', 'naver', 'kakao', 'apple', 'manual');

-- CreateEnum
CREATE TYPE "Category" AS ENUM ('social', 'overseas', 'domestic');

-- CreateEnum
CREATE TYPE "RiskTag" AS ENUM ('breach', 'reuse', 'dormant', 'no2fa', 'subscription');

-- CreateEnum
CREATE TYPE "ActionType" AS ENUM ('password_change', 'delete', 'revoke', 'logout_sessions', 'unsubscribe');

-- CreateEnum
CREATE TYPE "CleanupStatus" AS ENUM ('queued', 'in_progress', 'done', 'failed');

-- CreateEnum
CREATE TYPE "AlertType" AS ENUM ('breach', 'score_drop', 'recleanup');

-- CreateEnum
CREATE TYPE "BreachSeverity" AS ENUM ('high', 'mid', 'low');

-- CreateEnum
CREATE TYPE "AccountSource" AS ENUM ('seed', 'user_input', 'oauth_linked');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "category" "Category" NOT NULL,
    "source" "AccountSource" NOT NULL DEFAULT 'user_input',
    "lastUsedAt" TIMESTAMP(3),
    "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "passwordReused" BOOLEAN NOT NULL DEFAULT false,
    "reuseGroupId" TEXT,
    "breached" BOOLEAN NOT NULL DEFAULT false,
    "discovered" BOOLEAN NOT NULL DEFAULT false,
    "riskTags" "RiskTag"[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessLog" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "location" TEXT NOT NULL,
    "device" TEXT NOT NULL,
    "suspicious" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AccessLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CleanupRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "actionType" "ActionType" NOT NULL,
    "deepLink" TEXT,
    "status" "CleanupStatus" NOT NULL DEFAULT 'queued',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "CleanupRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Breach" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT,
    "service" TEXT NOT NULL,
    "breachDate" TIMESTAMP(3) NOT NULL,
    "exposedFields" TEXT[],
    "advice" TEXT NOT NULL,
    "severity" "BreachSeverity" NOT NULL,
    "resolved" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Breach_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "AlertType" NOT NULL,
    "message" TEXT NOT NULL,
    "triggeredAt" TIMESTAMP(3) NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoreSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "coverage" DOUBLE PRECISION NOT NULL,
    "coveredCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScoreSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE INDEX "Account_userId_breached_idx" ON "Account"("userId", "breached");

-- CreateIndex
CREATE INDEX "Account_userId_lastUsedAt_idx" ON "Account"("userId", "lastUsedAt");

-- CreateIndex
CREATE INDEX "Account_userId_category_idx" ON "Account"("userId", "category");

-- CreateIndex
CREATE INDEX "Account_userId_source_idx" ON "Account"("userId", "source");

-- CreateIndex
CREATE INDEX "AccessLog_accountId_timestamp_idx" ON "AccessLog"("accountId", "timestamp");

-- CreateIndex
CREATE INDEX "CleanupRequest_userId_status_idx" ON "CleanupRequest"("userId", "status");

-- CreateIndex
CREATE INDEX "CleanupRequest_accountId_idx" ON "CleanupRequest"("accountId");

-- CreateIndex
CREATE INDEX "Breach_userId_resolved_idx" ON "Breach"("userId", "resolved");

-- CreateIndex
CREATE INDEX "Breach_accountId_idx" ON "Breach"("accountId");

-- CreateIndex
CREATE INDEX "Alert_userId_triggeredAt_idx" ON "Alert"("userId", "triggeredAt");

-- CreateIndex
CREATE INDEX "ScoreSnapshot_userId_createdAt_idx" ON "ScoreSnapshot"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessLog" ADD CONSTRAINT "AccessLog_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CleanupRequest" ADD CONSTRAINT "CleanupRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CleanupRequest" ADD CONSTRAINT "CleanupRequest_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Breach" ADD CONSTRAINT "Breach_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Breach" ADD CONSTRAINT "Breach_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreSnapshot" ADD CONSTRAINT "ScoreSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

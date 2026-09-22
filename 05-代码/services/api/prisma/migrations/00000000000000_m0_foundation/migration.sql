-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Realm" AS ENUM ('staff', 'customer', 'partner', 'service');

-- CreateEnum
CREATE TYPE "AuditResult" AS ENUM ('allow', 'deny', 'info');

-- CreateTable
CREATE TABLE "audit_events" (
    "seq" BIGINT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "actor" TEXT NOT NULL,
    "realm" "Realm" NOT NULL,
    "action" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "result" "AuditResult" NOT NULL,
    "reason" TEXT,
    "subjectRef" TEXT,
    "prevHash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("seq")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" BIGSERIAL NOT NULL,
    "aggregate" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_flags" (
    "key" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'off',
    "doorRef" TEXT,
    "note" TEXT,
    "updatedBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "audit_events_seq_key" ON "audit_events"("seq");

-- CreateIndex
CREATE INDEX "audit_events_at_idx" ON "audit_events"("at");

-- CreateIndex
CREATE INDEX "audit_events_actor_at_idx" ON "audit_events"("actor", "at");

-- CreateIndex
CREATE INDEX "audit_events_resource_idx" ON "audit_events"("resource");

-- CreateIndex
CREATE INDEX "outbox_events_publishedAt_occurredAt_idx" ON "outbox_events"("publishedAt", "occurredAt");

-- CreateIndex
CREATE INDEX "outbox_events_aggregate_aggregateId_idx" ON "outbox_events"("aggregate", "aggregateId");


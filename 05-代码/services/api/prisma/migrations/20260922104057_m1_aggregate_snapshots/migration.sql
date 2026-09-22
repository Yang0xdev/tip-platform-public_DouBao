-- CreateTable
CREATE TABLE "aggregate_snapshots" (
    "kind" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "state" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aggregate_snapshots_pkey" PRIMARY KEY ("kind","aggregate_id","version")
);

-- CreateIndex
CREATE INDEX "aggregate_snapshots_kind_state_idx" ON "aggregate_snapshots"("kind", "state");

-- CreateIndex
CREATE INDEX "aggregate_snapshots_kind_aggregate_id_version_idx" ON "aggregate_snapshots"("kind", "aggregate_id", "version");

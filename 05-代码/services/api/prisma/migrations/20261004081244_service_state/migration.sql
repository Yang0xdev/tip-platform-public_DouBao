-- CreateTable
CREATE TABLE "service_states" (
    "key" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_states_pkey" PRIMARY KEY ("key")
);

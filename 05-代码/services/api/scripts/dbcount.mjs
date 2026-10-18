import { PrismaClient } from "@prisma/client";
const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
console.log("serviceStates", await db.serviceState.count());
console.log("aggregateSnapshots", await db.aggregateSnapshot.count());
console.log("auditEvents", await db.auditEvent.count());
const rows = await db.serviceState.findMany({ select: { key: true } });
console.log("keys:", rows.map(r=>r.key).length);
await db.$disconnect();

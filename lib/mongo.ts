// MongoDB access for the whole app. Like lib/db.ts, only server code imports it.
//
// PostgreSQL is the source of truth. MongoDB holds the per-rule evidence and the
// activity log, so if it is down the app keeps working without them. Callers
// catch the error and show "unavailable"; a Mongo failure never fails a request.
import { MongoClient, type Db } from "mongodb";

// One connection per server process, kept on globalThis because Next.js reloads
// modules on every change in development (same reason as the pool in lib/db.ts).
const cache = globalThis as unknown as { mongoDb?: Promise<Db> };

async function connect(): Promise<Db> {
  const uri = process.env.MONGODB_URI; // from .env.local, never hard-coded
  if (!uri) throw new Error("MONGODB_URI is not set");
  // fail in 2 s instead of the default 30 s, so pages do not hang when Mongo is down
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 2000 });
  await client.connect();
  const db = client.db(process.env.MONGODB_DB);

  // createIndexes does nothing if an index already exists, so this is safe on every start
  await db.collection("violation_evidence").createIndexes([
    { key: { violation_id: 1 }, unique: true },
    { key: { run_id: 1 } },
    { key: { rule_code: 1, severity: 1 } },
  ]);
  await db.collection("audit_log").createIndexes([
    { key: { ts: -1 } },
    { key: { action: 1, ts: -1 } },
  ]);
  return db;
}

export function mongoDb(): Promise<Db> {
  cache.mongoDb ??= connect().catch((err) => {
    cache.mongoDb = undefined; // forget the failure, so the next request tries again
    throw err;
  });
  return cache.mongoDb;
}

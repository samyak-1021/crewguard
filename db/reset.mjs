// Rebuilds the CrewGuard database from the numbered SQL files in this folder.
//   npm run db:reset
// Creates the database if it does not exist, then runs 01_*.sql, 02_*.sql, ...
// in order. Works the same on macOS, Linux and Windows (no psql needed).
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env.local first.");
  process.exit(1);
}

// 1. create the database itself if needed (connect to the default "postgres" db)
const target = new URL(url);
const dbName = target.pathname.slice(1);
const admin = new URL(url);
admin.pathname = "/postgres";
const adminClient = new pg.Client({ connectionString: admin.toString() });
await adminClient.connect();
const { rowCount } = await adminClient.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
if (rowCount === 0) {
  await adminClient.query(`CREATE DATABASE "${dbName}"`);
  console.log(`created database ${dbName}`);
}
await adminClient.end();

// 2. run every numbered .sql file in order
const dir = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(dir).filter((f) => /^\d{2}_.*\.sql$/.test(f)).sort();
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  for (const file of files) {
    await client.query(readFileSync(join(dir, file), "utf8"));
    console.log(`ran ${file}`);
  }
} catch (err) {
  console.error(`failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}

// 3. empty the MongoDB collections too. Violation ids restart at 1, so old evidence
// would otherwise describe the wrong violations. PostgreSQL is the source of truth,
// so a reset still succeeds if MongoDB is not running.
if (process.env.MONGODB_URI) {
  const mongo = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 2000 });
  try {
    const db = mongo.db(process.env.MONGODB_DB);
    await db.collection("violation_evidence").deleteMany({});
    await db.collection("audit_log").deleteMany({});
    console.log("cleared mongodb collections");
  } catch (err) {
    console.warn(`mongodb not cleared: ${err.message}`);
  } finally {
    await mongo.close();
  }
}

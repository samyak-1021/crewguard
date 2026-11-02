// MongoDB test: one aggregation pipeline against a temporary collection, which is
// dropped afterwards. Skipped, not failed, when MongoDB is not running, because the
// app itself is designed to keep working without it.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { MongoClient } from "mongodb";

const client = new MongoClient(process.env.MONGODB_URI ?? "mongodb://localhost:27017", {
  serverSelectionTimeoutMS: 2000,
});
const name = `test_evidence_${process.pid}`;
let db = null;

before(async () => {
  try {
    await client.connect();
    db = client.db(process.env.MONGODB_DB);
  } catch {
    db = null;
  }
});

after(async () => {
  if (db) await db.collection(name).drop().catch(() => {});
  await client.close();
});

test("MONGODB: $group counts documents per rule, $match + $avg reads a rule-specific field", async (t) => {
  if (!db) return t.skip("MongoDB is not running");
  const col = db.collection(name);
  await col.insertMany([
    { rule_code: "RST", evidence: { rest_hours: 0.25 } },
    { rule_code: "RST", evidence: { rest_hours: 9.83 } },
    { rule_code: "WDH", evidence: { total_hours: 66 } },
    { rule_code: "WDH", evidence: { total_hours: 70 } },
  ]);

  const byRule = await col
    .aggregate([{ $group: { _id: "$rule_code", count: { $sum: 1 } } }, { $sort: { _id: 1 } }])
    .toArray();
  assert.deepEqual(byRule, [{ _id: "RST", count: 2 }, { _id: "WDH", count: 2 }]);

  const [avg] = await col
    .aggregate([{ $match: { rule_code: "WDH" } }, { $group: { _id: null, hours: { $avg: "$evidence.total_hours" } } }])
    .toArray();
  assert.equal(avg.hours, 68);
});

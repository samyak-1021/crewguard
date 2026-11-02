// MongoDB aggregation pipelines for the dashboard, the activity log query, and one
// SQL panel so both databases can be seen side by side. A pipeline passes documents
// through stages in order: $match filters, $group aggregates, $sort and $limit trim.
import type { Document } from "mongodb";
import { query } from "@/lib/db";
import { mongoDb } from "@/lib/mongo";

export type Count = { _id: string | number; count: number };
export type CrewCount = { _id: number; name: string; count: number };

export type Analytics = {
  byRule: Count[];
  bySeverity: Count[];
  topCrew: CrewCount[];
  perRun: Count[];
  auditPerDay: Count[];
  wdh: { avg_hours: number; count: number } | null;
};

const run = <T extends Document>(collection: string, pipeline: Document[]) =>
  mongoDb().then((db) => db.collection(collection).aggregate<T>(pipeline).toArray());

const evidence = <T extends Document>(pipeline: Document[]) => run<T>("violation_evidence", pipeline);

// Everything on the dashboard that comes from MongoDB, or null if it is down.
export async function getAnalytics(): Promise<Analytics | null> {
  try {
    const [byRule, bySeverity, topCrew, wdh, perRun, auditPerDay] = await Promise.all([
      // violations per rule
      evidence<Count>([
        { $group: { _id: "$rule_code", count: { $sum: 1 } } },
        { $sort: { count: -1, _id: 1 } },
      ]),
      // violations per severity
      evidence<Count>([
        { $group: { _id: "$severity", count: { $sum: 1 } } },
        { $sort: { count: -1, _id: 1 } },
      ]),
      // the five crew members with the most violations
      evidence<CrewCount>([
        { $group: { _id: "$crew.crew_id", name: { $first: "$crew.name" }, count: { $sum: 1 } } },
        { $sort: { count: -1, name: 1 } },
        { $limit: 5 },
      ]),
      // average total hours across the WDH breaches: a field only WDH documents have
      evidence<{ avg_hours: number; count: number }>([
        { $match: { rule_code: "WDH" } },
        { $group: { _id: null, avg_hours: { $avg: "$evidence.total_hours" }, count: { $sum: 1 } } },
      ]),
      // violations per run, latest ten
      evidence<Count>([
        { $group: { _id: "$run_id", count: { $sum: 1 } } },
        { $sort: { _id: -1 } },
        { $limit: 10 },
      ]),
      // logged actions per day, latest fourteen days
      run<Count>("audit_log", [
        { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$ts" } }, count: { $sum: 1 } } },
        { $sort: { _id: -1 } },
        { $limit: 14 },
      ]),
    ]);
    return { byRule, bySeverity, topCrew, wdh: wdh[0] ?? null, perRun, auditPerDay: auditPerDay.reverse() };
  } catch (err) {
    console.warn("analytics not read:", (err as Error).message);
    return null;
  }
}

export type AuditEntry = {
  _id: { toHexString(): string };
  ts: Date;
  user: { id: number; username: string; role: string };
  action: string;
  entity: { type: string; id: number };
  details: Record<string, unknown>;
};

export type AuditFilters = { action?: string; username?: string };

// Newest 100 log entries, or null if MongoDB is down.
export async function listAudit(f: AuditFilters): Promise<AuditEntry[] | null> {
  const filter: Document = {};
  if (f.action) filter.action = f.action;
  if (f.username) filter["user.username"] = f.username;
  try {
    const db = await mongoDb();
    return await db.collection("audit_log").find<AuditEntry>(filter).sort({ ts: -1 }).limit(100).toArray();
  } catch (err) {
    console.warn("activity log not read:", (err as Error).message);
    return null;
  }
}

// Choices for the activity log's user filter.
export async function listUsernames() {
  const rows = await query<{ username: string }>("SELECT username FROM app_user ORDER BY username");
  return rows.map((r) => r.username);
}

// The same count per rule, computed in SQL on the source of truth.
export function getViolationsByRuleSql() {
  return query<{ rule_code: string; rule_name: string; violations: number; open: number }>(`
    SELECT r.rule_code, r.rule_name,
           COUNT(v.violation_id)                                      AS violations,
           COUNT(v.violation_id) FILTER (WHERE v.review_status = 'OPEN') AS open
    FROM rule_definition r
    LEFT JOIN violation v ON v.rule_code = r.rule_code
    GROUP BY r.rule_code
    ORDER BY violations DESC, r.rule_code`);
}

// Stat cards. Several scalar sub-queries in one round trip, as on the Overview page.
export async function getComplianceStats() {
  const rows = await query<{ total: number; open: number; resolved: number; runs: number }>(`
    SELECT (SELECT COUNT(*) FROM violation)                                  AS total,
           (SELECT COUNT(*) FROM violation WHERE review_status = 'OPEN')     AS open,
           (SELECT COUNT(*) FROM violation WHERE review_status = 'RESOLVED') AS resolved,
           (SELECT COUNT(*) FROM validation_run)                             AS runs`);
  return rows[0];
}

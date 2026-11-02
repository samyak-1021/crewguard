// SQL for validation runs.
import { query, withTransaction } from "@/lib/db";

export type RunRow = {
  run_id: number; period_start: Date; period_end: Date; started_at: Date; finished_at: Date | null;
  status: string; violations_found: number; triggered_by_name: string | null; duration_ms: number | null;
};

// LEFT JOIN: triggered_by becomes NULL if the auditor's account is ever removed.
const RUN_SELECT = `
  SELECT vr.run_id, vr.period_start, vr.period_end, vr.started_at, vr.finished_at, vr.status,
         vr.violations_found, u.username AS triggered_by_name,
         ROUND(EXTRACT(EPOCH FROM (vr.finished_at - vr.started_at)) * 1000) AS duration_ms
  FROM validation_run vr
  LEFT JOIN app_user u ON u.user_id = vr.triggered_by`;

export function listRuns() {
  return query<RunRow>(`${RUN_SELECT} ORDER BY vr.run_id DESC`);
}

export async function getRun(id: number) {
  const rows = await query<RunRow>(`${RUN_SELECT} WHERE vr.run_id = $1`, [id]);
  return rows[0] ?? null;
}

// Violations per rule in one run. LEFT JOIN keeps rules with nothing to report.
export function getRunRuleCounts(id: number) {
  return query<{ rule_code: string; rule_name: string; violations: number }>(
    `SELECT r.rule_code, r.rule_name, COUNT(v.violation_id) AS violations
     FROM rule_definition r
     LEFT JOIN violation v ON v.rule_code = r.rule_code AND v.run_id = $1
     GROUP BY r.rule_code
     ORDER BY r.rule_code`,
    [id],
  );
}

// TRANSACTION: the procedure writes the run, its violations and their duty links.
// It either all commits or, if anything fails, none of it is left behind.
export function runValidation(userId: number, periodStart: unknown, periodEnd: unknown) {
  return withTransaction(async (client) => {
    const { rows } = await client.query<{ p_run_id: number }>(
      "CALL sp_run_validation($1, $2, $3, NULL)",
      [userId, periodStart, periodEnd],
    );
    return rows[0].p_run_id;
  });
}

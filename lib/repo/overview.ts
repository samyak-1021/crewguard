// SQL behind the Overview page.
import { query } from "@/lib/db";

export async function getStats() {
  // Several scalar sub-queries in one round trip.
  const rows = await query<{
    active_crew: number; flights: number; duties: number; duty_hours: number;
    period_start: Date | null; period_end: Date | null;
  }>(`
    SELECT (SELECT COUNT(*) FROM crew_member WHERE is_active)            AS active_crew,
           (SELECT COUNT(*) FROM flight)                                  AS flights,
           (SELECT COUNT(*) FROM duty_assignment)                         AS duties,
           (SELECT COALESCE(SUM(duty_hours), 0) FROM v_duty_roster)       AS duty_hours,
           (SELECT MIN(sched_dep_utc) FROM flight)                        AS period_start,
           (SELECT MAX(sched_arr_utc) FROM flight)                        AS period_end`);
  return rows[0];
}

// Pilots whose CURRENT rating for a type is expired or expiring.
// The NOT EXISTS sub-query drops certificates that have since been renewed
// (a newer certificate exists for the same crew member and aircraft type).
export function getCertAlerts() {
  return query<{
    crew_id: number; crew_name: string; employee_code: string; type_code: string;
    expires_on: Date; status: string;
  }>(`
    SELECT cm.crew_id, cm.first_name || ' ' || cm.last_name AS crew_name, cm.employee_code,
           c.type_code, c.expires_on, fn_cert_status(c.expires_on) AS status
    FROM certification c
    JOIN crew_member cm ON cm.crew_id = c.crew_id
    WHERE cm.is_active
      AND fn_cert_status(c.expires_on) <> 'VALID'
      AND NOT EXISTS (SELECT 1 FROM certification newer
                      WHERE newer.crew_id   = c.crew_id
                        AND newer.type_code = c.type_code
                        AND newer.issued_on > c.issued_on)
    ORDER BY c.expires_on`);
}

// Busiest crew by total rostered hours.
export function getWorkload(limit = 6) {
  return query<{ crew_id: number; crew_name: string; crew_role: string; duty_count: number; total_duty_hours: number }>(
    `SELECT crew_id, crew_name, crew_role, duty_count, total_duty_hours
     FROM v_crew_summary
     WHERE duty_count > 0
     ORDER BY total_duty_hours DESC
     LIMIT $1`,
    [limit],
  );
}

// Number of duties starting on each day (GROUP BY on a date expression).
export function getDutiesPerDay() {
  return query<{ day: Date; duties: number; crew: number }>(`
    SELECT duty_start_utc::date            AS day,
           COUNT(*)                        AS duties,
           COUNT(DISTINCT crew_id)         AS crew
    FROM duty_assignment
    GROUP BY duty_start_utc::date
    ORDER BY day`);
}

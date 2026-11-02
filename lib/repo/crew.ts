// SQL for crew members and their certifications.
import { query } from "@/lib/db";

export type CrewSummary = {
  crew_id: number; employee_code: string; first_name: string; last_name: string; crew_name: string;
  crew_role: string; home_base: string; hire_date: Date; is_active: boolean;
  duty_count: number; total_duty_hours: number; last_duty_end: Date | null; valid_certs: number;
};

export type CrewFilters = { q?: string; role?: string; base?: string; status?: string };

// Search + filter. The WHERE clause is built from whichever filters are set,
// but every value still goes in as a $n parameter, never pasted into the SQL.
export function listCrew(f: CrewFilters) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.q) {
    params.push(`%${f.q}%`);
    where.push(`(crew_name ILIKE $${params.length} OR employee_code ILIKE $${params.length})`);
  }
  if (f.role) {
    params.push(f.role);
    where.push(`crew_role = $${params.length}`);
  }
  if (f.base) {
    params.push(f.base);
    where.push(`home_base = $${params.length}`);
  }
  if (f.status === "active") where.push("is_active");
  if (f.status === "inactive") where.push("NOT is_active");

  return query<CrewSummary>(
    `SELECT * FROM v_crew_summary
     ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY crew_role, last_name, first_name`,
    params,
  );
}

export async function getCrew(id: number) {
  const rows = await query<CrewSummary>("SELECT * FROM v_crew_summary WHERE crew_id = $1", [id]);
  return rows[0] ?? null;
}

// All certificates of one crew member. `is_current` marks the newest
// certificate per aircraft type (window function ROW_NUMBER).
export function getCertifications(crewId: number) {
  return query<{
    cert_id: number; type_code: string; issued_on: Date; expires_on: Date; status: string; is_current: boolean;
  }>(
    `SELECT cert_id, type_code, issued_on, expires_on,
            fn_cert_status(expires_on) AS status,
            ROW_NUMBER() OVER (PARTITION BY type_code ORDER BY issued_on DESC) = 1 AS is_current
     FROM certification
     WHERE crew_id = $1
     ORDER BY type_code, issued_on DESC`,
    [crewId],
  );
}

// The crew member's duties, from the table-valued function.
export function getCrewRoster(crewId: number) {
  return query<{
    assignment_id: number; flight_id: number; flight_number: string; type_code: string; sector: string;
    assigned_role: string; duty_start_utc: Date; duty_end_utc: Date; duty_hours: number;
  }>("SELECT * FROM fn_crew_roster($1)", [crewId]);
}

// Duty hours per calendar week (Mon–Sun) over the roster period.
// generate_series makes one row per week; fn_crew_duty_hours sums each.
export function getWeeklyHours(crewId: number) {
  return query<{ week_start: Date; hours: number }>(
    `SELECT wk::date AS week_start,
            fn_crew_duty_hours($1, wk, wk + INTERVAL '7 days') AS hours
     FROM generate_series(
            (SELECT date_trunc('week', MIN(sched_dep_utc)) FROM flight),
            (SELECT date_trunc('week', MAX(sched_dep_utc)) FROM flight),
            INTERVAL '7 days') AS wk
     ORDER BY wk`,
    [crewId],
  );
}

// ---------- writes ----------

export async function createCrew(d: Record<string, unknown>) {
  const rows = await query<{ crew_id: number }>(
    `INSERT INTO crew_member (employee_code, first_name, last_name, crew_role, home_base, hire_date)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING crew_id`,
    [d.employee_code, d.first_name, d.last_name, d.crew_role, d.home_base, d.hire_date],
  );
  return rows[0].crew_id;
}

export async function updateCrew(id: number, d: Record<string, unknown>) {
  const rows = await query<{ crew_id: number }>(
    `UPDATE crew_member
     SET first_name = $2, last_name = $3, home_base = $4, is_active = $5
     WHERE crew_id = $1
     RETURNING crew_id`,
    [id, d.first_name, d.last_name, d.home_base, d.is_active === "true"],
  );
  return rows.length > 0;
}

// ON DELETE CASCADE removes the crew member's certificates and duties too.
export async function deleteCrew(id: number) {
  const rows = await query("DELETE FROM crew_member WHERE crew_id = $1 RETURNING crew_id", [id]);
  return rows.length > 0;
}

export async function addCertification(crewId: number, d: Record<string, unknown>) {
  const rows = await query<{ cert_id: number }>(
    `INSERT INTO certification (crew_id, type_code, issued_on, expires_on)
     VALUES ($1, $2, $3, $4)
     RETURNING cert_id`,
    [crewId, d.type_code, d.issued_on, d.expires_on],
  );
  return rows[0].cert_id;
}

export async function deleteCertification(certId: number) {
  const rows = await query("DELETE FROM certification WHERE cert_id = $1 RETURNING cert_id", [certId]);
  return rows.length > 0;
}

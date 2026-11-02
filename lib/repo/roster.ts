// SQL for the duty roster page (reads the v_duty_roster view).
import { query } from "@/lib/db";

export type RosterRow = {
  assignment_id: number; crew_id: number; employee_code: string; crew_name: string; home_base: string;
  assigned_role: string; flight_id: number; flight_number: string; type_code: string;
  dep_airport: string; arr_airport: string; duty_start_utc: Date; duty_end_utc: Date; duty_hours: number;
};

export type RosterFilters = { from?: string; to?: string; role?: string; q?: string };

export function listRoster(f: RosterFilters) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.from) {
    params.push(f.from);
    where.push(`duty_start_utc >= $${params.length}::date`);
  }
  if (f.to) {
    params.push(f.to);
    where.push(`duty_start_utc < $${params.length}::date + 1`); // "to" day is inclusive
  }
  if (f.role) {
    params.push(f.role);
    where.push(`assigned_role = $${params.length}`);
  }
  if (f.q) {
    params.push(`%${f.q}%`);
    where.push(`(crew_name ILIKE $${params.length} OR employee_code ILIKE $${params.length} OR flight_number ILIKE $${params.length})`);
  }
  return query<RosterRow>(
    `SELECT assignment_id, crew_id, employee_code, crew_name, home_base, assigned_role,
            flight_id, flight_number, type_code, dep_airport, arr_airport,
            duty_start_utc, duty_end_utc, duty_hours
     FROM v_duty_roster
     ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY duty_start_utc, flight_number, assigned_role`,
    params,
  );
}

export async function deleteDuty(id: number) {
  const rows = await query("DELETE FROM duty_assignment WHERE assignment_id = $1 RETURNING assignment_id", [id]);
  return rows.length > 0;
}

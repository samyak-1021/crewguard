// SQL for flights and assigning crew to them.
import { query, withTransaction } from "@/lib/db";

export type FlightRow = {
  flight_id: number; flight_number: string; type_code: string; dep_airport: string; arr_airport: string;
  sched_dep_utc: Date; sched_arr_utc: Date; block_hours: number; crew_count: number; pilot_count: number;
};

export type FlightFilters = { date?: string; airport?: string; type?: string };

// Every flight with how many crew are on it. LEFT JOIN keeps flights that
// have nobody assigned yet (their count is 0); FILTER counts only pilots.
export function listFlights(f: FlightFilters) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.date) {
    params.push(f.date);
    where.push(`f.sched_dep_utc::date = $${params.length}`);
  }
  if (f.airport) {
    params.push(f.airport);
    where.push(`(f.dep_airport = $${params.length} OR f.arr_airport = $${params.length})`);
  }
  if (f.type) {
    params.push(f.type);
    where.push(`f.type_code = $${params.length}`);
  }
  return query<FlightRow>(
    `SELECT f.*,
            fn_duty_hours(f.sched_dep_utc, f.sched_arr_utc)                                   AS block_hours,
            COUNT(da.assignment_id)                                                           AS crew_count,
            COUNT(da.assignment_id) FILTER (WHERE da.assigned_role <> 'CABIN_CREW')           AS pilot_count
     FROM flight f
     LEFT JOIN duty_assignment da ON da.flight_id = f.flight_id
     ${where.length ? "WHERE " + where.join(" AND ") : ""}
     GROUP BY f.flight_id
     ORDER BY f.sched_dep_utc, f.flight_number`,
    params,
  );
}

export async function getFlight(id: number) {
  const rows = await query<FlightRow & { dep_city: string; arr_city: string; aircraft: string | null }>(
    `SELECT f.*, fn_duty_hours(f.sched_dep_utc, f.sched_arr_utc) AS block_hours,
            dep.city AS dep_city, arr.city AS arr_city, t.description AS aircraft
     FROM flight f
     JOIN airport dep      ON dep.iata_code = f.dep_airport
     JOIN airport arr      ON arr.iata_code = f.arr_airport
     JOIN aircraft_type t  ON t.type_code   = f.type_code
     WHERE f.flight_id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

// Crew on this flight, captain first.
export function getFlightCrew(flightId: number) {
  return query<{
    assignment_id: number; crew_id: number; employee_code: string; crew_name: string; assigned_role: string;
    duty_start_utc: Date; duty_end_utc: Date; duty_hours: number;
  }>(
    `SELECT assignment_id, crew_id, employee_code, crew_name, assigned_role,
            duty_start_utc, duty_end_utc, duty_hours
     FROM v_duty_roster
     WHERE flight_id = $1
     ORDER BY CASE assigned_role WHEN 'CAPTAIN' THEN 1 WHEN 'FIRST_OFFICER' THEN 2 ELSE 3 END, crew_name`,
    [flightId],
  );
}

// Active crew NOT yet on this flight, with two warnings worked out in SQL:
//   has_rating  - pilot holds a valid rating for this aircraft type on the day
//   busy        - already on a duty that overlaps this flight
// These are shown as hints only. The database itself will reject an overlap
// (EXCLUDE constraint); a missing rating is left for the validator to report.
export function getAssignableCrew(flightId: number) {
  return query<{
    crew_id: number; employee_code: string; crew_name: string; crew_role: string; home_base: string;
    has_rating: boolean; busy: boolean;
  }>(
    `SELECT cm.crew_id, cm.employee_code, cm.first_name || ' ' || cm.last_name AS crew_name,
            cm.crew_role, cm.home_base,
            cm.crew_role = 'CABIN_CREW' OR EXISTS (
              SELECT 1 FROM certification c
              WHERE c.crew_id = cm.crew_id AND c.type_code = f.type_code
                AND f.sched_dep_utc::date BETWEEN c.issued_on AND c.expires_on) AS has_rating,
            EXISTS (
              SELECT 1 FROM duty_assignment d
              WHERE d.crew_id = cm.crew_id
                AND tstzrange(d.duty_start_utc, d.duty_end_utc)
                    && tstzrange(f.sched_dep_utc - INTERVAL '1 hour', f.sched_arr_utc + INTERVAL '30 minutes')) AS busy
     FROM crew_member cm
     CROSS JOIN flight f
     WHERE f.flight_id = $1
       AND cm.is_active
       AND cm.crew_id NOT IN (SELECT crew_id FROM duty_assignment WHERE flight_id = $1)
     ORDER BY CASE cm.crew_role WHEN 'CAPTAIN' THEN 1 WHEN 'FIRST_OFFICER' THEN 2 ELSE 3 END,
              cm.last_name`,
    [flightId],
  );
}

// ---------- writes ----------

export async function createFlight(d: Record<string, unknown>) {
  const rows = await query<{ flight_id: number }>(
    `INSERT INTO flight (flight_number, type_code, dep_airport, arr_airport, sched_dep_utc, sched_arr_utc)
     VALUES (UPPER($1), $2, $3, $4, $5, $6)
     RETURNING flight_id`,
    [d.flight_number, d.type_code, d.dep_airport, d.arr_airport, d.sched_dep_utc, d.sched_arr_utc],
  );
  return rows[0].flight_id;
}

// ON DELETE CASCADE removes the flight's duties as well.
export async function deleteFlight(id: number) {
  const rows = await query("DELETE FROM flight WHERE flight_id = $1 RETURNING flight_id", [id]);
  return rows.length > 0;
}

// TRANSACTION: assign several crew members to a flight, all or nothing.
// If any one insert is rejected (overlap, inactive crew, ...), ROLLBACK undoes
// the inserts that already succeeded, so the flight is never half-staffed.
export function assignCrew(flightId: number, crewIds: number[], dutyStart: string, dutyEnd: string, userId: number) {
  return withTransaction(async (client) => {
    // Names are looked up first: once a statement fails, PostgreSQL refuses
    // every further query in the transaction until ROLLBACK.
    const { rows: crew } = await client.query<{ crew_id: number; employee_code: string }>(
      "SELECT crew_id, employee_code FROM crew_member WHERE crew_id = ANY($1)",
      [crewIds],
    );
    const codeOf = new Map(crew.map((c) => [c.crew_id, c.employee_code]));
    const ids: number[] = [];
    for (const crewId of crewIds) {
      try {
        const { rows } = await client.query<{ assignment_id: number }>(
          `INSERT INTO duty_assignment (crew_id, flight_id, assigned_role, duty_start_utc, duty_end_utc, created_by)
           SELECT crew_id, $2, crew_role, $3, $4, $5 FROM crew_member WHERE crew_id = $1
           RETURNING assignment_id`,
          [crewId, flightId, dutyStart, dutyEnd, userId],
        );
        ids.push(rows[0].assignment_id);
      } catch (err) {
        // remember who failed so the error message can name them
        (err as { subject?: string }).subject = codeOf.get(crewId) ?? `Crew #${crewId}`;
        throw err;
      }
    }
    return ids;
  });
}

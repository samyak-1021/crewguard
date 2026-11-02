// SQL for violations and their review. Reads go through the v_violation_report view.
import { query } from "@/lib/db";
import { toId } from "@/lib/ids";

export type ViolationRow = {
  violation_id: number; run_id: number; period_start: Date; period_end: Date;
  rule_code: string; rule_name: string; severity: string;
  crew_id: number; employee_code: string; crew_name: string; crew_role: string;
  window_start: Date | null; window_end: Date | null;
  observed_value: number | null; threshold_value: number | null; evidence_doc_id: string | null;
  review_status: string; reviewer: string | null; review_note: string | null; reviewed_at: Date | null;
  duty_count: number;
};

export type ViolationFilters = { rule?: string; severity?: string; status?: string; run?: string; q?: string };

export function listViolations(f: ViolationFilters) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.rule) {
    params.push(f.rule);
    where.push(`rule_code = $${params.length}`);
  }
  if (f.severity) {
    params.push(f.severity);
    where.push(`severity = $${params.length}`);
  }
  if (f.status) {
    params.push(f.status);
    where.push(`review_status = $${params.length}`);
  }
  const run = toId(f.run);
  if (run !== null) {
    params.push(run);
    where.push(`run_id = $${params.length}`);
  }
  if (f.q) {
    params.push(`%${f.q}%`);
    where.push(`(crew_name ILIKE $${params.length} OR employee_code ILIKE $${params.length})`);
  }
  return query<ViolationRow>(
    `SELECT * FROM v_violation_report
     ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY run_id DESC, violation_id`,
    params,
  );
}

// One violation plus the rule it breaks.
export async function getViolation(id: number) {
  const rows = await query<ViolationRow & {
    description: string; regulation_ref: string | null; threshold_unit: string | null; window_days: number | null;
  }>(
    `SELECT vr.*, r.description, r.regulation_ref, r.threshold_unit, r.window_days
     FROM v_violation_report vr
     JOIN rule_definition r ON r.rule_code = vr.rule_code
     WHERE vr.violation_id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

// The explanation: the duties that caused this violation (the M:N bridge table).
export function getViolationDuties(id: number) {
  return query<{
    assignment_id: number; flight_id: number; flight_number: string; dep_airport: string; arr_airport: string;
    type_code: string; duty_start_utc: Date; duty_end_utc: Date; contribution_value: number;
  }>(
    `SELECT r.assignment_id, r.flight_id, r.flight_number, r.dep_airport, r.arr_airport, r.type_code,
            r.duty_start_utc, r.duty_end_utc, va.contribution_value
     FROM violation_assignment va
     JOIN v_duty_roster r ON r.assignment_id = va.assignment_id
     WHERE va.violation_id = $1
     ORDER BY r.duty_start_utc`,
    [id],
  );
}

// trg_violation_review stamps reviewed_at. The CHECK constraints reject an unknown
// status and a RESOLVED with no note, and lib/api.ts turns that into a message.
export async function reviewViolation(id: number, status: unknown, note: unknown, userId: number) {
  const cleanNote = typeof note === "string" ? note.trim() || null : null;
  const rows = await query(
    `UPDATE violation
     SET review_status = $2, review_note = $3, reviewed_by = $4
     WHERE violation_id = $1
     RETURNING violation_id`,
    [id, status, cleanNote, userId],
  );
  return rows.length > 0;
}

export async function countOpenViolations() {
  const rows = await query<{ open: number }>("SELECT COUNT(*) AS open FROM violation WHERE review_status = 'OPEN'");
  return rows[0].open;
}

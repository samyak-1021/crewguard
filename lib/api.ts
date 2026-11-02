// Shared plumbing for the route handlers in app/api.
import { NextResponse } from "next/server";
import { AuthError } from "@/lib/auth";

// Data validation lives in the database (CHECK, UNIQUE, FK, EXCLUDE and the
// duty trigger). When PostgreSQL rejects a write, it reports the name of the
// constraint that failed; this table turns that name into a readable message.
const CONSTRAINT_MESSAGES: Record<string, string> = {
  crew_member_employee_code_key: "That employee code is already in use.",
  chk_crew_role: "Unknown crew role.",
  chk_crew_hire_date: "Hire date cannot be in the future.",
  fk_crew_home_base: "Unknown home base airport.",
  uk_cert_crew_type_issue: "This rating was already issued on that date.",
  chk_cert_validity_order: "Expiry date must be after the issue date.",
  fk_cert_type: "Unknown aircraft type.",
  uk_flight_number_dep: "This flight number already departs at that time.",
  chk_flight_time_order: "Arrival must be after departure.",
  chk_flight_distinct_endpoints: "Departure and arrival airports must be different.",
  fk_flight_type: "Unknown aircraft type.",
  fk_flight_dep: "Unknown departure airport.",
  fk_flight_arr: "Unknown arrival airport.",
  uk_duty_crew_flight: "This crew member is already on this flight.",
  chk_duty_time_order: "Duty must end after it starts.",
  excl_duty_no_overlap: "This duty overlaps another duty of the same crew member.",
  chk_run_period_order: "The end date cannot be before the start date.",
  chk_violation_review_status: "Unknown review status.",
  chk_violation_resolution_note: "Add a note saying how this violation was resolved.",
};

// PostgreSQL error codes (SQLSTATE) that mean "your data broke a rule".
const INTEGRITY_CODES = new Set([
  "23505", // unique_violation
  "23503", // foreign_key_violation
  "23514", // check_violation (also raised by our trigger)
  "23P01", // exclusion_violation
  "23502", // not_null_violation
  "22P02", // invalid_text_representation (e.g. "abc" for an integer)
  "22007", // invalid_datetime_format
  "22008", // datetime_field_overflow
]);

// `subject` is set by our own code to say which row failed (e.g. one crew
// member inside a multi-row transaction).
type PgError = { code?: string; constraint?: string; column?: string; message: string; subject?: string };

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

// Wrap a route handler: turns auth failures into 401/403 and database
// integrity errors into 400 responses that name the failing constraint.
export function handle<C>(fn: (req: Request, ctx: C) => Promise<Response>) {
  return async (req: Request, ctx: C): Promise<Response> => {
    try {
      return await fn(req, ctx);
    } catch (err) {
      if (err instanceof AuthError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      const pgErr = err as PgError;
      if (pgErr.code && INTEGRITY_CODES.has(pgErr.code)) {
        let message =
          pgErr.code === "23502"
            ? `Please fill in ${pgErr.column?.replaceAll("_", " ")}.`
            : (pgErr.constraint && CONSTRAINT_MESSAGES[pgErr.constraint]) || pgErr.message;
        if (pgErr.subject) message = `${pgErr.subject}: ${message}`;
        return NextResponse.json({ error: message, constraint: pgErr.constraint ?? null }, { status: 400 });
      }
      console.error(err);
      return NextResponse.json({ error: "Something went wrong on the server." }, { status: 500 });
    }
  };
}

// Read a JSON body; empty strings become null so optional columns stay NULL.
export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  for (const k of Object.keys(body)) if (body[k] === "") body[k] = null;
  return body;
}

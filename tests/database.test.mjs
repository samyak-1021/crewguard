// Database tests: integrity rules are enforced BY THE DATABASE.
//   npm test   (needs a freshly reset database: npm run db:reset)
// Every test runs inside BEGIN ... ROLLBACK, so the data is never changed.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
before(() => client.connect());
after(() => client.end());

// Run fn inside a transaction that is always rolled back.
async function inRollback(fn) {
  await client.query("BEGIN");
  try {
    return await fn();
  } finally {
    await client.query("ROLLBACK");
  }
}

// Assert that sql fails and that PostgreSQL names the expected constraint.
async function rejects(sql, constraint) {
  await inRollback(async () => {
    await assert.rejects(client.query(sql), (err) => {
      assert.equal(err.constraint, constraint, err.message);
      return true;
    });
  });
}

// ---------- seed data ----------
test("seed data is loaded", async () => {
  const { rows } = await client.query(`
    SELECT (SELECT COUNT(*) FROM crew_member)::int     AS crew,
           (SELECT COUNT(*) FROM flight)::int          AS flights,
           (SELECT COUNT(*) FROM duty_assignment)::int AS duties,
           (SELECT COUNT(*) FROM rule_definition)::int AS rules`);
  assert.deepEqual(rows[0], { crew: 13, flights: 24, duties: 62, rules: 4 });
});

test("passwords are stored as bcrypt hashes, never plain text", async () => {
  const { rows } = await client.query("SELECT password_hash FROM app_user");
  for (const r of rows) assert.match(r.password_hash, /^\$2[aby]\$10\$.{53}$/);
});

// ---------- constraints ----------
test("UNIQUE: username already exists", () =>
  rejects(`INSERT INTO app_user (username, password_hash, app_role)
           VALUES ('audit_meera', 'x', 'AUDITOR')`, "app_user_username_key"));

test("CHECK: IATA code must be three capital letters", () =>
  rejects(`INSERT INTO airport VALUES ('bl1', 'Bad', 'X', 'Y', 'UTC')`, "chk_airport_iata_format"));

test("CHECK: unknown crew role", () =>
  rejects(`INSERT INTO crew_member (employee_code, first_name, last_name, crew_role, home_base, hire_date)
           VALUES ('EMP9999', 'A', 'B', 'PILOT', 'BLR', '2020-01-01')`, "chk_crew_role"));

test("FOREIGN KEY: flight with unknown aircraft type", () =>
  rejects(`INSERT INTO flight (flight_number, type_code, dep_airport, arr_airport, sched_dep_utc, sched_arr_utc)
           VALUES ('CG999', 'A380', 'BLR', 'DEL', '2026-11-20 01:00+00', '2026-11-20 03:00+00')`, "fk_flight_type"));

test("CHECK: flight cannot depart and arrive at the same airport", () =>
  rejects(`INSERT INTO flight (flight_number, type_code, dep_airport, arr_airport, sched_dep_utc, sched_arr_utc)
           VALUES ('CG999', 'A320', 'BLR', 'BLR', '2026-11-20 01:00+00', '2026-11-20 03:00+00')`,
          "chk_flight_distinct_endpoints"));

test("CHECK: certificate must expire after it is issued", () =>
  rejects(`INSERT INTO certification (crew_id, type_code, issued_on, expires_on)
           VALUES (13, 'A320', '2026-01-01', '2025-01-01')`, "chk_cert_validity_order"));

test("UNIQUE: a crew member cannot be assigned twice to one flight", () =>
  rejects(`INSERT INTO duty_assignment (crew_id, flight_id, assigned_role, duty_start_utc, duty_end_utc)
           VALUES (1, 1, 'CAPTAIN', '2026-11-02 00:00+00', '2026-11-02 04:15+00')`, "uk_duty_crew_flight"));

test("EXCLUDE: a crew member cannot be on two overlapping duties", () =>
  // Kavya (2) is on flight 3 from 01:00 to 04:15 on 3 Nov; flight 11 is not hers.
  rejects(`INSERT INTO flight (flight_id, flight_number, type_code, dep_airport, arr_airport, sched_dep_utc, sched_arr_utc)
             VALUES (900, 'CG900', 'B738', 'BOM', 'DEL', '2026-11-03 03:00+00', '2026-11-03 05:00+00');
           INSERT INTO duty_assignment (crew_id, flight_id, assigned_role, duty_start_utc, duty_end_utc)
             VALUES (2, 900, 'CAPTAIN', '2026-11-03 02:00+00', '2026-11-03 05:30+00')`, "excl_duty_no_overlap"));

test("ON DELETE RESTRICT: an airport used as a home base cannot be deleted", () =>
  rejects(`DELETE FROM airport WHERE iata_code = 'BLR'`, "fk_crew_home_base"));

test("ON DELETE CASCADE: deleting a crew member removes their duties and certificates", () =>
  inRollback(async () => {
    await client.query("DELETE FROM crew_member WHERE crew_id = 1");
    const { rows } = await client.query(`
      SELECT (SELECT COUNT(*) FROM duty_assignment WHERE crew_id = 1)::int AS duties,
             (SELECT COUNT(*) FROM certification   WHERE crew_id = 1)::int AS certs`);
    assert.deepEqual(rows[0], { duties: 0, certs: 0 });
  }));

// ---------- trigger trg_validate_duty ----------
test("TRIGGER: inactive crew cannot be rostered", () =>
  rejects(`INSERT INTO duty_assignment (crew_id, flight_id, assigned_role, duty_start_utc, duty_end_utc)
           VALUES (8, 24, 'CABIN_CREW', '2026-11-12 14:00+00', '2026-11-12 16:40+00')`, "trg_duty_crew_active"));

test("TRIGGER: assigned role must match the crew member's role", () =>
  rejects(`INSERT INTO duty_assignment (crew_id, flight_id, assigned_role, duty_start_utc, duty_end_utc)
           VALUES (12, 24, 'CAPTAIN', '2026-11-12 14:00+00', '2026-11-12 16:40+00')`, "trg_duty_role_match"));

test("TRIGGER: duty must cover the whole flight", () =>
  rejects(`INSERT INTO duty_assignment (crew_id, flight_id, assigned_role, duty_start_utc, duty_end_utc)
           VALUES (12, 24, 'CABIN_CREW', '2026-11-12 15:30+00', '2026-11-12 16:40+00')`, "trg_duty_covers_flight"));

// ---------- transaction ----------
test("TRANSACTION: a failed statement rolls back the earlier ones too", async () => {
  await client.query("BEGIN");
  await client.query(`INSERT INTO duty_assignment (crew_id, flight_id, assigned_role, duty_start_utc, duty_end_utc)
                      VALUES (12, 24, 'CABIN_CREW', '2026-11-12 14:00+00', '2026-11-12 16:40+00')`); // valid
  await assert.rejects(client.query(`INSERT INTO duty_assignment (crew_id, flight_id, assigned_role, duty_start_utc, duty_end_utc)
                      VALUES (8, 24, 'CABIN_CREW', '2026-11-12 14:00+00', '2026-11-12 16:40+00')`)); // inactive crew
  await client.query("ROLLBACK");
  const { rows } = await client.query("SELECT COUNT(*)::int AS n FROM duty_assignment WHERE flight_id = 24");
  assert.equal(rows[0].n, 2); // still only Arjun and Rohan: the valid insert was undone as well
});

// ---------- views and functions ----------
test("FUNCTION fn_duty_hours computes the duty length", async () => {
  const { rows } = await client.query(
    "SELECT fn_duty_hours('2026-11-02 00:00+00', '2026-11-02 04:15+00')::float AS h");
  assert.equal(rows[0].h, 4.25);
});

test("FUNCTION fn_crew_duty_hours sums a crew member's week", async () => {
  // Farhan (9): six 11 h long-haul duties between 2 and 8 Nov
  const { rows } = await client.query(
    "SELECT fn_crew_duty_hours(9, '2026-11-02 00:00+00', '2026-11-09 00:00+00')::float AS h");
  assert.equal(rows[0].h, 66);
});

test("FUNCTION fn_crew_roster returns one row per duty, in time order", async () => {
  const { rows } = await client.query("SELECT flight_number FROM fn_crew_roster(1)");
  assert.equal(rows.length, 8);
  assert.equal(rows[0].flight_number, "CG101");
});

test("FUNCTION fn_cert_status classifies certificates", async () => {
  const { rows } = await client.query(`
    SELECT fn_cert_status('2026-08-11', '2026-11-02') AS expired,
           fn_cert_status('2026-12-20', '2026-11-02') AS expiring,
           fn_cert_status('2028-01-04', '2026-11-02') AS valid`);
  assert.deepEqual(rows[0], { expired: "EXPIRED", expiring: "EXPIRING", valid: "VALID" });
});

test("VIEW v_crew_summary includes crew with no duties (LEFT JOIN)", async () => {
  const { rows } = await client.query(
    "SELECT duty_count, valid_certs FROM v_crew_summary WHERE employee_code = 'EMP1013'");
  assert.deepEqual(rows[0], { duty_count: 0, valid_certs: 0 });
});

test("VIEW v_duty_roster joins every duty to its crew and flight", async () => {
  const { rows } = await client.query("SELECT COUNT(*)::int AS n FROM v_duty_roster");
  assert.equal(rows[0].n, 62);
});

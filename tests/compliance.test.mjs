// Compliance tests: the validator finds exactly the breaches planted in the seed.
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

// Run the validator as the auditor and return the new run id.
async function runValidation(start, end) {
  const { rows } = await client.query("CALL sp_run_validation(2, $1, $2, NULL)", [start, end]);
  return rows[0].p_run_id;
}

// { RST: 7, FDP: 2, ... } for one run
async function countsByRule(runId) {
  const { rows } = await client.query(
    "SELECT rule_code, COUNT(*)::int AS n FROM violation WHERE run_id = $1 GROUP BY rule_code",
    [runId],
  );
  return Object.fromEntries(rows.map((r) => [r.rule_code, r.n]));
}

// Assert that sql fails and that PostgreSQL names the expected constraint.
async function rejects(sql, constraint) {
  await assert.rejects(client.query(sql), (err) => {
    assert.equal(err.constraint, constraint, err.message);
    return true;
  });
}

// ---------- totals per rule ----------
test("VALIDATOR: the full two weeks give RST 7, FDP 2, WDH 3, CER 4", () =>
  inRollback(async () => {
    const run = await runValidation("2026-11-02", "2026-11-15");
    assert.deepEqual(await countsByRule(run), { RST: 7, FDP: 2, WDH: 3, CER: 4 });
  }));

test("VALIDATOR: week 1 gives RST 7, WDH 3, CER 2", () =>
  inRollback(async () => {
    const run = await runValidation("2026-11-02", "2026-11-08");
    assert.deepEqual(await countsByRule(run), { RST: 7, WDH: 3, CER: 2 });
  }));

test("VALIDATOR: week 2 gives FDP 2, CER 2 and no WDH (Nisha only reaches 58.67 h)", () =>
  inRollback(async () => {
    const run = await runValidation("2026-11-09", "2026-11-15");
    assert.deepEqual(await countsByRule(run), { FDP: 2, CER: 2 });
  }));

test("VALIDATOR: the result does not depend on the session time zone", () =>
  inRollback(async () => {
    await client.query("SET LOCAL timezone = 'Pacific/Auckland'");
    const run = await runValidation("2026-11-02", "2026-11-15");
    assert.deepEqual(await countsByRule(run), { RST: 7, FDP: 2, WDH: 3, CER: 4 });
  }));

test("VALIDATOR: an inactive rule is skipped", () =>
  inRollback(async () => {
    await client.query("UPDATE rule_definition SET is_active = FALSE WHERE rule_code = 'RST'");
    const run = await runValidation("2026-11-02", "2026-11-15");
    assert.deepEqual(await countsByRule(run), { FDP: 2, WDH: 3, CER: 4 });
  }));

test("VALIDATOR: thresholds come from rule_definition, not from the code", () =>
  inRollback(async () => {
    // a 9 h minimum makes the 9.83 h rests of Arjun and Vikram legal
    await client.query("UPDATE rule_definition SET threshold_value = 9 WHERE rule_code = 'RST'");
    const run = await runValidation("2026-11-02", "2026-11-15");
    assert.equal((await countsByRule(run)).RST, 5);
  }));

// ---------- the explanation (violation_assignment) ----------
test("EXPLANATION: Arjun's 0.25 h rest links exactly the two duties around it", () =>
  inRollback(async () => {
    const run = await runValidation("2026-11-02", "2026-11-15");
    const { rows } = await client.query(
      `SELECT r.flight_number
       FROM violation v
       JOIN violation_assignment va ON va.violation_id = v.violation_id
       JOIN v_duty_roster r         ON r.assignment_id = va.assignment_id
       WHERE v.run_id = $1 AND v.rule_code = 'RST' AND v.crew_id = 1 AND v.observed_value = 0.25
       ORDER BY r.duty_start_utc`,
      [run],
    );
    assert.deepEqual(rows.map((r) => r.flight_number), ["CG101", "CG102"]);
  }));

test("EXPLANATION: each WDH links 6 duties whose hours add up to 66", () =>
  inRollback(async () => {
    const run = await runValidation("2026-11-02", "2026-11-15");
    const { rows } = await client.query(
      `SELECT v.crew_id, v.observed_value::float AS observed,
              COUNT(*)::int AS duties, SUM(va.contribution_value)::float AS hours
       FROM violation v
       JOIN violation_assignment va ON va.violation_id = v.violation_id
       WHERE v.run_id = $1 AND v.rule_code = 'WDH'
       GROUP BY v.violation_id
       ORDER BY v.crew_id`,
      [run],
    );
    assert.deepEqual(rows, [
      { crew_id: 6, observed: 66, duties: 6, hours: 66 },
      { crew_id: 9, observed: 66, duties: 6, hours: 66 },
      { crew_id: 11, observed: 66, duties: 6, hours: 66 },
    ]);
  }));

test("EXPLANATION: Aditya's FDP breach links the one delayed 14 h duty", () =>
  inRollback(async () => {
    const run = await runValidation("2026-11-02", "2026-11-15");
    const { rows } = await client.query(
      `SELECT r.flight_number, va.contribution_value::float AS hours
       FROM violation v
       JOIN violation_assignment va ON va.violation_id = v.violation_id
       JOIN v_duty_roster r         ON r.assignment_id = va.assignment_id
       WHERE v.run_id = $1 AND v.rule_code = 'FDP' AND v.crew_id = 7`,
      [run],
    );
    assert.deepEqual(rows, [{ flight_number: "CG131", hours: 14 }]);
  }));

test("CER: Kavya holds a renewal, so her expired A320 certificate is not a breach", () =>
  inRollback(async () => {
    const run = await runValidation("2026-11-02", "2026-11-15");
    const { rows } = await client.query(
      "SELECT COUNT(*)::int AS n FROM violation WHERE run_id = $1 AND rule_code = 'CER' AND crew_id = 2",
      [run],
    );
    assert.equal(rows[0].n, 0);
  }));

test("CER: cabin crew are exempt, even with no ratings at all", () =>
  inRollback(async () => {
    const run = await runValidation("2026-11-02", "2026-11-15");
    const { rows } = await client.query(
      `SELECT COUNT(*)::int AS n
       FROM violation v JOIN crew_member cm ON cm.crew_id = v.crew_id
       WHERE v.run_id = $1 AND v.rule_code = 'CER' AND cm.crew_role = 'CABIN_CREW'`,
      [run],
    );
    assert.equal(rows[0].n, 0);
  }));

test("RST: the previous duty may lie before the period", () =>
  inRollback(async () => {
    // Aditya and Priya's 2 h rest began on 4 Nov and ended on 5 Nov, so a run over
    // 5 Nov alone must still see the 4 Nov duty.
    const run = await runValidation("2026-11-05", "2026-11-05");
    assert.deepEqual(await countsByRule(run), { RST: 2 });
  }));

// ---------- triggers ----------
test("TRIGGER: violations_found follows inserts and deletes", () =>
  inRollback(async () => {
    const run = await runValidation("2026-11-02", "2026-11-15");
    const count = async () =>
      (await client.query("SELECT violations_found FROM validation_run WHERE run_id = $1", [run])).rows[0]
        .violations_found;
    assert.equal(await count(), 16);
    await client.query(
      "DELETE FROM violation WHERE violation_id = (SELECT MIN(violation_id) FROM violation WHERE run_id = $1)",
      [run],
    );
    assert.equal(await count(), 15);
  }));

test("TRIGGER: finished_at is stamped when the run completes", () =>
  inRollback(async () => {
    const run = await runValidation("2026-11-02", "2026-11-08");
    const { rows } = await client.query(
      "SELECT status, finished_at, finished_at > started_at AS later FROM validation_run WHERE run_id = $1",
      [run],
    );
    assert.equal(rows[0].status, "COMPLETED");
    assert.ok(rows[0].finished_at);
    assert.equal(rows[0].later, true); // clock_timestamp(): NOW() would equal started_at
  }));

test("TRIGGER: reviewed_at is set when the review status changes, not by a note edit", () =>
  inRollback(async () => {
    const run = await runValidation("2026-11-02", "2026-11-08");
    const { rows: [v] } = await client.query(
      "SELECT MIN(violation_id) AS id FROM violation WHERE run_id = $1",
      [run],
    );
    const stamp = async () =>
      (await client.query("SELECT reviewed_at FROM violation WHERE violation_id = $1", [v.id])).rows[0].reviewed_at;
    assert.equal(await stamp(), null);

    // a note written alongside the same status leaves the stamp empty
    await client.query("UPDATE violation SET review_status = 'OPEN', review_note = 'x' WHERE violation_id = $1", [v.id]);
    assert.equal(await stamp(), null);

    await client.query("UPDATE violation SET review_status = 'ACKNOWLEDGED' WHERE violation_id = $1", [v.id]);
    assert.ok(await stamp());
  }));

// ---------- review CHECKs ----------
test("CHECK: unknown review status", () =>
  inRollback(async () => {
    await runValidation("2026-11-02", "2026-11-08");
    await rejects("UPDATE violation SET review_status = 'CLOSED'", "chk_violation_review_status");
  }));

test("CHECK: a violation cannot be RESOLVED without a note", () =>
  inRollback(async () => {
    await runValidation("2026-11-02", "2026-11-08");
    await rejects("UPDATE violation SET review_status = 'RESOLVED'", "chk_violation_resolution_note");
  }));

test("CHECK: a run cannot end before it starts", () =>
  inRollback(() => rejects("CALL sp_run_validation(2, '2026-11-08', '2026-11-02', NULL)", "chk_run_period_order")));

// ---------- transaction ----------
test("TRANSACTION: rolling back removes the run and everything it created", async () => {
  const counts = async () =>
    (await client.query(`
      SELECT (SELECT COUNT(*) FROM validation_run)::int       AS runs,
             (SELECT COUNT(*) FROM violation)::int            AS violations,
             (SELECT COUNT(*) FROM violation_assignment)::int AS links`)).rows[0];
  const before = await counts();
  await inRollback(() => runValidation("2026-11-02", "2026-11-15"));
  assert.deepEqual(await counts(), before);
});

// ---------- view ----------
test("VIEW v_violation_report gives one row per violation, with its duty count", () =>
  inRollback(async () => {
    const run = await runValidation("2026-11-02", "2026-11-15");
    const { rows } = await client.query(
      `SELECT COUNT(*)::int AS n, COUNT(reviewer)::int AS reviewed, SUM(duty_count)::int AS duties
       FROM v_violation_report WHERE run_id = $1`,
      [run],
    );
    // 7 RST x 2 duties + 2 FDP x 1 + 3 WDH x 6 + 4 CER x 1
    assert.deepEqual(rows[0], { n: 16, reviewed: 0, duties: 38 });
  }));

// ---------- full-text search ----------
const FTS = `to_tsvector('english', rule_name || ' ' || description || ' ' || COALESCE(regulation_ref, ''))`;

test("FULL-TEXT: searching 'rest' finds RST first", async () => {
  const { rows } = await client.query(
    `SELECT rule_code FROM rule_definition
     WHERE ${FTS} @@ websearch_to_tsquery('english', $1)
     ORDER BY ts_rank(${FTS}, websearch_to_tsquery('english', $1)) DESC`,
    ["rest"],
  );
  assert.equal(rows[0].rule_code, "RST");
});

test("FULL-TEXT: stemming matches other forms of a word", async () => {
  const { rows } = await client.query(
    `SELECT rule_code FROM rule_definition WHERE ${FTS} @@ websearch_to_tsquery('english', $1)`,
    ["certificates"], // the rule text says "certificate" and "certification"
  );
  assert.deepEqual(rows.map((r) => r.rule_code), ["CER"]);
});

test("FULL-TEXT: the search uses the GIN index", () =>
  inRollback(async () => {
    await client.query("SET LOCAL enable_seqscan = off");
    const { rows } = await client.query(
      `EXPLAIN SELECT rule_code FROM rule_definition WHERE ${FTS} @@ websearch_to_tsquery('english', 'rest')`,
    );
    assert.match(rows.map((r) => r["QUERY PLAN"]).join("\n"), /idx_rule_fts/);
  }));

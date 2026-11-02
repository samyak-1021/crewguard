-- =====================================================================
-- CrewGuard | queries.sql
-- The important queries the application runs, collected in one place so
-- they can be run in psql for the report and the demo:
--   psql -d crewguard -f db/queries.sql
-- (Not part of db:reset. Nothing here changes the data: writes run inside BEGIN ... ROLLBACK.)
-- =====================================================================

-- the roster is stored and shown in UTC, same as the app's connection
SET timezone = 'UTC';

-- ---------------------------------------------------------------------
-- PART 1 : ROSTER
-- ---------------------------------------------------------------------

-- Q1  View: the operational roster (3-table JOIN inside v_duty_roster)
SELECT crew_name, assigned_role, flight_number, dep_airport, arr_airport, duty_start_utc, duty_hours
FROM v_duty_roster
WHERE duty_start_utc::date = '2026-11-02'
ORDER BY duty_start_utc;

-- Q2  Search + filter (crew page): ILIKE pattern match on a view
SELECT crew_name, employee_code, crew_role, home_base, duty_count, total_duty_hours
FROM v_crew_summary
WHERE (crew_name ILIKE '%ar%' OR employee_code ILIKE '%ar%')
  AND crew_role = 'CAPTAIN'
ORDER BY last_name;

-- Q3  LEFT JOIN + GROUP BY + FILTER: crew count per flight, unstaffed flights included
SELECT f.flight_number, f.dep_airport || ' → ' || f.arr_airport AS route,
       COUNT(da.assignment_id)                                            AS crew,
       COUNT(da.assignment_id) FILTER (WHERE da.assigned_role <> 'CABIN_CREW') AS pilots
FROM flight f
LEFT JOIN duty_assignment da ON da.flight_id = f.flight_id
GROUP BY f.flight_id
ORDER BY f.sched_dep_utc;

-- Q4  GROUP BY + HAVING: crew with more than 30 rostered hours
SELECT crew_id, COUNT(*) AS duties, SUM(fn_duty_hours(duty_start_utc, duty_end_utc)) AS hours
FROM duty_assignment
GROUP BY crew_id
HAVING SUM(fn_duty_hours(duty_start_utc, duty_end_utc)) > 30
ORDER BY hours DESC;

-- Q5  Aggregates on a date expression: duties per day (overview chart)
SELECT duty_start_utc::date AS day, COUNT(*) AS duties, COUNT(DISTINCT crew_id) AS crew
FROM duty_assignment
GROUP BY duty_start_utc::date
ORDER BY day;

-- Q6  NOT EXISTS sub-query: ratings expired/expiring and NOT yet renewed
SELECT cm.first_name || ' ' || cm.last_name AS crew_name, c.type_code, c.expires_on,
       fn_cert_status(c.expires_on) AS status
FROM certification c
JOIN crew_member cm ON cm.crew_id = c.crew_id
WHERE fn_cert_status(c.expires_on) <> 'VALID'
  AND NOT EXISTS (SELECT 1 FROM certification newer
                  WHERE newer.crew_id = c.crew_id AND newer.type_code = c.type_code
                    AND newer.issued_on > c.issued_on)
ORDER BY c.expires_on;

-- Q7  Window function: mark the newest certificate per aircraft type
SELECT type_code, issued_on, expires_on,
       ROW_NUMBER() OVER (PARTITION BY type_code ORDER BY issued_on DESC) = 1 AS is_current
FROM certification
WHERE crew_id = 2;

-- Q8  Table-valued function: one crew member's roster
SELECT * FROM fn_crew_roster(1);

-- Q9  generate_series + function: duty hours per week for one crew member
SELECT wk::date AS week_start, fn_crew_duty_hours(9, wk, wk + INTERVAL '7 days') AS hours
FROM generate_series('2026-11-02'::timestamptz, '2026-11-09'::timestamptz, INTERVAL '7 days') AS wk;

-- Q10 EXISTS + range overlap (&&): who could be added to flight 21, and warnings
SELECT cm.employee_code, cm.crew_role,
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
WHERE f.flight_id = 21
  AND cm.is_active
  AND cm.crew_id NOT IN (SELECT crew_id FROM duty_assignment WHERE flight_id = 21);

-- Q11 Correlated scalar sub-queries: usage of every airport
SELECT * FROM (
  SELECT a.iata_code, a.city,
         (SELECT COUNT(*) FROM crew_member cm WHERE cm.home_base  = a.iata_code) AS crew_based,
         (SELECT COUNT(*) FROM flight f       WHERE f.dep_airport = a.iata_code) AS departures,
         (SELECT COUNT(*) FROM flight f       WHERE f.arr_airport = a.iata_code) AS arrivals
  FROM airport a
) usage
ORDER BY departures + arrivals DESC;

-- Q12 Index use: the composite index idx_duty_crew_start serves this lookup
-- (on a table this small the planner may still prefer a sequential scan;
--  SET enable_seqscan = off shows the index plan for the demo)
SET enable_seqscan = off;
EXPLAIN ANALYZE
SELECT * FROM duty_assignment WHERE crew_id = 1 ORDER BY duty_start_utc;
RESET enable_seqscan;

-- ---------------------------------------------------------------------
-- PART 2 : COMPLIANCE
-- ---------------------------------------------------------------------

-- Q13 Stored procedure: run the validator. BEGIN ... ROLLBACK runs it for real
-- and then undoes everything, so the data stays clean. Q14 to Q16 read this run.
BEGIN;
CALL sp_run_validation(2, '2026-11-02', '2026-11-15', NULL);

-- Q14 The explanation: which duties caused each violation
-- (violation -> violation_assignment -> v_duty_roster, the M:N bridge)
SELECT v.violation_id, v.rule_code, cm.first_name || ' ' || cm.last_name AS crew_name,
       r.flight_number, r.duty_start_utc, r.duty_end_utc, va.contribution_value AS hours
FROM violation v
JOIN crew_member          cm ON cm.crew_id       = v.crew_id
JOIN violation_assignment va ON va.violation_id  = v.violation_id
JOIN v_duty_roster        r  ON r.assignment_id  = va.assignment_id
WHERE v.run_id = (SELECT MAX(run_id) FROM validation_run)
ORDER BY v.violation_id, r.duty_start_utc;

-- Q15 GROUP BY: violations per rule and severity (dashboard, SQL panel)
SELECT rule_code, severity, COUNT(*) AS violations
FROM violation
WHERE run_id = (SELECT MAX(run_id) FROM validation_run)
GROUP BY rule_code, severity
ORDER BY violations DESC;

-- Q16 GROUP BY + HAVING: crew with more than one violation
SELECT crew_name, COUNT(*) AS violations, STRING_AGG(DISTINCT rule_code, ', ') AS rules
FROM v_violation_report
WHERE run_id = (SELECT MAX(run_id) FROM validation_run)
GROUP BY crew_id, crew_name
HAVING COUNT(*) > 1
ORDER BY violations DESC, crew_name;

-- Q17 The review workflow: the trigger stamps reviewed_at, the CHECK needs a note
UPDATE violation
SET review_status = 'RESOLVED', review_note = 'Crew swapped on the roster', reviewed_by = 2
WHERE violation_id = (SELECT MIN(violation_id) FROM violation WHERE run_id = (SELECT MAX(run_id) FROM validation_run))
RETURNING violation_id, review_status, reviewed_at;

ROLLBACK;

-- Q18 Full-text search: ranked rule search with a highlighted snippet (rules page)
SELECT rule_code, rule_name,
       ts_rank(to_tsvector('english', rule_name || ' ' || description || ' ' || COALESCE(regulation_ref, '')),
               websearch_to_tsquery('english', 'rest period')) AS rank,
       ts_headline('english', description, websearch_to_tsquery('english', 'rest period')) AS snippet
FROM rule_definition
WHERE to_tsvector('english', rule_name || ' ' || description || ' ' || COALESCE(regulation_ref, ''))
      @@ websearch_to_tsquery('english', 'rest period')
ORDER BY rank DESC;

-- Q19 Index use: the same search through the GIN index idx_rule_fts
-- (four rows are too few for the planner to choose it on its own)
SET enable_seqscan = off;
EXPLAIN ANALYZE
SELECT rule_code FROM rule_definition
WHERE to_tsvector('english', rule_name || ' ' || description || ' ' || COALESCE(regulation_ref, ''))
      @@ websearch_to_tsquery('english', 'rest');
RESET enable_seqscan;

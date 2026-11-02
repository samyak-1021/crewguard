-- =====================================================================
-- CrewGuard | 03_compliance.sql
-- The compliance side of the database: review workflow, triggers, the
-- report view, the validator procedure and full-text search on the rules.
-- Runs after 02_roster.sql and before 04_seed.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ALTER: review workflow on violation.
-- An auditor moves each violation OPEN -> ACKNOWLEDGED -> RESOLVED.
-- These are added with ALTER because the workflow came after the Review 1
-- schema, so 01_schema.sql still matches that ER diagram.
-- ---------------------------------------------------------------------
ALTER TABLE violation
    ADD COLUMN review_status VARCHAR(15) NOT NULL DEFAULT 'OPEN',
    ADD COLUMN reviewed_by   INTEGER,
    ADD COLUMN review_note   TEXT,
    ADD COLUMN reviewed_at   TIMESTAMPTZ,
    ADD CONSTRAINT chk_violation_review_status
        CHECK (review_status IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED')),
    -- if the auditor's account is removed, keep the review but forget who did it
    ADD CONSTRAINT fk_violation_reviewer FOREIGN KEY (reviewed_by) REFERENCES app_user(user_id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    -- a violation cannot be closed without saying how it was resolved
    ADD CONSTRAINT chk_violation_resolution_note
        CHECK (review_status <> 'RESOLVED' OR review_note IS NOT NULL);

-- the violations page filters by rule, and the dashboard groups by it
CREATE INDEX idx_violation_rule ON violation (rule_code);

COMMENT ON COLUMN violation.review_status IS 'Auditor workflow: OPEN -> ACKNOWLEDGED -> RESOLVED';
COMMENT ON COLUMN violation.reviewed_by   IS 'The auditor who last reviewed this violation';
COMMENT ON COLUMN violation.review_note   IS 'Why it was acknowledged or how it was resolved';
COMMENT ON COLUMN violation.reviewed_at   IS 'When the review status last changed (set by a trigger)';

-- ---------------------------------------------------------------------
-- TRIGGERS: derived values the application must never have to maintain.
-- ---------------------------------------------------------------------

-- Keeps validation_run.violations_found equal to the real number of rows,
-- whichever way a violation is added or removed (even by ON DELETE CASCADE).
CREATE OR REPLACE FUNCTION trg_fn_violation_count()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE validation_run
        SET violations_found = violations_found + 1
        WHERE run_id = NEW.run_id;
        RETURN NEW;
    END IF;
    -- GREATEST: never goes below 0, which chk_run_violation_count would reject
    UPDATE validation_run
    SET violations_found = GREATEST(violations_found - 1, 0)
    WHERE run_id = OLD.run_id;
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_violation_count ON violation;
CREATE TRIGGER trg_violation_count
AFTER INSERT OR DELETE ON violation
FOR EACH ROW
EXECUTE FUNCTION trg_fn_violation_count();

-- Stamps finished_at when a run is closed.
-- clock_timestamp(), not NOW(): NOW() is frozen at the start of the transaction,
-- so a run closed in the same transaction that opened it would show 0 ms.
CREATE OR REPLACE FUNCTION trg_fn_run_finish()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.status IN ('COMPLETED', 'FAILED') AND NEW.finished_at IS NULL THEN
        NEW.finished_at := clock_timestamp();
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_run_finish ON validation_run;
CREATE TRIGGER trg_run_finish
BEFORE UPDATE ON validation_run
FOR EACH ROW
EXECUTE FUNCTION trg_fn_run_finish();

-- Stamps reviewed_at when the review status actually changes.
-- UPDATE OF fires only if review_status is in the SET list, and the IF ignores
-- an update that writes the same status again (e.g. editing only the note).
CREATE OR REPLACE FUNCTION trg_fn_violation_review()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.review_status IS DISTINCT FROM OLD.review_status THEN
        NEW.reviewed_at := NOW();
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_violation_review ON violation;
CREATE TRIGGER trg_violation_review
BEFORE UPDATE OF review_status ON violation
FOR EACH ROW
EXECUTE FUNCTION trg_fn_violation_review();

-- ---------------------------------------------------------------------
-- VIEW: one readable row per violation for the app and the report.
-- LEFT JOIN for the reviewer, because an OPEN violation has none.
-- duty_count is a correlated sub-query: it runs once per violation.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_violation_report AS
SELECT v.violation_id,
       v.run_id,
       vr.period_start,
       vr.period_end,
       v.rule_code,
       r.rule_name,
       v.severity,
       v.crew_id,
       cm.employee_code,
       cm.first_name || ' ' || cm.last_name AS crew_name,
       cm.crew_role,
       v.window_start,
       v.window_end,
       v.observed_value,
       v.threshold_value,
       v.evidence_doc_id,
       v.review_status,
       u.username AS reviewer,
       v.review_note,
       v.reviewed_at,
       (SELECT COUNT(*)::int
        FROM violation_assignment va
        WHERE va.violation_id = v.violation_id) AS duty_count
FROM violation v
JOIN validation_run  vr ON vr.run_id   = v.run_id
JOIN rule_definition r  ON r.rule_code = v.rule_code
JOIN crew_member     cm ON cm.crew_id  = v.crew_id
LEFT JOIN app_user   u  ON u.user_id   = v.reviewed_by;

-- ---------------------------------------------------------------------
-- STORED PROCEDURE: the validator, the core of the project.
--
--   CALL sp_run_validation(user_id, period_start, period_end, NULL);
--
-- Opens a run, checks all four rules over the period, records each breach
-- in violation, links it to the duties that caused it in violation_assignment
-- (the "explanation"), then closes the run. Thresholds and severities are read
-- from rule_definition, so a limit can change without touching this code.
--
-- It does not COMMIT: the caller's transaction makes the whole run atomic, so
-- an error leaves no half-finished run behind.
--
-- Detection, not prevention: these rosters are legal row by row and every
-- constraint accepted them. A breach only shows up across several duties.
--
-- A duty is IN THE PERIOD if it starts in [start 00:00 UTC, end + 1 day 00:00 UTC).
-- RST and WDH look at ALL of a crew member's duties, because the previous duty
-- or the 7-day window can reach back before the period. Only breaches on a duty
-- inside the period are reported.
-- ---------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE sp_run_validation(p_user_id INTEGER,
                                              p_start   DATE,
                                              p_end     DATE,
                                              INOUT p_run_id INTEGER DEFAULT NULL)
LANGUAGE plpgsql
AS $$
DECLARE
    -- AT TIME ZONE 'UTC': the result must not depend on the session time zone
    v_from TIMESTAMPTZ := p_start::timestamp AT TIME ZONE 'UTC';
    v_to   TIMESTAMPTZ := (p_end + 1)::timestamp AT TIME ZONE 'UTC';
    v_rule rule_definition%ROWTYPE;
    v_id   INTEGER;
    r      RECORD;
BEGIN
    INSERT INTO validation_run (triggered_by, period_start, period_end)
    VALUES (p_user_id, p_start, p_end)
    RETURNING run_id INTO p_run_id;

    -- ---------- RST: minimum rest between two consecutive duties ----------
    SELECT * INTO v_rule FROM rule_definition WHERE rule_code = 'RST';
    IF v_rule.is_active THEN
        FOR r IN
            -- LAG reads the same crew member's previous duty, in time order
            SELECT d.*, fn_duty_hours(d.prev_end, d.duty_start_utc) AS rest_hours
            FROM (
                SELECT da.assignment_id, da.crew_id, da.duty_start_utc, da.duty_end_utc,
                       LAG(da.assignment_id)  OVER w AS prev_id,
                       LAG(da.duty_start_utc) OVER w AS prev_start,
                       LAG(da.duty_end_utc)   OVER w AS prev_end
                FROM duty_assignment da
                WINDOW w AS (PARTITION BY da.crew_id ORDER BY da.duty_start_utc)
            ) d
            WHERE d.prev_id IS NOT NULL
              AND d.duty_start_utc >= v_from AND d.duty_start_utc < v_to
              AND fn_duty_hours(d.prev_end, d.duty_start_utc) < v_rule.threshold_value
            ORDER BY d.crew_id, d.duty_start_utc
        LOOP
            INSERT INTO violation (run_id, rule_code, crew_id, severity, window_start, window_end,
                                   observed_value, threshold_value)
            VALUES (p_run_id, v_rule.rule_code, r.crew_id, v_rule.severity, r.prev_end, r.duty_start_utc,
                    r.rest_hours, v_rule.threshold_value)
            RETURNING violation_id INTO v_id;

            -- explanation: the two duties the short rest sits between
            INSERT INTO violation_assignment (violation_id, assignment_id, contribution_value)
            VALUES (v_id, r.prev_id,       fn_duty_hours(r.prev_start, r.prev_end)),
                   (v_id, r.assignment_id, fn_duty_hours(r.duty_start_utc, r.duty_end_utc));
        END LOOP;
    END IF;

    -- ---------- FDP: maximum length of a single duty ----------
    SELECT * INTO v_rule FROM rule_definition WHERE rule_code = 'FDP';
    IF v_rule.is_active THEN
        FOR r IN
            SELECT da.assignment_id, da.crew_id, da.duty_start_utc, da.duty_end_utc,
                   fn_duty_hours(da.duty_start_utc, da.duty_end_utc) AS hours
            FROM duty_assignment da
            WHERE da.duty_start_utc >= v_from AND da.duty_start_utc < v_to
              AND fn_duty_hours(da.duty_start_utc, da.duty_end_utc) > v_rule.threshold_value
            ORDER BY da.crew_id, da.duty_start_utc
        LOOP
            INSERT INTO violation (run_id, rule_code, crew_id, severity, window_start, window_end,
                                   observed_value, threshold_value)
            VALUES (p_run_id, v_rule.rule_code, r.crew_id, v_rule.severity, r.duty_start_utc, r.duty_end_utc,
                    r.hours, v_rule.threshold_value)
            RETURNING violation_id INTO v_id;

            INSERT INTO violation_assignment (violation_id, assignment_id, contribution_value)
            VALUES (v_id, r.assignment_id, r.hours);
        END LOOP;
    END IF;

    -- ---------- WDH: maximum duty hours in any rolling window ----------
    -- The window function gives every duty the total of that crew member's duties
    -- in the window ending at it. DISTINCT ON then keeps each crew member's single
    -- worst window (the earliest if tied), so one overworked week is ONE violation
    -- per crew per run, not one for every duty inside that week.
    SELECT * INTO v_rule FROM rule_definition WHERE rule_code = 'WDH';
    IF v_rule.is_active THEN
        FOR r IN
            SELECT DISTINCT ON (d.crew_id) d.crew_id, d.duty_start_utc, d.duty_end_utc, d.rolling_hours
            FROM (
                SELECT da.crew_id, da.duty_start_utc, da.duty_end_utc,
                       SUM(fn_duty_hours(da.duty_start_utc, da.duty_end_utc)) OVER (
                           PARTITION BY da.crew_id
                           ORDER BY da.duty_start_utc
                           RANGE BETWEEN make_interval(days => v_rule.window_days) PRECEDING AND CURRENT ROW
                       ) AS rolling_hours
                FROM duty_assignment da
            ) d
            WHERE d.duty_start_utc >= v_from AND d.duty_start_utc < v_to
              AND d.rolling_hours > v_rule.threshold_value
            ORDER BY d.crew_id, d.rolling_hours DESC, d.duty_start_utc
        LOOP
            INSERT INTO violation (run_id, rule_code, crew_id, severity, window_start, window_end,
                                   observed_value, threshold_value)
            VALUES (p_run_id, v_rule.rule_code, r.crew_id, v_rule.severity,
                    r.duty_start_utc - make_interval(days => v_rule.window_days), r.duty_end_utc,
                    r.rolling_hours, v_rule.threshold_value)
            RETURNING violation_id INTO v_id;

            -- explanation: every duty inside the window, each with its hours
            INSERT INTO violation_assignment (violation_id, assignment_id, contribution_value)
            SELECT v_id, da.assignment_id, fn_duty_hours(da.duty_start_utc, da.duty_end_utc)
            FROM duty_assignment da
            WHERE da.crew_id = r.crew_id
              AND da.duty_start_utc >= r.duty_start_utc - make_interval(days => v_rule.window_days)
              AND da.duty_start_utc <= r.duty_start_utc;
        END LOOP;
    END IF;

    -- ---------- CER: pilot must hold a valid type rating ----------
    -- Anti-join: no certificate covers this aircraft type on the duty date.
    -- A renewal is a separate row, so an expired certificate does not trigger this
    -- as long as a newer one covers the date. Cabin crew are exempt.
    SELECT * INTO v_rule FROM rule_definition WHERE rule_code = 'CER';
    IF v_rule.is_active THEN
        FOR r IN
            SELECT da.assignment_id, da.crew_id, da.duty_start_utc, da.duty_end_utc,
                   fn_duty_hours(da.duty_start_utc, da.duty_end_utc) AS hours
            FROM duty_assignment da
            JOIN flight f ON f.flight_id = da.flight_id
            WHERE da.duty_start_utc >= v_from AND da.duty_start_utc < v_to
              AND da.assigned_role <> 'CABIN_CREW'
              AND NOT EXISTS (
                  SELECT 1 FROM certification c
                  WHERE c.crew_id = da.crew_id
                    AND c.type_code = f.type_code
                    AND (da.duty_start_utc AT TIME ZONE 'UTC')::date BETWEEN c.issued_on AND c.expires_on)
            ORDER BY da.crew_id, da.duty_start_utc
        LOOP
            -- there is no number to compare here, so observed and threshold stay NULL
            INSERT INTO violation (run_id, rule_code, crew_id, severity, window_start, window_end)
            VALUES (p_run_id, v_rule.rule_code, r.crew_id, v_rule.severity, r.duty_start_utc, r.duty_end_utc)
            RETURNING violation_id INTO v_id;

            INSERT INTO violation_assignment (violation_id, assignment_id, contribution_value)
            VALUES (v_id, r.assignment_id, r.hours);
        END LOOP;
    END IF;

    -- trg_run_finish stamps finished_at; trg_violation_count already kept the count
    UPDATE validation_run SET status = 'COMPLETED' WHERE run_id = p_run_id;
END;
$$;

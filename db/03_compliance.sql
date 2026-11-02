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

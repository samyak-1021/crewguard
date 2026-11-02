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

-- =====================================================================
-- CrewGuard | 01_schema.sql
-- Tables, keys and constraints (the relational schema from Review 1).
--
-- Order matters: parent tables are created before the tables whose
-- foreign keys point at them.
-- =====================================================================

-- ---------------------------------------------------------------------
-- DROP: rebuild from zero every time this file runs.
-- CASCADE also drops the views, triggers and foreign keys that depend on
-- these tables.
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS violation_assignment, violation, validation_run,
                     rule_definition, duty_assignment, flight, certification,
                     crew_member, app_user, aircraft_type, airport CASCADE;

-- btree_gist lets a GiST index compare plain values (crew_id WITH =)
-- alongside ranges; the no-overlap EXCLUDE constraint needs it.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- =====================================================================
-- Master data
-- =====================================================================

CREATE TABLE airport (
    iata_code       CHAR(3)      PRIMARY KEY,
    name            VARCHAR(120) NOT NULL,
    city            VARCHAR(80)  NOT NULL,
    country         VARCHAR(80)  NOT NULL,
    timezone        VARCHAR(64)  NOT NULL,
    -- regex check: exactly three capital letters, e.g. BLR
    CONSTRAINT chk_airport_iata_format CHECK (iata_code ~ '^[A-Z]{3}$')
);

CREATE TABLE aircraft_type (
    type_code       VARCHAR(10)  PRIMARY KEY,
    manufacturer    VARCHAR(60)  NOT NULL,
    description     VARCHAR(160),
    CONSTRAINT chk_aircraft_type_upper CHECK (type_code = UPPER(type_code))
);

-- Application login accounts. Passwords are stored only as bcrypt hashes.
CREATE TABLE app_user (
    user_id         SERIAL       PRIMARY KEY,
    username        VARCHAR(50)  NOT NULL UNIQUE,
    password_hash   VARCHAR(255) NOT NULL,
    app_role        VARCHAR(20)  NOT NULL,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_app_role CHECK (app_role IN ('SCHEDULER', 'AUDITOR'))
);

-- =====================================================================
-- Crew and their type ratings
-- =====================================================================

CREATE TABLE crew_member (
    crew_id         SERIAL       PRIMARY KEY,
    employee_code   VARCHAR(20)  NOT NULL UNIQUE,
    first_name      VARCHAR(60)  NOT NULL,
    last_name       VARCHAR(60)  NOT NULL,
    crew_role       VARCHAR(20)  NOT NULL,
    home_base       CHAR(3)      NOT NULL,
    hire_date       DATE         NOT NULL,
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    -- an airport that is someone's home base cannot be deleted (RESTRICT)
    CONSTRAINT fk_crew_home_base FOREIGN KEY (home_base) REFERENCES airport(iata_code)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_crew_role CHECK (crew_role IN ('CAPTAIN', 'FIRST_OFFICER', 'CABIN_CREW')),
    CONSTRAINT chk_crew_hire_date CHECK (hire_date <= CURRENT_DATE)
);

-- A type rating: crew member X may operate aircraft type Y between two dates.
CREATE TABLE certification (
    cert_id         SERIAL       PRIMARY KEY,
    crew_id         INTEGER      NOT NULL,
    type_code       VARCHAR(10)  NOT NULL,
    issued_on       DATE         NOT NULL,
    expires_on      DATE         NOT NULL,
    -- deleting a crew member deletes their certificates (CASCADE)
    CONSTRAINT fk_cert_crew FOREIGN KEY (crew_id) REFERENCES crew_member(crew_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_cert_type FOREIGN KEY (type_code) REFERENCES aircraft_type(type_code)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    -- renewals are new rows, so (crew, type, issue date) is the natural key
    CONSTRAINT uk_cert_crew_type_issue UNIQUE (crew_id, type_code, issued_on),
    CONSTRAINT chk_cert_validity_order CHECK (expires_on > issued_on)
);

-- =====================================================================
-- Flights and the roster (who is on which flight)
-- =====================================================================

CREATE TABLE flight (
    flight_id       SERIAL       PRIMARY KEY,
    flight_number   VARCHAR(10)  NOT NULL,
    type_code       VARCHAR(10)  NOT NULL,
    dep_airport     CHAR(3)      NOT NULL,
    arr_airport     CHAR(3)      NOT NULL,
    sched_dep_utc   TIMESTAMPTZ  NOT NULL,
    sched_arr_utc   TIMESTAMPTZ  NOT NULL,
    CONSTRAINT fk_flight_type FOREIGN KEY (type_code) REFERENCES aircraft_type(type_code)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_flight_dep FOREIGN KEY (dep_airport) REFERENCES airport(iata_code)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_flight_arr FOREIGN KEY (arr_airport) REFERENCES airport(iata_code)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    -- the same flight number flies every day, so it is unique per departure
    CONSTRAINT uk_flight_number_dep UNIQUE (flight_number, sched_dep_utc),
    CONSTRAINT chk_flight_time_order CHECK (sched_arr_utc > sched_dep_utc),
    CONSTRAINT chk_flight_distinct_endpoints CHECK (dep_airport <> arr_airport)
);

-- One row = one crew member working one flight (one duty period).
-- Duty usually starts ~1 h before departure and ends ~30 min after arrival.
CREATE TABLE duty_assignment (
    assignment_id   SERIAL       PRIMARY KEY,
    crew_id         INTEGER      NOT NULL,
    flight_id       INTEGER      NOT NULL,
    assigned_role   VARCHAR(20)  NOT NULL,
    duty_start_utc  TIMESTAMPTZ  NOT NULL,
    duty_end_utc    TIMESTAMPTZ  NOT NULL,
    created_by      INTEGER,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_duty_crew FOREIGN KEY (crew_id) REFERENCES crew_member(crew_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_duty_flight FOREIGN KEY (flight_id) REFERENCES flight(flight_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    -- if the scheduler's account is removed, keep the duty but forget the author
    CONSTRAINT fk_duty_created_by FOREIGN KEY (created_by) REFERENCES app_user(user_id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT uk_duty_crew_flight UNIQUE (crew_id, flight_id),
    CONSTRAINT chk_duty_time_order CHECK (duty_end_utc > duty_start_utc),
    CONSTRAINT chk_duty_assigned_role CHECK (assigned_role IN ('CAPTAIN', 'FIRST_OFFICER', 'CABIN_CREW'))
);

-- ALTER: a crew member cannot be on two overlapping duties.
-- EXCLUDE rejects any two rows with the same crew_id (=) whose time ranges
-- overlap (&&). A plain UNIQUE or CHECK cannot express "overlap".
ALTER TABLE duty_assignment
    ADD CONSTRAINT excl_duty_no_overlap
    EXCLUDE USING GIST (
        crew_id WITH =,
        tstzrange(duty_start_utc, duty_end_utc) WITH &&
    );

-- =====================================================================
-- Compliance: rules, validation runs, violations and their explanation
-- =====================================================================

-- The regulation catalogue. Thresholds live in data, not in code, so a
-- limit can change without rewriting the validator.
CREATE TABLE rule_definition (
    rule_code       CHAR(3)      PRIMARY KEY,
    rule_name       VARCHAR(120) NOT NULL,
    description     TEXT         NOT NULL,
    regulation_ref  VARCHAR(120),
    threshold_value NUMERIC(8,2),
    threshold_unit  VARCHAR(20),
    window_days     INTEGER,
    severity        VARCHAR(10)  NOT NULL,
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    CONSTRAINT chk_rule_severity CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    CONSTRAINT chk_rule_window_days CHECK (window_days IS NULL OR window_days > 0)
);

-- One execution of the validator over a date range.
CREATE TABLE validation_run (
    run_id           SERIAL      PRIMARY KEY,
    triggered_by     INTEGER,
    period_start     DATE        NOT NULL,
    period_end       DATE        NOT NULL,
    started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at      TIMESTAMPTZ,
    status           VARCHAR(15) NOT NULL DEFAULT 'RUNNING',
    violations_found INTEGER     NOT NULL DEFAULT 0,
    CONSTRAINT fk_run_user FOREIGN KEY (triggered_by) REFERENCES app_user(user_id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT chk_run_status CHECK (status IN ('RUNNING', 'COMPLETED', 'FAILED', 'STALE')),
    CONSTRAINT chk_run_period_order CHECK (period_end >= period_start),
    CONSTRAINT chk_run_violation_count CHECK (violations_found >= 0)
);

-- One detected breach of one rule by one crew member in one run.
CREATE TABLE violation (
    violation_id    SERIAL       PRIMARY KEY,
    run_id          INTEGER      NOT NULL,
    rule_code       CHAR(3)      NOT NULL,
    crew_id         INTEGER      NOT NULL,
    severity        VARCHAR(10)  NOT NULL,
    window_start    TIMESTAMPTZ,
    window_end      TIMESTAMPTZ,
    observed_value  NUMERIC(8,2),
    threshold_value NUMERIC(8,2),
    evidence_doc_id VARCHAR(24),             -- MongoDB ObjectId of the evidence document
    CONSTRAINT fk_violation_run FOREIGN KEY (run_id) REFERENCES validation_run(run_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_violation_rule FOREIGN KEY (rule_code) REFERENCES rule_definition(rule_code)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_violation_crew FOREIGN KEY (crew_id) REFERENCES crew_member(crew_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT chk_violation_severity CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    CONSTRAINT chk_violation_window_order
        CHECK (window_end IS NULL OR window_start IS NULL OR window_end >= window_start)
);

-- M:N bridge, the "explanation": which duties caused which violation.
-- A violation can involve many duties (e.g. a 7-day total), and one duty can
-- take part in many violations (it may be both short-rest and over-hours).
CREATE TABLE violation_assignment (
    violation_id       INTEGER   NOT NULL,
    assignment_id      INTEGER   NOT NULL,
    contribution_value NUMERIC(8,2),         -- hours this duty contributed
    CONSTRAINT pk_violation_assignment PRIMARY KEY (violation_id, assignment_id),
    CONSTRAINT fk_va_violation FOREIGN KEY (violation_id) REFERENCES violation(violation_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_va_assignment FOREIGN KEY (assignment_id) REFERENCES duty_assignment(assignment_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);

-- =====================================================================
-- Indexes
-- PostgreSQL indexes primary keys and UNIQUE columns automatically.
-- Foreign keys are NOT indexed automatically, so the join and filter
-- columns used by the app are indexed here.
-- =====================================================================

-- composite: "all duties of crew X ordered by time" (roster, LAG/rolling-sum validator)
CREATE INDEX idx_duty_crew_start   ON duty_assignment (crew_id, duty_start_utc);
CREATE INDEX idx_duty_flight       ON duty_assignment (flight_id);
CREATE INDEX idx_flight_dep_time   ON flight (sched_dep_utc);
CREATE INDEX idx_cert_crew_type    ON certification (crew_id, type_code, expires_on);
CREATE INDEX idx_crew_home_base    ON crew_member (home_base);
CREATE INDEX idx_violation_run     ON violation (run_id);
CREATE INDEX idx_violation_crew    ON violation (crew_id);
CREATE INDEX idx_va_assignment     ON violation_assignment (assignment_id);

-- =====================================================================
-- Data dictionary: descriptions stored inside the database itself
-- (shown by \d+ in psql).
-- =====================================================================
COMMENT ON TABLE airport              IS 'Airports, identified by IATA code';
COMMENT ON TABLE aircraft_type        IS 'Aircraft types crew can be rated on';
COMMENT ON TABLE app_user             IS 'Login accounts (SCHEDULER manages the roster, AUDITOR checks compliance)';
COMMENT ON TABLE crew_member          IS 'Pilots and cabin crew';
COMMENT ON TABLE certification        IS 'Type ratings: which aircraft a crew member may operate, and until when';
COMMENT ON TABLE flight               IS 'Scheduled flights (times in UTC)';
COMMENT ON TABLE duty_assignment      IS 'Roster: one crew member working one flight';
COMMENT ON TABLE rule_definition      IS 'Regulatory rules and their thresholds';
COMMENT ON TABLE validation_run       IS 'One execution of the compliance validator';
COMMENT ON TABLE violation            IS 'A detected rule breach';
COMMENT ON TABLE violation_assignment IS 'Explanation: the duties that caused each violation (M:N)';

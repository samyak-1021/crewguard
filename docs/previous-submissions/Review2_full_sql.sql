-- =====================================================================
-- DBMS MINI PROJECT  |  CrewGuard
-- Regulatory Compliance Validation and Violation Explanation
-- for Airline Crew Rosters
--
-- GROUP:
--   PES2UG24CS436 : SAMYAK SANKLECHA
--   PES2UG24CS495 : SHRIRAM CHANDRASEKAR
--
-- RDBMS      : PostgreSQL 14+
-- DATABASE   : crewguard
--
-- HOW TO RUN
--   createdb crewguard            (or:  CREATE DATABASE crewguard;)
--   psql -d crewguard -f crewguard_sql_submission.sql
--   -- or paste one PART at a time into psql for screenshots
--
-- CONTENTS
--   PART A  Schema (DDL)                       PART I  Views
--   PART B  Sample data (DML / INSERT)         PART J  Functions
--   PART C  Basic retrieval (SELECT)           PART K  Triggers
--   PART D  UPDATE and DELETE                  PART L  Stored procedure
--   PART E  Joins                              PART M  CTEs + window functions
--   PART F  Aggregate functions                PART N  Full-text search
--   PART G  Subqueries                         PART O  Indexes + EXPLAIN
--   PART H  Set operations                     PART P  Constraint demos
-- =====================================================================


-- =====================================================================
-- PART A : SCHEMA (DDL)
-- ---------------------------------------------------------------------
-- This is the schema already created for the project. Uncomment the
-- reset block below only if you want to rebuild the database from zero.
-- =====================================================================

-- DROP TABLE IF EXISTS violation_assignment, violation, validation_run,
--      rule_definition, duty_assignment, flight, certification,
--      crew_member, app_user, aircraft_type, airport CASCADE;

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS airport (
    iata_code       CHAR(3)      PRIMARY KEY,
    name            VARCHAR(120) NOT NULL,
    city            VARCHAR(80)  NOT NULL,
    country         VARCHAR(80)  NOT NULL,
    timezone        VARCHAR(64)  NOT NULL,
    CONSTRAINT chk_airport_iata_format CHECK (iata_code ~ '^[A-Z]{3}$')
);

CREATE TABLE IF NOT EXISTS aircraft_type (
    type_code       VARCHAR(10)  PRIMARY KEY,
    manufacturer    VARCHAR(60)  NOT NULL,
    description     VARCHAR(160),
    CONSTRAINT chk_aircraft_type_upper CHECK (type_code = UPPER(type_code))
);

CREATE TABLE IF NOT EXISTS app_user (
    user_id         SERIAL       PRIMARY KEY,
    username        VARCHAR(50)  NOT NULL UNIQUE,
    password_hash   VARCHAR(255) NOT NULL,
    app_role        VARCHAR(20)  NOT NULL,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_app_role CHECK (app_role IN ('SCHEDULER', 'AUDITOR'))
);

CREATE TABLE IF NOT EXISTS crew_member (
    crew_id         SERIAL       PRIMARY KEY,
    employee_code   VARCHAR(20)  NOT NULL UNIQUE,
    first_name      VARCHAR(60)  NOT NULL,
    last_name       VARCHAR(60)  NOT NULL,
    crew_role       VARCHAR(20)  NOT NULL,
    home_base       CHAR(3)      NOT NULL,
    hire_date       DATE         NOT NULL,
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    CONSTRAINT fk_crew_home_base FOREIGN KEY (home_base) REFERENCES airport(iata_code)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_crew_role CHECK (crew_role IN ('CAPTAIN', 'FIRST_OFFICER', 'CABIN_CREW')),
    CONSTRAINT chk_crew_hire_date CHECK (hire_date <= CURRENT_DATE)
);

CREATE TABLE IF NOT EXISTS certification (
    cert_id         SERIAL       PRIMARY KEY,
    crew_id         INTEGER      NOT NULL,
    type_code       VARCHAR(10)  NOT NULL,
    issued_on       DATE         NOT NULL,
    expires_on      DATE         NOT NULL,
    CONSTRAINT fk_cert_crew FOREIGN KEY (crew_id) REFERENCES crew_member(crew_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_cert_type FOREIGN KEY (type_code) REFERENCES aircraft_type(type_code)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT uk_cert_crew_type_issue UNIQUE (crew_id, type_code, issued_on),
    CONSTRAINT chk_cert_validity_order CHECK (expires_on > issued_on)
);

CREATE TABLE IF NOT EXISTS flight (
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
    CONSTRAINT uk_flight_number_dep UNIQUE (flight_number, sched_dep_utc),
    CONSTRAINT chk_flight_time_order CHECK (sched_arr_utc > sched_dep_utc),
    CONSTRAINT chk_flight_distinct_endpoints CHECK (dep_airport <> arr_airport)
);

CREATE TABLE IF NOT EXISTS duty_assignment (
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
    CONSTRAINT fk_duty_created_by FOREIGN KEY (created_by) REFERENCES app_user(user_id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT uk_duty_crew_flight UNIQUE (crew_id, flight_id),
    CONSTRAINT chk_duty_time_order CHECK (duty_end_utc > duty_start_utc),
    CONSTRAINT chk_duty_assigned_role CHECK (assigned_role IN ('CAPTAIN', 'FIRST_OFFICER', 'CABIN_CREW'))
);

-- A crew member cannot be on two overlapping duties at the same time.
ALTER TABLE duty_assignment DROP CONSTRAINT IF EXISTS excl_duty_no_overlap;
ALTER TABLE duty_assignment
    ADD CONSTRAINT excl_duty_no_overlap
    EXCLUDE USING GIST (
        crew_id WITH =,
        tstzrange(duty_start_utc, duty_end_utc) WITH &&
    );

CREATE TABLE IF NOT EXISTS rule_definition (
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

CREATE TABLE IF NOT EXISTS validation_run (
    run_id          SERIAL       PRIMARY KEY,
    triggered_by    INTEGER,
    period_start    DATE         NOT NULL,
    period_end      DATE         NOT NULL,
    started_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    finished_at     TIMESTAMPTZ,
    status          VARCHAR(15)  NOT NULL DEFAULT 'RUNNING',
    violations_found INTEGER     NOT NULL DEFAULT 0,
    CONSTRAINT fk_run_user FOREIGN KEY (triggered_by) REFERENCES app_user(user_id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT chk_run_status CHECK (status IN ('RUNNING', 'COMPLETED', 'FAILED', 'STALE')),
    CONSTRAINT chk_run_period_order CHECK (period_end >= period_start),
    CONSTRAINT chk_run_violation_count CHECK (violations_found >= 0)
);

CREATE TABLE IF NOT EXISTS violation (
    violation_id    SERIAL       PRIMARY KEY,
    run_id          INTEGER      NOT NULL,
    rule_code       CHAR(3)      NOT NULL,
    crew_id         INTEGER      NOT NULL,
    severity        VARCHAR(10)  NOT NULL,
    window_start    TIMESTAMPTZ,
    window_end      TIMESTAMPTZ,
    observed_value  NUMERIC(8,2),
    threshold_value NUMERIC(8,2),
    evidence_doc_id VARCHAR(24),
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

CREATE TABLE IF NOT EXISTS violation_assignment (
    violation_id       INTEGER   NOT NULL,
    assignment_id      INTEGER   NOT NULL,
    contribution_value NUMERIC(8,2),
    CONSTRAINT pk_violation_assignment PRIMARY KEY (violation_id, assignment_id),
    CONSTRAINT fk_va_violation FOREIGN KEY (violation_id) REFERENCES violation(violation_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_va_assignment FOREIGN KEY (assignment_id) REFERENCES duty_assignment(assignment_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);

-- List all tables
-- \dt


-- =====================================================================
-- PART B : SAMPLE DATA  (INSERT)
-- ---------------------------------------------------------------------
-- Surrogate keys are inserted explicitly so that foreign keys stay
-- predictable; the sequences are re-synchronised at the end of this part.
-- =====================================================================

TRUNCATE violation_assignment, violation, validation_run, duty_assignment,
         certification, flight, crew_member, app_user, rule_definition,
         aircraft_type, airport RESTART IDENTITY CASCADE;

-- ---------- airport ----------
INSERT INTO airport (iata_code, name, city, country, timezone) VALUES
('BLR', 'Kempegowda International Airport',  'Bengaluru', 'India',                'Asia/Kolkata'),
('DEL', 'Indira Gandhi International Airport','Delhi',    'India',                'Asia/Kolkata'),
('BOM', 'Chhatrapati Shivaji Maharaj Intl',  'Mumbai',    'India',                'Asia/Kolkata'),
('MAA', 'Chennai International Airport',     'Chennai',   'India',                'Asia/Kolkata'),
('HYD', 'Rajiv Gandhi International Airport','Hyderabad', 'India',                'Asia/Kolkata'),
('DXB', 'Dubai International Airport',       'Dubai',     'United Arab Emirates', 'Asia/Dubai');

-- ---------- aircraft_type ----------
INSERT INTO aircraft_type (type_code, manufacturer, description) VALUES
('A320', 'Airbus', 'Airbus A320neo narrow-body'),
('A321', 'Airbus', 'Airbus A321neo narrow-body'),
('B738', 'Boeing', 'Boeing 737-800 narrow-body'),
('B788', 'Boeing', 'Boeing 787-8 wide-body');

-- ---------- app_user ----------
INSERT INTO app_user (user_id, username, password_hash, app_role) VALUES
(1, 'sched_anita',  '$2b$10$QxH1yq0b3eU0mXh5kP2u7e', 'SCHEDULER'),
(2, 'sched_vikram', '$2b$10$Lm9fR2sT4vW6xY8zA0bC1d', 'SCHEDULER'),
(3, 'audit_meera',  '$2b$10$Zn3pQ5rS7tU9vW1xY3zA5b', 'AUDITOR'),
(4, 'audit_rahul',  '$2b$10$Kj2hG4fD6sA8qW0eR2tY4u', 'AUDITOR');

-- ---------- crew_member ----------
INSERT INTO crew_member (crew_id, employee_code, first_name, last_name, crew_role, home_base, hire_date, is_active) VALUES
(1, 'EMP1001', 'Arjun',  'Menon',  'CAPTAIN',       'BLR', '2015-06-01', TRUE),
(2, 'EMP1002', 'Kavya',  'Sharma', 'CAPTAIN',       'BLR', '2017-03-15', TRUE),
(3, 'EMP1003', 'Rohan',  'Kumar',  'FIRST_OFFICER', 'BLR', '2019-07-10', TRUE),
(4, 'EMP1004', 'Sneha',  'Patil',  'FIRST_OFFICER', 'DEL', '2020-01-20', TRUE),
(5, 'EMP1005', 'Vikram', 'Joshi',  'CABIN_CREW',    'BLR', '2021-09-05', TRUE),
(6, 'EMP1006', 'Nisha',  'Shah',   'CABIN_CREW',    'DEL', '2022-02-11', TRUE),
(7, 'EMP1007', 'Aditya', 'Reddy',  'CAPTAIN',       'BOM', '2016-11-30', TRUE),
(8, 'EMP1008', 'Meera',  'Nair',   'CABIN_CREW',    'MAA', '2023-05-18', FALSE);

-- ---------- certification ----------
INSERT INTO certification (cert_id, crew_id, type_code, issued_on, expires_on) VALUES
(1, 1, 'A320', '2024-01-10', '2027-01-09'),
(2, 1, 'A321', '2024-02-15', '2027-02-14'),
(3, 2, 'A320', '2023-11-01', '2026-10-31'),
(4, 2, 'B738', '2025-01-05', '2028-01-04'),
(5, 3, 'A320', '2024-05-20', '2027-05-19'),
(6, 3, 'A321', '2025-06-18', '2028-06-17'),
(7, 4, 'B738', '2023-08-12', '2026-08-11'),   -- expired certificate
(8, 7, 'B788', '2024-03-01', '2027-02-28');

-- ---------- flight ----------
INSERT INTO flight (flight_id, flight_number, type_code, dep_airport, arr_airport, sched_dep_utc, sched_arr_utc) VALUES
(1,  'CG101', 'A320', 'BLR', 'DEL', '2026-09-01 01:00+00', '2026-09-01 03:45+00'),
(2,  'CG102', 'A320', 'DEL', 'BLR', '2026-09-01 05:30+00', '2026-09-01 08:15+00'),
(3,  'CG201', 'B738', 'BLR', 'BOM', '2026-09-02 02:00+00', '2026-09-02 03:45+00'),
(4,  'CG202', 'B738', 'BOM', 'BLR', '2026-09-02 05:00+00', '2026-09-02 06:45+00'),
(5,  'CG301', 'A321', 'BLR', 'MAA', '2026-09-03 01:30+00', '2026-09-03 02:40+00'),
(6,  'CG302', 'A321', 'MAA', 'BLR', '2026-09-03 04:00+00', '2026-09-03 05:10+00'),
(7,  'CG401', 'B788', 'BOM', 'DXB', '2026-09-04 18:00+00', '2026-09-04 21:30+00'),
(8,  'CG402', 'B788', 'DXB', 'BOM', '2026-09-05 01:00+00', '2026-09-05 04:30+00'),
(9,  'CG501', 'A320', 'BLR', 'HYD', '2026-09-06 02:00+00', '2026-09-06 03:00+00'),
(10, 'CG502', 'A320', 'HYD', 'BLR', '2026-09-06 04:30+00', '2026-09-06 05:30+00');

-- ---------- duty_assignment ----------
-- Duty starts 1 h before departure and ends 30 min after arrival.
INSERT INTO duty_assignment (assignment_id, crew_id, flight_id, assigned_role, duty_start_utc, duty_end_utc, created_by) VALUES
(1,  1, 1,  'CAPTAIN',       '2026-09-01 00:00+00', '2026-09-01 04:15+00', 1),
(2,  1, 2,  'CAPTAIN',       '2026-09-01 04:30+00', '2026-09-01 08:45+00', 1),
(3,  1, 5,  'CAPTAIN',       '2026-09-03 00:30+00', '2026-09-03 03:10+00', 1),
(4,  1, 6,  'CAPTAIN',       '2026-09-03 03:15+00', '2026-09-03 05:40+00', 1),
(5,  2, 3,  'CAPTAIN',       '2026-09-02 01:00+00', '2026-09-02 04:15+00', 1),
(6,  2, 4,  'CAPTAIN',       '2026-09-02 04:20+00', '2026-09-02 07:15+00', 1),
(7,  2, 9,  'CAPTAIN',       '2026-09-06 01:00+00', '2026-09-06 03:30+00', 2),
(8,  2, 10, 'CAPTAIN',       '2026-09-06 03:35+00', '2026-09-06 06:00+00', 2),
(9,  3, 1,  'FIRST_OFFICER', '2026-09-01 00:00+00', '2026-09-01 04:15+00', 1),
(10, 3, 2,  'FIRST_OFFICER', '2026-09-01 04:30+00', '2026-09-01 08:45+00', 1),
(11, 3, 3,  'FIRST_OFFICER', '2026-09-02 01:00+00', '2026-09-02 04:15+00', 1),
(12, 3, 4,  'FIRST_OFFICER', '2026-09-02 04:20+00', '2026-09-02 07:15+00', 1),
(13, 4, 5,  'FIRST_OFFICER', '2026-09-03 00:30+00', '2026-09-03 03:10+00', 2),
(14, 4, 6,  'FIRST_OFFICER', '2026-09-03 03:15+00', '2026-09-03 05:40+00', 2),
(15, 5, 1,  'CABIN_CREW',    '2026-09-01 00:00+00', '2026-09-01 04:15+00', 1),
(16, 5, 2,  'CABIN_CREW',    '2026-09-01 04:30+00', '2026-09-01 08:45+00', 1),
(17, 5, 9,  'CABIN_CREW',    '2026-09-06 01:00+00', '2026-09-06 03:30+00', 2),
(18, 5, 10, 'CABIN_CREW',    '2026-09-06 03:35+00', '2026-09-06 06:00+00', 2),
(19, 6, 3,  'CABIN_CREW',    '2026-09-02 01:00+00', '2026-09-02 04:15+00', 1),
(20, 6, 4,  'CABIN_CREW',    '2026-09-02 04:20+00', '2026-09-02 07:15+00', 1),
(21, 7, 7,  'CAPTAIN',       '2026-09-04 17:00+00', '2026-09-04 22:00+00', 2),
(22, 7, 8,  'CAPTAIN',       '2026-09-05 00:00+00', '2026-09-05 05:00+00', 2);

-- ---------- rule_definition ----------
INSERT INTO rule_definition (rule_code, rule_name, description, regulation_ref, threshold_value, threshold_unit, window_days, severity, is_active) VALUES
('RST', 'Minimum Rest Between Duties',
        'A crew member must receive a minimum continuous rest period between the end of one duty and the start of the next duty.',
        'DGCA CAR Section 7 Series J Part III', 10.00, 'HOURS', 1, 'HIGH', TRUE),
('FDP', 'Maximum Flight Duty Period',
        'The flight duty period of a single duty must not exceed the maximum permitted duration for the crew composition.',
        'DGCA CAR Section 7 Series J Part III', 13.00, 'HOURS', 1, 'CRITICAL', TRUE),
('WDH', 'Maximum Duty Hours in Seven Days',
        'Cumulative duty hours in any rolling window of seven consecutive days must not exceed the prescribed limit.',
        'DGCA CAR Section 7 Series J Part IV', 60.00, 'HOURS', 7, 'MEDIUM', TRUE),
('MDH', 'Maximum Duty Hours in Twenty Eight Days',
        'Cumulative duty hours in any rolling window of twenty eight consecutive days must not exceed the prescribed limit.',
        'DGCA CAR Section 7 Series J Part IV', 190.00, 'HOURS', 28, 'MEDIUM', TRUE),
('CER', 'Valid Type Certification Required',
        'A crew member must hold a valid and unexpired type certification for the aircraft type operated on the duty.',
        'DGCA CAR Section 2 Series X Part I', NULL, NULL, NULL, 'CRITICAL', TRUE),
('WOF', 'Weekly Day Off Required',
        'A crew member must be rostered at least one full day free of all duty in every seven day period.',
        'DGCA CAR Section 7 Series J Part IV', 1.00, 'DAYS', 7, 'LOW', FALSE);

-- ---------- validation_run ----------
INSERT INTO validation_run (run_id, triggered_by, period_start, period_end, started_at, finished_at, status, violations_found) VALUES
(1, 3, '2026-09-01', '2026-09-07', '2026-09-08 04:00+00', '2026-09-08 04:02+00', 'COMPLETED', 3),
(2, 4, '2026-09-08', '2026-09-14', '2026-09-15 04:00+00', '2026-09-15 04:01+00', 'COMPLETED', 0),
(3, 3, '2026-09-15', '2026-09-21', '2026-09-22 04:00+00', NULL,                  'RUNNING',   0);

-- ---------- violation ----------
INSERT INTO violation (violation_id, run_id, rule_code, crew_id, severity, window_start, window_end, observed_value, threshold_value, evidence_doc_id) VALUES
(1, 1, 'RST', 1, 'HIGH',     '2026-09-01 04:15+00', '2026-09-01 04:30+00',  0.25, 10.00, 'DOC-2026-0001'),
(2, 1, 'RST', 3, 'HIGH',     '2026-09-01 04:15+00', '2026-09-01 04:30+00',  0.25, 10.00, 'DOC-2026-0002'),
(3, 1, 'CER', 4, 'CRITICAL', '2026-09-03 00:30+00', '2026-09-03 05:40+00',  NULL,  NULL, 'DOC-2026-0003');

-- ---------- violation_assignment ----------
INSERT INTO violation_assignment (violation_id, assignment_id, contribution_value) VALUES
(1, 1,  4.25),
(1, 2,  4.25),
(2, 9,  4.25),
(2, 10, 4.25),
(3, 13, 2.67),
(3, 14, 2.42);

-- ---------- re-synchronise sequences ----------
SELECT setval('app_user_user_id_seq',             (SELECT MAX(user_id)       FROM app_user));
SELECT setval('crew_member_crew_id_seq',          (SELECT MAX(crew_id)       FROM crew_member));
SELECT setval('certification_cert_id_seq',        (SELECT MAX(cert_id)       FROM certification));
SELECT setval('flight_flight_id_seq',             (SELECT MAX(flight_id)     FROM flight));
SELECT setval('duty_assignment_assignment_id_seq',(SELECT MAX(assignment_id) FROM duty_assignment));
SELECT setval('validation_run_run_id_seq',        (SELECT MAX(run_id)        FROM validation_run));
SELECT setval('violation_violation_id_seq',       (SELECT MAX(violation_id)  FROM violation));

-- Row counts after loading
SELECT 'airport' AS table_name, COUNT(*) FROM airport
UNION ALL SELECT 'aircraft_type',        COUNT(*) FROM aircraft_type
UNION ALL SELECT 'app_user',             COUNT(*) FROM app_user
UNION ALL SELECT 'crew_member',          COUNT(*) FROM crew_member
UNION ALL SELECT 'certification',        COUNT(*) FROM certification
UNION ALL SELECT 'flight',               COUNT(*) FROM flight
UNION ALL SELECT 'duty_assignment',      COUNT(*) FROM duty_assignment
UNION ALL SELECT 'rule_definition',      COUNT(*) FROM rule_definition
UNION ALL SELECT 'validation_run',       COUNT(*) FROM validation_run
UNION ALL SELECT 'violation',            COUNT(*) FROM violation
UNION ALL SELECT 'violation_assignment', COUNT(*) FROM violation_assignment
ORDER BY 1;


-- =====================================================================
-- PART C : BASIC RETRIEVAL
-- =====================================================================

-- C1  Select all rows from a table
SELECT * FROM airport;
SELECT * FROM aircraft_type;
SELECT * FROM crew_member;
SELECT * FROM rule_definition;

-- C2  Projection of selected columns
SELECT crew_id, employee_code, first_name, last_name, crew_role, home_base
FROM crew_member;

-- C3  WHERE with equality
SELECT crew_id, first_name, last_name, home_base
FROM crew_member
WHERE crew_role = 'CAPTAIN';

-- C4  WHERE with a boolean column
SELECT employee_code, first_name, last_name
FROM crew_member
WHERE is_active = FALSE;

-- C5  DISTINCT
SELECT DISTINCT crew_role FROM crew_member;
SELECT DISTINCT type_code FROM flight;

-- C6  ORDER BY
SELECT employee_code, first_name, last_name, hire_date
FROM crew_member
ORDER BY hire_date ASC;

SELECT flight_number, dep_airport, arr_airport, sched_dep_utc
FROM flight
ORDER BY sched_dep_utc DESC;

-- C7  LIKE / ILIKE pattern matching
SELECT iata_code, name, city
FROM airport
WHERE name LIKE '%International%';

SELECT rule_code, rule_name
FROM rule_definition
WHERE rule_name ILIKE '%duty%';

-- C8  IN
SELECT flight_id, flight_number, dep_airport, arr_airport
FROM flight
WHERE dep_airport IN ('BLR', 'BOM');

SELECT rule_code, rule_name, severity
FROM rule_definition
WHERE severity IN ('HIGH', 'CRITICAL');

-- C9  BETWEEN
SELECT flight_number, sched_dep_utc, sched_arr_utc
FROM flight
WHERE sched_dep_utc BETWEEN '2026-09-01' AND '2026-09-04';

SELECT cert_id, crew_id, type_code, expires_on
FROM certification
WHERE expires_on BETWEEN '2026-01-01' AND '2026-12-31';

-- C10 IS NULL / IS NOT NULL
SELECT run_id, period_start, period_end, status, finished_at
FROM validation_run
WHERE finished_at IS NULL;

SELECT violation_id, rule_code, observed_value
FROM violation
WHERE observed_value IS NOT NULL;

-- C11 Compound conditions, computed column and LIMIT
SELECT flight_number,
       dep_airport || ' -> ' || arr_airport                      AS sector,
       sched_arr_utc - sched_dep_utc                             AS block_time
FROM flight
WHERE type_code = 'A320' AND dep_airport <> 'DEL'
ORDER BY sched_dep_utc
LIMIT 5;


-- =====================================================================
-- PART D : UPDATE AND DELETE
-- =====================================================================

-- D1  UPDATE a single row (RETURNING shows the changed row)
UPDATE crew_member
SET is_active = TRUE
WHERE crew_id = 8
RETURNING crew_id, employee_code, is_active;

-- D2  UPDATE using an expression
UPDATE flight
SET sched_arr_utc = sched_arr_utc + INTERVAL '20 minutes'
WHERE flight_id = 9
RETURNING flight_id, flight_number, sched_dep_utc, sched_arr_utc;

-- D3  UPDATE several rows at once
UPDATE rule_definition
SET is_active = TRUE
WHERE rule_code = 'WOF'
RETURNING rule_code, rule_name, is_active;

-- D4  UPDATE driven by a sub-query
UPDATE validation_run
SET status = 'STALE'
WHERE run_id IN (SELECT run_id FROM validation_run
                 WHERE status = 'RUNNING' AND started_at < NOW() - INTERVAL '1 day')
RETURNING run_id, status;

-- D5  DELETE a single row
DELETE FROM certification
WHERE cert_id = 6
RETURNING cert_id, crew_id, type_code;

-- D6  Verify the effect of the updates
SELECT crew_id, employee_code, is_active FROM crew_member WHERE crew_id = 8;
SELECT rule_code, is_active FROM rule_definition ORDER BY rule_code;
SELECT run_id, status, finished_at FROM validation_run ORDER BY run_id;


-- =====================================================================
-- PART E : JOINS
-- =====================================================================

-- E1  INNER JOIN - crew duty roster
SELECT da.assignment_id,
       cm.employee_code,
       cm.first_name || ' ' || cm.last_name AS crew_name,
       da.assigned_role,
       f.flight_number,
       f.dep_airport,
       f.arr_airport,
       da.duty_start_utc,
       da.duty_end_utc
FROM duty_assignment da
JOIN crew_member cm ON da.crew_id   = cm.crew_id
JOIN flight      f  ON da.flight_id = f.flight_id
ORDER BY da.duty_start_utc, cm.employee_code;

-- E2  Five table join - full operational picture of each duty
SELECT f.flight_number,
       dep.city  AS departure_city,
       arr.city  AS arrival_city,
       at.manufacturer || ' ' || at.type_code AS aircraft,
       cm.first_name || ' ' || cm.last_name   AS crew_name,
       da.assigned_role
FROM duty_assignment da
JOIN flight        f   ON da.flight_id  = f.flight_id
JOIN airport       dep ON f.dep_airport = dep.iata_code
JOIN airport       arr ON f.arr_airport = arr.iata_code
JOIN aircraft_type at  ON f.type_code   = at.type_code
JOIN crew_member   cm  ON da.crew_id    = cm.crew_id
ORDER BY f.sched_dep_utc, cm.employee_code;

-- E3  LEFT JOIN - every crew member, including those with no duty
SELECT cm.employee_code,
       cm.first_name || ' ' || cm.last_name AS crew_name,
       cm.crew_role,
       COUNT(da.assignment_id) AS duties_assigned
FROM crew_member cm
LEFT JOIN duty_assignment da ON cm.crew_id = da.crew_id
GROUP BY cm.crew_id, cm.employee_code, cm.first_name, cm.last_name, cm.crew_role
ORDER BY duties_assigned DESC, cm.employee_code;

-- E4  LEFT JOIN with IS NULL - crew holding no certification at all
SELECT cm.employee_code, cm.first_name, cm.last_name, cm.crew_role
FROM crew_member cm
LEFT JOIN certification c ON cm.crew_id = c.crew_id
WHERE c.cert_id IS NULL;

-- E5  Self join - crew members based at the same airport
SELECT a.employee_code AS crew_a,
       b.employee_code AS crew_b,
       a.home_base
FROM crew_member a
JOIN crew_member b
  ON a.home_base = b.home_base
 AND a.crew_id   < b.crew_id
ORDER BY a.home_base, crew_a, crew_b;

-- E6  Join across the whole violation chain (the explanation query)
SELECT v.violation_id,
       r.rule_name,
       v.severity,
       cm.employee_code,
       cm.first_name || ' ' || cm.last_name AS crew_name,
       f.flight_number,
       da.duty_start_utc,
       da.duty_end_utc,
       va.contribution_value
FROM violation v
JOIN rule_definition      r  ON v.rule_code     = r.rule_code
JOIN crew_member          cm ON v.crew_id       = cm.crew_id
JOIN violation_assignment va ON v.violation_id  = va.violation_id
JOIN duty_assignment      da ON va.assignment_id= da.assignment_id
JOIN flight               f  ON da.flight_id    = f.flight_id
ORDER BY v.violation_id, da.duty_start_utc;


-- =====================================================================
-- PART F : AGGREGATE FUNCTIONS, GROUP BY, HAVING
-- =====================================================================

-- F1  Simple counts
SELECT COUNT(*) AS total_crew          FROM crew_member;
SELECT COUNT(*) AS total_flights       FROM flight;
SELECT COUNT(*) AS total_assignments   FROM duty_assignment;
SELECT COUNT(*) AS active_rules        FROM rule_definition WHERE is_active;

-- F2  GROUP BY
SELECT crew_role, COUNT(*) AS crew_count
FROM crew_member
GROUP BY crew_role
ORDER BY crew_count DESC;

SELECT home_base, COUNT(*) AS crew_count
FROM crew_member
GROUP BY home_base
ORDER BY home_base;

SELECT type_code, COUNT(*) AS flights_operated
FROM flight
GROUP BY type_code
ORDER BY flights_operated DESC;

-- F3  SUM / AVG / MIN / MAX on duty hours
SELECT cm.employee_code,
       cm.first_name || ' ' || cm.last_name AS crew_name,
       COUNT(*)                                                                       AS duties,
       ROUND(SUM(EXTRACT(EPOCH FROM (da.duty_end_utc - da.duty_start_utc)) / 3600)::numeric, 2) AS total_duty_hours,
       ROUND(AVG(EXTRACT(EPOCH FROM (da.duty_end_utc - da.duty_start_utc)) / 3600)::numeric, 2) AS avg_duty_hours,
       ROUND(MAX(EXTRACT(EPOCH FROM (da.duty_end_utc - da.duty_start_utc)) / 3600)::numeric, 2) AS longest_duty_hours
FROM duty_assignment da
JOIN crew_member cm ON da.crew_id = cm.crew_id
GROUP BY cm.crew_id, cm.employee_code, cm.first_name, cm.last_name
ORDER BY total_duty_hours DESC;

-- F4  HAVING - crew with more than three duties
SELECT cm.employee_code, COUNT(*) AS duties
FROM duty_assignment da
JOIN crew_member cm ON da.crew_id = cm.crew_id
GROUP BY cm.employee_code
HAVING COUNT(*) > 3
ORDER BY duties DESC;

-- F5  HAVING on an aggregate expression - busiest sectors
SELECT dep_airport, arr_airport, COUNT(*) AS flights
FROM flight
GROUP BY dep_airport, arr_airport
HAVING COUNT(*) >= 1
ORDER BY flights DESC, dep_airport;

-- F6  Violations grouped by rule and by severity
SELECT v.rule_code, r.rule_name, COUNT(*) AS violations
FROM violation v
JOIN rule_definition r ON v.rule_code = r.rule_code
GROUP BY v.rule_code, r.rule_name
ORDER BY violations DESC;

SELECT severity, COUNT(*) AS violations
FROM violation
GROUP BY severity
ORDER BY violations DESC;

-- F7  Aggregate with a conditional expression
SELECT COUNT(*)                                                  AS total_certificates,
       COUNT(*) FILTER (WHERE expires_on < CURRENT_DATE)         AS expired,
       COUNT(*) FILTER (WHERE expires_on >= CURRENT_DATE)        AS valid
FROM certification;


-- =====================================================================
-- PART G : SUBQUERIES
-- =====================================================================

-- G1  Sub-query with IN - crew who have at least one duty
SELECT employee_code, first_name, last_name
FROM crew_member
WHERE crew_id IN (SELECT crew_id FROM duty_assignment);

-- G2  Sub-query with NOT IN - crew never rostered
SELECT employee_code, first_name, last_name
FROM crew_member
WHERE crew_id NOT IN (SELECT crew_id FROM duty_assignment);

-- G3  EXISTS - crew with at least one recorded violation
SELECT cm.employee_code, cm.first_name, cm.last_name
FROM crew_member cm
WHERE EXISTS (SELECT 1 FROM violation v WHERE v.crew_id = cm.crew_id);

-- G4  NOT EXISTS - aircraft types never flown
SELECT at.type_code, at.manufacturer
FROM aircraft_type at
WHERE NOT EXISTS (SELECT 1 FROM flight f WHERE f.type_code = at.type_code);

-- G5  Scalar sub-query in the SELECT list
SELECT f.flight_number,
       f.dep_airport,
       f.arr_airport,
       (SELECT COUNT(*) FROM duty_assignment da WHERE da.flight_id = f.flight_id) AS crew_on_board
FROM flight f
ORDER BY crew_on_board DESC, f.flight_number;

-- G6  Sub-query in WHERE with an aggregate
--     (the average of a DATE column is computed over the number of days)
SELECT employee_code, first_name, last_name, hire_date
FROM crew_member
WHERE hire_date < (SELECT DATE '2000-01-01' + AVG(hire_date - DATE '2000-01-01')::INTEGER
                   FROM crew_member)
ORDER BY hire_date;

-- G7  Correlated sub-query - the latest certificate of every crew member
SELECT c.cert_id, c.crew_id, c.type_code, c.issued_on, c.expires_on
FROM certification c
WHERE c.issued_on = (SELECT MAX(c2.issued_on)
                     FROM certification c2
                     WHERE c2.crew_id = c.crew_id)
ORDER BY c.crew_id;

-- G8  Derived table (sub-query in FROM)
SELECT t.employee_code, t.total_duty_hours
FROM (SELECT cm.employee_code,
             ROUND(SUM(EXTRACT(EPOCH FROM (da.duty_end_utc - da.duty_start_utc)) / 3600)::numeric, 2) AS total_duty_hours
      FROM duty_assignment da
      JOIN crew_member cm ON da.crew_id = cm.crew_id
      GROUP BY cm.employee_code) AS t
WHERE t.total_duty_hours > 10
ORDER BY t.total_duty_hours DESC;

-- G9  Flight crew who operated an aircraft type they are not certified for
--     (this is exactly what rule CER is meant to catch)
SELECT DISTINCT cm.employee_code,
       cm.first_name || ' ' || cm.last_name AS crew_name,
       f.type_code,
       f.flight_number
FROM duty_assignment da
JOIN crew_member cm ON da.crew_id   = cm.crew_id
JOIN flight      f  ON da.flight_id = f.flight_id
WHERE NOT EXISTS (
        SELECT 1
        FROM certification c
        WHERE c.crew_id   = da.crew_id
          AND c.type_code = f.type_code
          AND f.sched_dep_utc::date BETWEEN c.issued_on AND c.expires_on)
  AND cm.crew_role <> 'CABIN_CREW'
ORDER BY cm.employee_code, f.flight_number;


-- =====================================================================
-- PART H : SET OPERATIONS
-- =====================================================================

-- H1  UNION - every airport used as a departure or an arrival point
SELECT dep_airport AS airport_code, 'DEPARTURE' AS role FROM flight
UNION
SELECT arr_airport, 'ARRIVAL' FROM flight
ORDER BY airport_code, role;

-- H2  INTERSECT - airports that are both a crew base and a flight origin
SELECT home_base   FROM crew_member
INTERSECT
SELECT dep_airport FROM flight;

-- H3  EXCEPT - airports in the master table never used by any flight
SELECT iata_code FROM airport
EXCEPT
SELECT dep_airport FROM flight
EXCEPT
SELECT arr_airport FROM flight;


-- =====================================================================
-- PART I : VIEWS
-- =====================================================================

-- I1  Operational roster view
CREATE OR REPLACE VIEW v_duty_roster AS
SELECT da.assignment_id,
       cm.crew_id,
       cm.employee_code,
       cm.first_name || ' ' || cm.last_name AS crew_name,
       da.assigned_role,
       f.flight_number,
       f.dep_airport,
       f.arr_airport,
       f.sched_dep_utc,
       f.sched_arr_utc,
       da.duty_start_utc,
       da.duty_end_utc,
       ROUND((EXTRACT(EPOCH FROM (da.duty_end_utc - da.duty_start_utc)) / 3600)::numeric, 2) AS duty_hours
FROM duty_assignment da
JOIN crew_member cm ON da.crew_id   = cm.crew_id
JOIN flight      f  ON da.flight_id = f.flight_id;

SELECT * FROM v_duty_roster ORDER BY duty_start_utc LIMIT 10;

-- I2  Compliance report view
CREATE OR REPLACE VIEW v_violation_report AS
SELECT v.violation_id,
       vr.run_id,
       vr.period_start,
       vr.period_end,
       u.username            AS triggered_by,
       r.rule_code,
       r.rule_name,
       v.severity,
       cm.employee_code,
       cm.first_name || ' ' || cm.last_name AS crew_name,
       v.window_start,
       v.window_end,
       v.observed_value,
       v.threshold_value,
       v.evidence_doc_id
FROM violation v
JOIN validation_run  vr ON v.run_id    = vr.run_id
JOIN rule_definition r  ON v.rule_code = r.rule_code
JOIN crew_member     cm ON v.crew_id   = cm.crew_id
LEFT JOIN app_user   u  ON vr.triggered_by = u.user_id;

SELECT * FROM v_violation_report ORDER BY violation_id;

-- I3  Querying a view like a table
SELECT employee_code, COUNT(*) AS violations
FROM v_violation_report
GROUP BY employee_code
ORDER BY violations DESC;


-- =====================================================================
-- PART J : FUNCTIONS
-- =====================================================================

-- J1  Scalar function - duty length in minutes
CREATE OR REPLACE FUNCTION fn_duty_minutes(p_start TIMESTAMPTZ, p_end TIMESTAMPTZ)
RETURNS INTEGER
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
    RETURN (EXTRACT(EPOCH FROM (p_end - p_start)) / 60)::INTEGER;
END;
$$;

SELECT assignment_id,
       duty_start_utc,
       duty_end_utc,
       fn_duty_minutes(duty_start_utc, duty_end_utc) AS duty_minutes
FROM duty_assignment
ORDER BY assignment_id
LIMIT 10;

-- J2  Aggregate function - total duty hours of a crew member in a window
CREATE OR REPLACE FUNCTION fn_crew_duty_hours(p_crew_id INTEGER,
                                              p_from    TIMESTAMPTZ,
                                              p_to      TIMESTAMPTZ)
RETURNS NUMERIC
LANGUAGE plpgsql
AS $$
DECLARE
    v_hours NUMERIC(8,2);
BEGIN
    SELECT COALESCE(ROUND(SUM(EXTRACT(EPOCH FROM (duty_end_utc - duty_start_utc)) / 3600)::numeric, 2), 0)
      INTO v_hours
      FROM duty_assignment
     WHERE crew_id = p_crew_id
       AND duty_start_utc >= p_from
       AND duty_start_utc <  p_to;
    RETURN v_hours;
END;
$$;

SELECT cm.employee_code,
       fn_crew_duty_hours(cm.crew_id, '2026-09-01', '2026-09-08') AS duty_hours_week1
FROM crew_member cm
ORDER BY duty_hours_week1 DESC;

-- J3  Table valued function - the roster of one crew member
CREATE OR REPLACE FUNCTION fn_crew_roster(p_crew_id INTEGER)
RETURNS TABLE (flight_number  VARCHAR(10),
               sector         TEXT,
               duty_start_utc TIMESTAMPTZ,
               duty_end_utc   TIMESTAMPTZ,
               duty_hours     NUMERIC)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT f.flight_number,
           f.dep_airport || ' -> ' || f.arr_airport,
           da.duty_start_utc,
           da.duty_end_utc,
           ROUND((EXTRACT(EPOCH FROM (da.duty_end_utc - da.duty_start_utc)) / 3600)::numeric, 2)
    FROM duty_assignment da
    JOIN flight f ON da.flight_id = f.flight_id
    WHERE da.crew_id = p_crew_id
    ORDER BY da.duty_start_utc;
END;
$$;

SELECT * FROM fn_crew_roster(1);


-- =====================================================================
-- PART K : TRIGGERS
-- =====================================================================

-- K1  Keep validation_run.violations_found synchronised automatically
CREATE OR REPLACE FUNCTION trg_fn_sync_violation_count()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE validation_run
        SET violations_found = violations_found + 1
        WHERE run_id = NEW.run_id;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE validation_run
        SET violations_found = GREATEST(violations_found - 1, 0)
        WHERE run_id = OLD.run_id;
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_violation_count ON violation;
CREATE TRIGGER trg_violation_count
AFTER INSERT OR DELETE ON violation
FOR EACH ROW
EXECUTE FUNCTION trg_fn_sync_violation_count();

-- K2  Stamp finished_at automatically when a run is closed
CREATE OR REPLACE FUNCTION trg_fn_stamp_run_finish()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.status IN ('COMPLETED', 'FAILED') AND NEW.finished_at IS NULL THEN
        NEW.finished_at := NOW();
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_run_finish ON validation_run;
CREATE TRIGGER trg_run_finish
BEFORE UPDATE ON validation_run
FOR EACH ROW
EXECUTE FUNCTION trg_fn_stamp_run_finish();

-- K3  Demonstration of trigger K1 (counter goes up on INSERT)
SELECT run_id, status, violations_found FROM validation_run WHERE run_id = 2;

INSERT INTO violation (run_id, rule_code, crew_id, severity,
                       window_start, window_end, observed_value, threshold_value, evidence_doc_id)
VALUES (2, 'FDP', 7, 'CRITICAL',
        '2026-09-04 17:00+00', '2026-09-05 05:00+00', 12.00, 13.00, 'DOC-2026-0004')
RETURNING violation_id, run_id, rule_code;

SELECT run_id, status, violations_found FROM validation_run WHERE run_id = 2;

-- K4  Demonstration of trigger K1 (counter goes down on DELETE,
--     and ON DELETE CASCADE removes the dependent explanation rows)
SELECT COUNT(*) AS va_rows_before FROM violation_assignment WHERE violation_id = 3;

DELETE FROM violation WHERE violation_id = 3
RETURNING violation_id, run_id, rule_code;

SELECT COUNT(*) AS va_rows_after FROM violation_assignment WHERE violation_id = 3;
SELECT run_id, violations_found FROM validation_run WHERE run_id = 1;

-- K5  Demonstration of trigger K2 (finished_at filled in automatically)
SELECT run_id, status, finished_at FROM validation_run WHERE run_id = 3;

UPDATE validation_run SET status = 'COMPLETED' WHERE run_id = 3
RETURNING run_id, status, finished_at;


-- =====================================================================
-- PART L : STORED PROCEDURE  (the compliance validator)
-- ---------------------------------------------------------------------
-- sp_validate_rest_periods creates a validation run, scans every pair of
-- consecutive duties of each crew member inside the requested period,
-- records a violation whenever the rest between them is shorter than the
-- threshold of rule RST, links the two duties that caused it, and closes
-- the run. This is the core "detect and explain" workflow of CrewGuard.
-- =====================================================================

CREATE OR REPLACE PROCEDURE sp_validate_rest_periods(p_user_id      INTEGER,
                                                     p_period_start DATE,
                                                     p_period_end   DATE)
LANGUAGE plpgsql
AS $$
DECLARE
    v_run_id       INTEGER;
    v_threshold    NUMERIC(8,2);
    v_severity     VARCHAR(10);
    v_violation_id INTEGER;
    v_count        INTEGER := 0;
    r              RECORD;
BEGIN
    -- 1. read the rule that is being enforced
    SELECT threshold_value, severity
      INTO v_threshold, v_severity
      FROM rule_definition
     WHERE rule_code = 'RST' AND is_active;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Active rule RST is not defined';
    END IF;

    -- 2. open a validation run
    INSERT INTO validation_run (triggered_by, period_start, period_end, status)
    VALUES (p_user_id, p_period_start, p_period_end, 'RUNNING')
    RETURNING run_id INTO v_run_id;

    -- 3. scan consecutive duties of every crew member
    FOR r IN
        WITH ordered AS (
            SELECT da.assignment_id,
                   da.crew_id,
                   da.duty_start_utc,
                   da.duty_end_utc,
                   LAG(da.assignment_id)  OVER w AS prev_assignment_id,
                   LAG(da.duty_start_utc) OVER w AS prev_start,
                   LAG(da.duty_end_utc)   OVER w AS prev_end
            FROM duty_assignment da
            WHERE da.duty_start_utc >= p_period_start::timestamptz
              AND da.duty_start_utc <  (p_period_end + 1)::timestamptz
            WINDOW w AS (PARTITION BY da.crew_id ORDER BY da.duty_start_utc)
        )
        SELECT o.*,
               ROUND((EXTRACT(EPOCH FROM (o.duty_start_utc - o.prev_end)) / 3600)::numeric, 2) AS rest_hours
        FROM ordered o
        WHERE o.prev_end IS NOT NULL
          AND (EXTRACT(EPOCH FROM (o.duty_start_utc - o.prev_end)) / 3600) < v_threshold
        ORDER BY o.crew_id, o.duty_start_utc
    LOOP
        -- 3a. record the violation
        INSERT INTO violation (run_id, rule_code, crew_id, severity,
                               window_start, window_end,
                               observed_value, threshold_value, evidence_doc_id)
        VALUES (v_run_id, 'RST', r.crew_id, v_severity,
                r.prev_end, r.duty_start_utc,
                r.rest_hours, v_threshold,
                'RUN' || LPAD(v_run_id::text, 4, '0') || '-V' || LPAD((v_count + 1)::text, 4, '0'))
        RETURNING violation_id INTO v_violation_id;

        -- 3b. explain it: the two duties that produced the short rest
        INSERT INTO violation_assignment (violation_id, assignment_id, contribution_value)
        VALUES (v_violation_id, r.prev_assignment_id,
                ROUND((EXTRACT(EPOCH FROM (r.prev_end - r.prev_start)) / 3600)::numeric, 2)),
               (v_violation_id, r.assignment_id,
                ROUND((EXTRACT(EPOCH FROM (r.duty_end_utc - r.duty_start_utc)) / 3600)::numeric, 2));

        v_count := v_count + 1;
    END LOOP;

    -- 4. close the run
    UPDATE validation_run
    SET status           = 'COMPLETED',
        finished_at      = NOW(),
        violations_found = (SELECT COUNT(*) FROM violation WHERE run_id = v_run_id)
    WHERE run_id = v_run_id;

    RAISE NOTICE 'Validation run % completed: % violation(s) of rule RST detected',
                 v_run_id, v_count;
END;
$$;

-- L1  Execute the validator for the first week of September 2026
CALL sp_validate_rest_periods(3, DATE '2026-09-01', DATE '2026-09-07');

-- L2  The run that was just created
SELECT run_id, triggered_by, period_start, period_end, status, violations_found
FROM validation_run
ORDER BY run_id DESC
LIMIT 1;

-- L3  The violations the procedure detected
SELECT v.violation_id, cm.employee_code, v.severity,
       v.window_start, v.window_end,
       v.observed_value AS rest_hours,
       v.threshold_value AS required_hours
FROM violation v
JOIN crew_member cm ON v.crew_id = cm.crew_id
WHERE v.run_id = (SELECT MAX(run_id) FROM validation_run)
ORDER BY cm.employee_code, v.window_start;

-- L4  The explanation: which duties caused each violation
SELECT v.violation_id,
       cm.employee_code,
       f.flight_number,
       da.duty_start_utc,
       da.duty_end_utc,
       va.contribution_value AS duty_hours
FROM violation v
JOIN crew_member          cm ON v.crew_id        = cm.crew_id
JOIN violation_assignment va ON v.violation_id   = va.violation_id
JOIN duty_assignment      da ON va.assignment_id = da.assignment_id
JOIN flight               f  ON da.flight_id     = f.flight_id
WHERE v.run_id = (SELECT MAX(run_id) FROM validation_run)
ORDER BY v.violation_id, da.duty_start_utc;


-- =====================================================================
-- PART M : COMMON TABLE EXPRESSIONS AND WINDOW FUNCTIONS
-- =====================================================================

-- M1  Simple CTE - crew whose duty hours exceed the fleet average
WITH crew_hours AS (
    SELECT cm.crew_id,
           cm.employee_code,
           ROUND(SUM(EXTRACT(EPOCH FROM (da.duty_end_utc - da.duty_start_utc)) / 3600)::numeric, 2) AS total_hours
    FROM duty_assignment da
    JOIN crew_member cm ON da.crew_id = cm.crew_id
    GROUP BY cm.crew_id, cm.employee_code
)
SELECT employee_code, total_hours
FROM crew_hours
WHERE total_hours > (SELECT AVG(total_hours) FROM crew_hours)
ORDER BY total_hours DESC;

-- M2  Multiple CTEs chained together - violation load per crew member
WITH duty_load AS (
    SELECT crew_id, COUNT(*) AS duties
    FROM duty_assignment
    GROUP BY crew_id
),
violation_load AS (
    SELECT crew_id, COUNT(*) AS violations
    FROM violation
    GROUP BY crew_id
)
SELECT cm.employee_code,
       COALESCE(d.duties, 0)     AS duties,
       COALESCE(v.violations, 0) AS violations,
       ROUND(COALESCE(v.violations, 0)::numeric / NULLIF(d.duties, 0), 2) AS violations_per_duty
FROM crew_member cm
LEFT JOIN duty_load      d ON cm.crew_id = d.crew_id
LEFT JOIN violation_load v ON cm.crew_id = v.crew_id
ORDER BY violations DESC, duties DESC;

-- M3  Window functions - rank crew by duty hours
SELECT cm.employee_code,
       ROUND(SUM(EXTRACT(EPOCH FROM (da.duty_end_utc - da.duty_start_utc)) / 3600)::numeric, 2) AS total_hours,
       RANK() OVER (ORDER BY SUM(da.duty_end_utc - da.duty_start_utc) DESC) AS duty_rank
FROM duty_assignment da
JOIN crew_member cm ON da.crew_id = cm.crew_id
GROUP BY cm.employee_code
ORDER BY duty_rank;

-- M4  LAG - the rest period before each duty of every crew member
SELECT cm.employee_code,
       da.duty_start_utc,
       da.duty_end_utc,
       LAG(da.duty_end_utc) OVER (PARTITION BY da.crew_id ORDER BY da.duty_start_utc) AS previous_duty_end,
       ROUND((EXTRACT(EPOCH FROM (da.duty_start_utc -
              LAG(da.duty_end_utc) OVER (PARTITION BY da.crew_id ORDER BY da.duty_start_utc))) / 3600)::numeric, 2) AS rest_hours
FROM duty_assignment da
JOIN crew_member cm ON da.crew_id = cm.crew_id
ORDER BY cm.employee_code, da.duty_start_utc;

-- M5  Recursive CTE - duty count for every calendar day of a period
WITH RECURSIVE period(day) AS (
    SELECT DATE '2026-09-01'
    UNION ALL
    SELECT day + 1 FROM period WHERE day < DATE '2026-09-07'
)
SELECT p.day,
       COUNT(da.assignment_id) AS duties_that_day
FROM period p
LEFT JOIN duty_assignment da ON da.duty_start_utc::date = p.day
GROUP BY p.day
ORDER BY p.day;


-- =====================================================================
-- PART N : FULL-TEXT SEARCH
-- ---------------------------------------------------------------------
-- Regulation text is free text, so the rule catalogue is indexed with a
-- GIN inverted index over a tsvector built from the rule name and body.
-- =====================================================================

CREATE INDEX IF NOT EXISTS idx_rule_fts
    ON rule_definition
    USING GIN (to_tsvector('english', rule_name || ' ' || description));

-- N1  Search the regulation catalogue
SELECT rule_code, rule_name, severity
FROM rule_definition
WHERE to_tsvector('english', rule_name || ' ' || description)
      @@ plainto_tsquery('english', 'rest period');

SELECT rule_code, rule_name
FROM rule_definition
WHERE to_tsvector('english', rule_name || ' ' || description)
      @@ plainto_tsquery('english', 'certification aircraft');

-- N2  Boolean full-text query with ranking
SELECT rule_code,
       rule_name,
       ROUND(ts_rank(to_tsvector('english', rule_name || ' ' || description),
                     to_tsquery('english', 'duty & hours'))::numeric, 4) AS rank
FROM rule_definition
WHERE to_tsvector('english', rule_name || ' ' || description)
      @@ to_tsquery('english', 'duty & hours')
ORDER BY rank DESC;

-- N3  Highlighted snippet of the matching regulation text
SELECT rule_code,
       ts_headline('english', description, plainto_tsquery('english', 'rest')) AS matched_text
FROM rule_definition
WHERE to_tsvector('english', description) @@ plainto_tsquery('english', 'rest');


-- =====================================================================
-- PART O : INDEXES AND QUERY PLAN
-- =====================================================================

CREATE INDEX IF NOT EXISTS idx_duty_crew_start  ON duty_assignment (crew_id, duty_start_utc);
CREATE INDEX IF NOT EXISTS idx_duty_flight      ON duty_assignment (flight_id);
CREATE INDEX IF NOT EXISTS idx_violation_run    ON violation (run_id);
CREATE INDEX IF NOT EXISTS idx_violation_crew   ON violation (crew_id);
CREATE INDEX IF NOT EXISTS idx_flight_dep_time  ON flight (dep_airport, sched_dep_utc);

-- List the indexes of the schema
-- \di

ANALYZE;

EXPLAIN ANALYZE
SELECT da.assignment_id, da.duty_start_utc
FROM duty_assignment da
WHERE da.crew_id = 1
  AND da.duty_start_utc >= '2026-09-01'
  AND da.duty_start_utc <  '2026-09-08';


-- =====================================================================
-- PART P : CONSTRAINT AND INTEGRITY DEMONSTRATIONS
-- ---------------------------------------------------------------------
-- Every statement in this part is expected to FAIL. They prove that the
-- business rules are enforced by the database itself, not by the
-- application. Run them one at a time and screenshot the error.
-- =====================================================================

-- P1  UNIQUE violation - username already exists
-- INSERT INTO app_user (username, password_hash, app_role)
-- VALUES ('audit_meera', 'x', 'AUDITOR');

-- P2  CHECK violation - IATA code must be three capital letters
-- INSERT INTO airport (iata_code, name, city, country, timezone)
-- VALUES ('bl1', 'Bad Airport', 'Nowhere', 'India', 'Asia/Kolkata');

-- P3  CHECK violation - unknown crew role
-- INSERT INTO crew_member (employee_code, first_name, last_name, crew_role, home_base, hire_date)
-- VALUES ('EMP9999', 'Test', 'User', 'PILOT', 'BLR', '2024-01-01');

-- P4  FOREIGN KEY violation - unknown aircraft type
-- INSERT INTO flight (flight_number, type_code, dep_airport, arr_airport, sched_dep_utc, sched_arr_utc)
-- VALUES ('CG999', 'Z999', 'BLR', 'DEL', '2026-10-01 01:00+00', '2026-10-01 03:00+00');

-- P5  CHECK violation - a flight cannot depart from and arrive at the same airport
-- INSERT INTO flight (flight_number, type_code, dep_airport, arr_airport, sched_dep_utc, sched_arr_utc)
-- VALUES ('CG998', 'A320', 'BLR', 'BLR', '2026-10-01 01:00+00', '2026-10-01 03:00+00');

-- P6  EXCLUSION violation - the same crew member cannot be on two overlapping duties
-- INSERT INTO duty_assignment (crew_id, flight_id, assigned_role, duty_start_utc, duty_end_utc, created_by)
-- VALUES (1, 3, 'CAPTAIN', '2026-09-01 02:00+00', '2026-09-01 06:00+00', 1);

-- P7  CHECK violation - certificate expiry must be after the issue date
-- INSERT INTO certification (crew_id, type_code, issued_on, expires_on)
-- VALUES (1, 'B738', '2026-01-01', '2025-01-01');

-- P8  UNIQUE violation - a crew member cannot be assigned twice to one flight
-- INSERT INTO duty_assignment (crew_id, flight_id, assigned_role, duty_start_utc, duty_end_utc, created_by)
-- VALUES (1, 1, 'CAPTAIN', '2026-09-20 00:00+00', '2026-09-20 04:00+00', 1);

-- =====================================================================
-- END OF SCRIPT
-- =====================================================================

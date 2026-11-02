-- =====================================================================
-- CrewGuard | 02_roster.sql
-- Views, functions and the trigger used by the roster side of the app.
-- =====================================================================

-- ---------------------------------------------------------------------
-- FUNCTIONS
-- ---------------------------------------------------------------------

-- Scalar function: length of a duty in hours, rounded to 2 decimals.
-- IMMUTABLE = same input always gives the same output, so PostgreSQL may
-- cache or inline it.
CREATE OR REPLACE FUNCTION fn_duty_hours(p_start TIMESTAMPTZ, p_end TIMESTAMPTZ)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT ROUND((EXTRACT(EPOCH FROM (p_end - p_start)) / 3600)::numeric, 2);
$$;

-- Aggregate function: total duty hours of one crew member whose duties start
-- in [p_from, p_to). Used for the "last 7 days" figure on the crew page.
CREATE OR REPLACE FUNCTION fn_crew_duty_hours(p_crew_id INTEGER,
                                              p_from    TIMESTAMPTZ,
                                              p_to      TIMESTAMPTZ)
RETURNS NUMERIC
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE(SUM(fn_duty_hours(duty_start_utc, duty_end_utc)), 0)
    FROM duty_assignment
    WHERE crew_id = p_crew_id
      AND duty_start_utc >= p_from
      AND duty_start_utc <  p_to;
$$;

-- Table-valued function: the full roster of one crew member.
-- It returns a set of rows, so it can be used like a table:
--   SELECT * FROM fn_crew_roster(1);
CREATE OR REPLACE FUNCTION fn_crew_roster(p_crew_id INTEGER)
RETURNS TABLE (assignment_id  INTEGER,
               flight_id      INTEGER,
               flight_number  VARCHAR(10),
               type_code      VARCHAR(10),
               sector         TEXT,
               assigned_role  VARCHAR(20),
               duty_start_utc TIMESTAMPTZ,
               duty_end_utc   TIMESTAMPTZ,
               duty_hours     NUMERIC)
LANGUAGE sql
STABLE
AS $$
    SELECT da.assignment_id, f.flight_id, f.flight_number, f.type_code,
           f.dep_airport || ' → ' || f.arr_airport,
           da.assigned_role, da.duty_start_utc, da.duty_end_utc,
           fn_duty_hours(da.duty_start_utc, da.duty_end_utc)
    FROM duty_assignment da
    JOIN flight f ON f.flight_id = da.flight_id
    WHERE da.crew_id = p_crew_id
    ORDER BY da.duty_start_utc;
$$;

-- Certificate status on a given day: EXPIRED, EXPIRING (within 60 days) or VALID.
CREATE OR REPLACE FUNCTION fn_cert_status(p_expires_on DATE, p_on DATE DEFAULT CURRENT_DATE)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
    SELECT CASE
             WHEN p_expires_on <  p_on              THEN 'EXPIRED'
             WHEN p_expires_on <  p_on + 60         THEN 'EXPIRING'
             ELSE 'VALID'
           END;
$$;

-- ---------------------------------------------------------------------
-- VIEWS
-- A view is a stored SELECT. The app queries it like a table, so the join
-- logic is written once, inside the database.
-- ---------------------------------------------------------------------

-- Operational roster: every duty with crew and flight details (3-table join).
CREATE OR REPLACE VIEW v_duty_roster AS
SELECT da.assignment_id,
       cm.crew_id,
       cm.employee_code,
       cm.first_name || ' ' || cm.last_name AS crew_name,
       cm.home_base,
       da.assigned_role,
       f.flight_id,
       f.flight_number,
       f.type_code,
       f.dep_airport,
       f.arr_airport,
       f.sched_dep_utc,
       f.sched_arr_utc,
       da.duty_start_utc,
       da.duty_end_utc,
       fn_duty_hours(da.duty_start_utc, da.duty_end_utc) AS duty_hours
FROM duty_assignment da
JOIN crew_member cm ON cm.crew_id  = da.crew_id
JOIN flight      f  ON f.flight_id = da.flight_id;

-- One summary row per crew member: LEFT JOINs so crew with no duties or no
-- certificates still appear, plus GROUP BY aggregates.
-- Two separate sub-queries are joined (instead of joining duties and
-- certificates directly) so the counts do not multiply each other.
CREATE OR REPLACE VIEW v_crew_summary AS
SELECT cm.crew_id,
       cm.employee_code,
       cm.first_name,
       cm.last_name,
       cm.first_name || ' ' || cm.last_name AS crew_name,
       cm.crew_role,
       cm.home_base,
       cm.hire_date,
       cm.is_active,
       COALESCE(d.duty_count, 0)  AS duty_count,
       COALESCE(d.duty_hours, 0)  AS total_duty_hours,
       d.last_duty_end,
       COALESCE(c.valid_certs, 0) AS valid_certs
FROM crew_member cm
LEFT JOIN (
    SELECT crew_id,
           COUNT(*)::int                                     AS duty_count,
           SUM(fn_duty_hours(duty_start_utc, duty_end_utc))  AS duty_hours,
           MAX(duty_end_utc)                                 AS last_duty_end
    FROM duty_assignment
    GROUP BY crew_id
) d ON d.crew_id = cm.crew_id
LEFT JOIN (
    SELECT crew_id, COUNT(*)::int AS valid_certs
    FROM certification
    WHERE expires_on >= CURRENT_DATE
    GROUP BY crew_id
) c ON c.crew_id = cm.crew_id;

-- ---------------------------------------------------------------------
-- TRIGGER: business rules a CHECK constraint cannot express.
-- A CHECK can only look at the row being written. These rules need data
-- from OTHER tables (crew_member, flight), so a BEFORE trigger enforces them:
--   1. the crew member must be active
--   2. the assigned role must match the crew member's role
--   3. the duty must cover the whole flight (start <= departure, end >= arrival)
-- RAISE EXCEPTION aborts the INSERT/UPDATE, and the whole transaction with it.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_fn_validate_duty()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_crew   crew_member%ROWTYPE;
    v_flight flight%ROWTYPE;
BEGIN
    SELECT * INTO v_crew   FROM crew_member WHERE crew_id   = NEW.crew_id;
    SELECT * INTO v_flight FROM flight      WHERE flight_id = NEW.flight_id;

    IF NOT v_crew.is_active THEN
        RAISE EXCEPTION 'Crew member % is inactive and cannot be rostered', v_crew.employee_code
            USING ERRCODE = 'check_violation', CONSTRAINT = 'trg_duty_crew_active';
    END IF;

    IF NEW.assigned_role <> v_crew.crew_role THEN
        RAISE EXCEPTION 'Crew member % is a %, not a %',
                        v_crew.employee_code, v_crew.crew_role, NEW.assigned_role
            USING ERRCODE = 'check_violation', CONSTRAINT = 'trg_duty_role_match';
    END IF;

    IF NEW.duty_start_utc > v_flight.sched_dep_utc OR NEW.duty_end_utc < v_flight.sched_arr_utc THEN
        RAISE EXCEPTION 'Duty must start before departure and end after arrival of flight %',
                        v_flight.flight_number
            USING ERRCODE = 'check_violation', CONSTRAINT = 'trg_duty_covers_flight';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_duty ON duty_assignment;
CREATE TRIGGER trg_validate_duty
BEFORE INSERT OR UPDATE ON duty_assignment
FOR EACH ROW
EXECUTE FUNCTION trg_fn_validate_duty();

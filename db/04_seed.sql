-- =====================================================================
-- CrewGuard | 04_seed.sql
-- Sample data: a two-week roster (2–15 Nov 2026, times in UTC).
--
-- The roster is legal for most crew, but some breaches are planted on
-- purpose so the validator has something to find:
--   RST short rest   : Arjun, Rohan, Vikram (quick turnaround 2 Nov),
--                      Arjun, Vikram (9.8 h rest 4 Nov), Aditya, Priya (2 h rest 5 Nov)
--   CER bad rating   : Rohan flies B738 with no B738 rating,
--                      Sneha flies B738 on an expired rating
--   WDH 7-day hours  : Farhan, Karan, Nisha fly six 11 h long-haul duties in 6 days (66 h)
--   FDP long duty    : Aditya, Priya on a delayed BOM-LHR flight (14 h duty)
-- No validation runs or violations are seeded: the validator creates them.
-- =====================================================================

-- ---------- airport ----------
INSERT INTO airport (iata_code, name, city, country, timezone) VALUES
('BLR', 'Kempegowda International Airport',      'Bengaluru', 'India',                'Asia/Kolkata'),
('DEL', 'Indira Gandhi International Airport',   'Delhi',     'India',                'Asia/Kolkata'),
('BOM', 'Chhatrapati Shivaji Maharaj Intl',      'Mumbai',    'India',                'Asia/Kolkata'),
('MAA', 'Chennai International Airport',         'Chennai',   'India',                'Asia/Kolkata'),
('HYD', 'Rajiv Gandhi International Airport',    'Hyderabad', 'India',                'Asia/Kolkata'),
('CCU', 'Netaji Subhas Chandra Bose Intl',       'Kolkata',   'India',                'Asia/Kolkata'),
('DXB', 'Dubai International Airport',           'Dubai',     'United Arab Emirates', 'Asia/Dubai'),
('LHR', 'London Heathrow Airport',               'London',    'United Kingdom',       'Europe/London');

-- ---------- aircraft_type ----------
INSERT INTO aircraft_type (type_code, manufacturer, description) VALUES
('A320', 'Airbus', 'Airbus A320neo narrow-body'),
('A321', 'Airbus', 'Airbus A321neo narrow-body'),
('B738', 'Boeing', 'Boeing 737-800 narrow-body'),
('B788', 'Boeing', 'Boeing 787-8 Dreamliner wide-body');

-- ---------- app_user ----------
-- Demo accounts (passwords: Sam@123 and Shriram@123).
-- Only bcrypt hashes are stored; each hash includes its own random salt.
INSERT INTO app_user (user_id, username, password_hash, app_role) VALUES
(1, 'sched_sam',     '$2b$10$cwu/pvgdqv2C95XdPtGVUuxjRJHuLDi5K0gYnnFfQnQki6lkuBAlC', 'SCHEDULER'),
(2, 'audit_shriram', '$2b$10$5bokBBUTwKn8PqLJFAEPN.vewwqJNS.MgS2S3b1pQ4p0QtPX2mZzm', 'AUDITOR');

-- ---------- crew_member ----------
INSERT INTO crew_member (crew_id, employee_code, first_name, last_name, crew_role, home_base, hire_date, is_active) VALUES
(1,  'EMP1001', 'Arjun',  'Menon',    'CAPTAIN',       'BLR', '2015-06-01', TRUE),
(2,  'EMP1002', 'Kavya',  'Sharma',   'CAPTAIN',       'BLR', '2017-03-15', TRUE),
(3,  'EMP1003', 'Rohan',  'Kumar',    'FIRST_OFFICER', 'BLR', '2019-07-10', TRUE),
(4,  'EMP1004', 'Sneha',  'Patil',    'FIRST_OFFICER', 'DEL', '2020-01-20', TRUE),
(5,  'EMP1005', 'Vikram', 'Joshi',    'CABIN_CREW',    'BLR', '2021-09-05', TRUE),
(6,  'EMP1006', 'Nisha',  'Shah',     'CABIN_CREW',    'DEL', '2022-02-11', TRUE),
(7,  'EMP1007', 'Aditya', 'Reddy',    'CAPTAIN',       'BOM', '2016-11-30', TRUE),
(8,  'EMP1008', 'Meera',  'Nair',     'CABIN_CREW',    'MAA', '2023-05-18', FALSE),
(9,  'EMP1009', 'Farhan', 'Ali',      'CAPTAIN',       'DEL', '2014-04-12', TRUE),
(10, 'EMP1010', 'Priya',  'Iyer',     'FIRST_OFFICER', 'BOM', '2020-08-03', TRUE),
(11, 'EMP1011', 'Karan',  'Mehta',    'FIRST_OFFICER', 'DEL', '2021-01-25', TRUE),
(12, 'EMP1012', 'Ananya', 'Rao',      'CABIN_CREW',    'BLR', '2022-10-01', TRUE),
(13, 'EMP1013', 'Dev',    'Malhotra', 'FIRST_OFFICER', 'HYD', '2025-07-14', TRUE);

-- ---------- certification ----------
-- Cabin crew need no type rating. Dev (13) is a new pilot with none yet.
INSERT INTO certification (cert_id, crew_id, type_code, issued_on, expires_on) VALUES
(1,  1,  'A320', '2024-01-10', '2027-01-09'),
(2,  1,  'A321', '2024-02-15', '2026-12-20'),   -- expiring soon
(3,  2,  'A320', '2023-11-01', '2026-10-31'),   -- expired, but ...
(4,  2,  'A320', '2026-10-20', '2029-10-19'),   -- ... renewed before it lapsed
(5,  2,  'B738', '2025-01-05', '2028-01-04'),
(6,  3,  'A320', '2024-05-20', '2027-05-19'),
(7,  3,  'A321', '2025-06-18', '2028-06-17'),   -- no B738 rating
(8,  4,  'B738', '2023-08-12', '2026-08-11'),   -- expired
(9,  7,  'B788', '2024-03-01', '2027-02-28'),
(10, 9,  'B788', '2024-06-01', '2027-05-31'),
(11, 9,  'A320', '2022-01-01', '2025-01-01'),   -- old, expired
(12, 10, 'B788', '2025-04-01', '2028-03-31'),
(13, 11, 'B788', '2025-02-10', '2026-12-31');   -- expiring soon

-- ---------- flight ----------
INSERT INTO flight (flight_id, flight_number, type_code, dep_airport, arr_airport, sched_dep_utc, sched_arr_utc) VALUES
-- week 1, domestic and regional
(1,  'CG101', 'A320', 'BLR', 'DEL', '2026-11-02 01:00+00', '2026-11-02 03:45+00'),
(2,  'CG102', 'A320', 'DEL', 'BLR', '2026-11-02 05:30+00', '2026-11-02 08:15+00'),
(3,  'CG201', 'B738', 'BLR', 'BOM', '2026-11-03 02:00+00', '2026-11-03 03:45+00'),
(4,  'CG202', 'B738', 'BOM', 'BLR', '2026-11-03 16:00+00', '2026-11-03 17:45+00'),
(5,  'CG301', 'A321', 'BLR', 'MAA', '2026-11-04 01:30+00', '2026-11-04 02:40+00'),
(6,  'CG302', 'A321', 'MAA', 'BLR', '2026-11-04 14:00+00', '2026-11-04 15:10+00'),
(7,  'CG401', 'B788', 'BOM', 'DXB', '2026-11-04 18:00+00', '2026-11-04 21:30+00'),
(8,  'CG402', 'B788', 'DXB', 'BOM', '2026-11-05 01:00+00', '2026-11-05 04:30+00'),
(9,  'CG501', 'A320', 'BLR', 'HYD', '2026-11-06 02:00+00', '2026-11-06 03:00+00'),
(10, 'CG502', 'A320', 'HYD', 'BLR', '2026-11-06 16:00+00', '2026-11-06 17:00+00'),
-- week 1, daily Delhi-London rotation
(11, 'CG111', 'B788', 'DEL', 'LHR', '2026-11-02 01:00+00', '2026-11-02 10:30+00'),
(12, 'CG112', 'B788', 'LHR', 'DEL', '2026-11-03 01:00+00', '2026-11-03 10:30+00'),
(13, 'CG111', 'B788', 'DEL', 'LHR', '2026-11-04 01:00+00', '2026-11-04 10:30+00'),
(14, 'CG112', 'B788', 'LHR', 'DEL', '2026-11-05 01:00+00', '2026-11-05 10:30+00'),
(15, 'CG111', 'B788', 'DEL', 'LHR', '2026-11-06 01:00+00', '2026-11-06 10:30+00'),
(16, 'CG112', 'B788', 'LHR', 'DEL', '2026-11-07 01:00+00', '2026-11-07 10:30+00'),
-- week 2
(17, 'CG131', 'B788', 'BOM', 'LHR', '2026-11-09 02:00+00', '2026-11-09 12:00+00'),
(18, 'CG132', 'B788', 'LHR', 'BOM', '2026-11-11 02:00+00', '2026-11-11 11:30+00'),
(19, 'CG211', 'B738', 'DEL', 'BOM', '2026-11-09 03:00+00', '2026-11-09 05:10+00'),
(20, 'CG212', 'B738', 'BOM', 'DEL', '2026-11-10 03:00+00', '2026-11-10 05:10+00'),
(21, 'CG101', 'A320', 'BLR', 'DEL', '2026-11-10 01:00+00', '2026-11-10 03:45+00'),
(22, 'CG102', 'A320', 'DEL', 'BLR', '2026-11-10 16:00+00', '2026-11-10 18:45+00'),
(23, 'CG301', 'A321', 'BLR', 'MAA', '2026-11-12 01:30+00', '2026-11-12 02:40+00'),
(24, 'CG302', 'A321', 'MAA', 'BLR', '2026-11-12 15:00+00', '2026-11-12 16:10+00');

-- ---------- duty_assignment ----------
-- INSERT ... SELECT: instead of typing 62 timestamps by hand, each duty is
-- derived from its flight. Duty = 1 h before departure to 30 min after
-- arrival, plus any delay. The role comes from the crew member's own role.
-- Every row still passes the constraints and the trg_validate_duty trigger.
INSERT INTO duty_assignment (crew_id, flight_id, assigned_role, duty_start_utc, duty_end_utc, created_by)
SELECT r.crew_id,
       f.flight_id,
       cm.crew_role,
       f.sched_dep_utc - INTERVAL '1 hour',
       f.sched_arr_utc + INTERVAL '30 minutes' + r.delay,
       1                                                            -- rostered by sched_sam
FROM (VALUES
    -- (flight_id, crew_id, extra delay)
    (1, 1, INTERVAL '0'), (1, 3, INTERVAL '0'), (1, 5, INTERVAL '0'),
    (2, 1, INTERVAL '0'), (2, 3, INTERVAL '0'), (2, 5, INTERVAL '0'),
    (3, 2, INTERVAL '0'), (3, 3, INTERVAL '0'), (3, 12, INTERVAL '0'),
    (4, 2, INTERVAL '0'), (4, 3, INTERVAL '0'), (4, 12, INTERVAL '0'),
    (5, 1, INTERVAL '0'), (5, 5, INTERVAL '0'),
    (6, 1, INTERVAL '0'), (6, 5, INTERVAL '0'),
    (7, 7, INTERVAL '0'), (7, 10, INTERVAL '0'),
    (8, 7, INTERVAL '0'), (8, 10, INTERVAL '0'),
    (9, 2, INTERVAL '0'), (9, 12, INTERVAL '0'),
    (10, 2, INTERVAL '0'), (10, 12, INTERVAL '0'),
    (11, 9, INTERVAL '0'), (11, 11, INTERVAL '0'), (11, 6, INTERVAL '0'),
    (12, 9, INTERVAL '0'), (12, 11, INTERVAL '0'), (12, 6, INTERVAL '0'),
    (13, 9, INTERVAL '0'), (13, 11, INTERVAL '0'), (13, 6, INTERVAL '0'),
    (14, 9, INTERVAL '0'), (14, 11, INTERVAL '0'), (14, 6, INTERVAL '0'),
    (15, 9, INTERVAL '0'), (15, 11, INTERVAL '0'), (15, 6, INTERVAL '0'),
    (16, 9, INTERVAL '0'), (16, 11, INTERVAL '0'), (16, 6, INTERVAL '0'),
    (17, 7, INTERVAL '2 hours 30 minutes'), (17, 10, INTERVAL '2 hours 30 minutes'),  -- delayed: 14 h duty
    (18, 7, INTERVAL '0'), (18, 10, INTERVAL '0'),
    (19, 2, INTERVAL '0'), (19, 4, INTERVAL '0'), (19, 6, INTERVAL '0'),
    (20, 2, INTERVAL '0'), (20, 4, INTERVAL '0'), (20, 6, INTERVAL '0'),
    (21, 1, INTERVAL '0'), (21, 3, INTERVAL '0'), (21, 5, INTERVAL '0'),
    (22, 1, INTERVAL '0'), (22, 3, INTERVAL '0'), (22, 5, INTERVAL '0'),
    (23, 1, INTERVAL '0'), (23, 3, INTERVAL '0'),
    (24, 1, INTERVAL '0'), (24, 3, INTERVAL '0')
) AS r(flight_id, crew_id, delay)
JOIN flight      f  ON f.flight_id = r.flight_id
JOIN crew_member cm ON cm.crew_id  = r.crew_id
ORDER BY f.flight_id, r.crew_id;

-- ---------- rule_definition ----------
INSERT INTO rule_definition (rule_code, rule_name, description, regulation_ref, threshold_value, threshold_unit, window_days, severity, is_active) VALUES
('RST', 'Minimum Rest Between Duties',
        'A crew member must receive a minimum continuous rest period between the end of one duty and the start of the next duty, so that fatigue from one duty does not carry into the next.',
        'DGCA CAR Section 7 Series J Part III', 10.00, 'HOURS', NULL, 'HIGH', TRUE),
('FDP', 'Maximum Flight Duty Period',
        'A single flight duty period, measured from report time before departure until release after arrival, must not exceed the maximum permitted duration, including delays.',
        'DGCA CAR Section 7 Series J Part III', 13.00, 'HOURS', NULL, 'CRITICAL', TRUE),
('WDH', 'Maximum Duty Hours in Seven Days',
        'Cumulative duty hours in any rolling window of seven consecutive days must not exceed the prescribed limit, which guards against fatigue that builds up over a week.',
        'DGCA CAR Section 7 Series J Part IV', 60.00, 'HOURS', 7, 'MEDIUM', TRUE),
('CER', 'Valid Type Certification Required',
        'A pilot must hold a valid and unexpired type rating certificate for the aircraft type operated on the duty. Cabin crew are exempt from this rule.',
        'DGCA CAR Section 2 Series X Part I', NULL, NULL, NULL, 'CRITICAL', TRUE);

-- ---------- re-synchronise sequences ----------
-- Rows above were inserted with explicit ids, so each SERIAL sequence is moved
-- past the highest id; the next INSERT from the app then gets a fresh id.
SELECT setval('app_user_user_id_seq',       (SELECT MAX(user_id)   FROM app_user));
SELECT setval('crew_member_crew_id_seq',    (SELECT MAX(crew_id)   FROM crew_member));
SELECT setval('certification_cert_id_seq',  (SELECT MAX(cert_id)   FROM certification));
SELECT setval('flight_flight_id_seq',       (SELECT MAX(flight_id) FROM flight));

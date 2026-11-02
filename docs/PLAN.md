# CrewGuard — Final Project Plan (Level 3)

**Group G22** — PES2UG24CS436 Samyak Sanklecha · PES2UG24CS495 Shriram Chandrasekar

## 1. What the project is

Airlines publish crew rosters (who flies which flight, when). A roster can be fully
staffed and still be **illegal**: aviation regulators (DGCA in India) limit how long crew
may work and how much rest they must get. Most of these rules cannot be checked by
looking at one flight; they depend on *time windows* across many duties
(e.g. "no more than 60 duty hours in any 7 consecutive days").

**CrewGuard** stores the roster in PostgreSQL, runs a validator that **detects** rule
violations, and **explains** each violation by linking it to the exact duties that caused
it. Rule-specific evidence and an activity log are stored in MongoDB, and its
aggregation pipelines feed the analytics dashboard.

It is a *detector and explainer*, not a roster generator.

## 2. Databases and why

| Data | Store | Why this store |
|---|---|---|
| Airports, aircraft types, crew, certifications, flights, duties, rules, runs, violations | **PostgreSQL** | Highly relational, needs FKs, CHECK/UNIQUE/EXCLUSION constraints, transactions and temporal SQL (window functions over time) |
| Violation evidence (`violation_evidence`) | **MongoDB** | The shape of the evidence differs per rule (rest gap vs. 7-day hour breakdown vs. certificate details), so a flexible document fits better than many nullable columns |
| Activity log (`audit_log`) | **MongoDB** | Append-only, write-heavy, variable payload per action; never joined |

Postgres stores the Mongo `_id` (24 hex chars) in `violation.evidence_doc_id`, which links the two.

## 3. Compliance rules (all actually implemented)

| Code | Rule | Threshold | How it is detected |
|---|---|---|---|
| RST | Minimum rest between duties | 10 h | `LAG()` window function over each crew member's duties |
| FDP | Maximum single flight-duty period | 13 h | Duty length > threshold |
| WDH | Maximum duty hours in any rolling 7 days | 60 h | `SUM() OVER (... RANGE INTERVAL '7 days' PRECEDING)` |
| CER | Valid type certification (pilots only) | — | Anti-join: no valid cert for the flight's aircraft type on the duty date |
| — | No overlapping duties | — | **Prevented** (not detected) by the `EXCLUDE USING GIST` constraint |

## 4. Database design (PostgreSQL)

11 tables, same as Review 1 (so the ER diagram and relational schema still hold):
`airport, aircraft_type, app_user, crew_member, certification, flight,
duty_assignment, rule_definition, validation_run, violation, violation_assignment`.

The core M:N relationship is `violation ↔ duty_assignment` through `violation_assignment`.
It answers "which flights caused this violation?".

Schema change after Review 1 (done with `ALTER TABLE`): violations get a review
workflow (`review_status`, `reviewed_by`, `review_note`, `reviewed_at`).

### Guideline checklist → where it is

| Guideline item | Where |
|---|---|
| CREATE / ALTER / DROP | `db/01_schema.sql` (DROP … IF EXISTS reset, CREATE TABLE, ALTER TABLE ADD CONSTRAINT), `db/03_compliance.sql` (ALTER TABLE ADD COLUMN) |
| PK / FK / constraints | every table: PK, FK with ON DELETE/UPDATE actions, CHECK, UNIQUE, NOT NULL, EXCLUSION |
| Indexes | B-tree (FK and lookup columns), GiST (exclusion), GIN (full-text) |
| Views | `v_duty_roster`, `v_crew_summary` (Part 1), `v_violation_report` (Part 2) |
| INSERT / UPDATE / DELETE / SELECT | the whole app (roster forms, review workflow) plus `db/04_seed.sql` |
| JOIN / GROUP BY / HAVING / ORDER BY / aggregates / subqueries | repository SQL in `lib/repo/*`, collected in `db/queries.sql` for the report |
| Transactions | multi-crew assignment (all-or-nothing) and the validation run (BEGIN/COMMIT/ROLLBACK) |
| Functions | `fn_duty_hours`, `fn_crew_duty_hours`, `fn_crew_roster` (table-valued), `fn_cert_status` |
| Stored procedure | `sp_run_validation` (the validator: RST, FDP, WDH, CER) |
| Triggers | `trg_validate_duty` (Part 1: active crew, role match, duty covers flight); violation-count sync, run finish-stamp, review stamp (Part 2) |
| Full-text search | GIN index plus `to_tsvector` / `ts_rank` on the rule catalogue |
| NoSQL aggregation | MongoDB `$group` / `$match` pipelines on the dashboard |
| Auth plus 2 roles | SCHEDULER (manages the roster), AUDITOR (runs validations, reviews violations) |
| Passwords not plain text | bcrypt hashes in `app_user.password_hash` |
| Credentials not hard-coded | `.env.local` (git-ignored); `.env.example` committed |
| DB-level validation | all integrity rules are DB constraints; the UI shows the DB's own error, mapped by constraint name |

## 5. Application

Next.js 16 (App Router, TypeScript, Tailwind). The browser never talks to a database:

```
Browser ──► Next.js server ──┬─► lib/repo/*.ts (SQL, node-postgres `pg`) ──► PostgreSQL
  (pages, forms)  route      │
                  handlers   └─► lib/mongo.ts (official `mongodb` driver) ──► MongoDB
                  /api/*
```

- Pages are Server Components that read through `lib/repo/*`.
- Every write goes through a Route Handler under `app/api/*`, which checks the session role.
- All SQL is parameterised (`$1, $2 …`) to prevent SQL injection.
- Session = signed JWT in an httpOnly cookie; `proxy.ts` guards every page.

### Pages

| Area | Pages | Owner |
|---|---|---|
| Platform | Login, app shell / sidebar, Overview | Samyak |
| Roster | Crew list (search/filter) → Crew detail (certs, roster, 7-day hours) → Add/Edit crew | Samyak |
| Roster | Flights list (filter) → Flight detail (assigned crew, multi-assign) → Add flight | Samyak |
| Roster | Duty roster (filter by date/crew/role), Reference data (airports, aircraft) | Samyak |
| Compliance | Validation runs list + "Run validation" → Run detail | Shriram |
| Compliance | Violations list (filter) → Violation detail (explanation + Mongo evidence + review) | Shriram |
| Compliance | Rule catalogue with full-text search | Shriram |
| Analytics | Dashboard (Mongo aggregations plus SQL GROUP BY), Activity log | Shriram |

## 6. Work split (equal: both do database and application work)

| | Samyak — Part 1: Roster & Platform | Shriram — Part 2: Compliance & Analytics |
|---|---|---|
| PostgreSQL | full schema (11 tables, all constraints), indexes, seed data, views `v_duty_roster` + `v_crew_summary`, 4 functions, duty-validation trigger, multi-assign transaction | `sp_run_validation` (4 rules), `v_violation_report`, 3 triggers, ALTER review columns, full-text search |
| MongoDB | — | both collections, indexes, aggregation pipelines |
| App | scaffold, env, DB pool, auth + roles, UI kit, Overview, Crew, Flights, Duties, Reference | Runs, Violations (+ review), Rules search, Dashboard, Activity log |
| Quality | DB constraint tests, README | compliance tests, final documentation report, ER fix, demo script |

## 7. Repo layout

```
db/            01_schema.sql 02_roster.sql 03_compliance.sql 04_seed.sql queries.sql reset.mjs
lib/           db.ts auth.ts session.ts api.ts format.ts repo/*.ts (mongo.ts — Part 2)
app/           login/  (app)/… pages  api/… route handlers
components/    ui kit, forms, sidebar
tests/         *.test.mjs (node:test, each test inside BEGIN … ROLLBACK)
docs/          PLAN.md HANDOFF_SHRIRAM.md previous-submissions/
```

## 8. Viva focus

The DBMS side is what gets examined: schema and constraints, normalisation, the four
rules in SQL, window functions, transactions, triggers, procedure, indexes/EXPLAIN, FTS,
the Mongo justification and aggregation, and how the API layer talks to the DB.

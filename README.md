# CrewGuard

**Regulatory compliance validation and violation explanation for airline crew rosters.**
DBMS Level-3 mini project, group G22.

An airline roster can be fully staffed and still be illegal. Aviation regulators limit
how long crew may work and how much rest they must get, and most of those limits depend
on time windows across many duties, not on any single flight. CrewGuard stores the
roster in PostgreSQL. Its validator detects rule breaches and links each one to the
duties that caused it, and MongoDB holds the per-rule evidence plus an activity log.

| Rule | What it checks |
|---|---|
| RST | at least 10 h rest between two duties |
| FDP | a single duty is at most 13 h |
| WDH | at most 60 duty hours in any rolling 7 days |
| CER | a pilot holds a valid rating for the aircraft type flown |
| — | no overlapping duties: *prevented* by an `EXCLUDE` constraint |

## Tech stack

| Layer | Technology |
|---|---|
| Frontend + API | Next.js 16 (App Router, Route Handlers), TypeScript, Tailwind CSS |
| Relational DB | PostgreSQL 16/17 via `pg` (raw parameterised SQL, no ORM) |
| Document DB | MongoDB via the official `mongodb` driver |
| Auth | bcrypt password hashes, signed JWT session in an httpOnly cookie |

```
Browser ──► Next.js server ──┬─► lib/repo/*.ts  (SQL) ──► PostgreSQL
                             └─► lib/mongo.ts         ──► MongoDB
```
The browser never connects to a database. Pages read through `lib/repo/*`, and every
write goes through a route handler in `app/api/*`, which checks the user's role first.

## Database

- **11 tables:** `airport, aircraft_type, app_user, crew_member, certification, flight,
  duty_assignment, rule_definition, validation_run, violation, violation_assignment`
- **Integrity in the database:** PK/FK with `ON DELETE CASCADE / RESTRICT / SET NULL`,
  `CHECK`, `UNIQUE`, `NOT NULL`, the `EXCLUDE USING GIST` no-overlap constraint, and the
  `trg_validate_duty` trigger for cross-table rules
- **Views:** `v_duty_roster`, `v_crew_summary`, `v_violation_report`
- **Functions:** `fn_duty_hours`, `fn_crew_duty_hours`, `fn_crew_roster` (table-valued), `fn_cert_status`
- **Stored procedure:** `sp_run_validation`, the validator for all four rules
- **Triggers:** `trg_validate_duty`, plus `trg_violation_count`, `trg_run_finish` and `trg_violation_review`
- **Transactions:** assigning several crew to a flight and running a validation are both all-or-nothing
- **Indexes:** B-tree on FK and lookup columns, a composite `(crew_id, duty_start_utc)`, GiST for the exclusion constraint, GIN for full-text search on the rules
- **Review workflow:** `ALTER TABLE violation` adds `review_status`, `reviewed_by`, `review_note`, `reviewed_at`

| File | Contents |
|---|---|
| `db/01_schema.sql` | tables, keys, constraints, indexes, table comments |
| `db/02_roster.sql` | roster views, functions and trigger |
| `db/03_compliance.sql` | validator procedure, compliance view/triggers, full-text search |
| `db/04_seed.sql` | two-week sample roster (2–15 Nov 2026) with planted breaches |
| `db/queries.sql` | the important queries, runnable in psql |
| `db/reset.mjs` | rebuilds the database from the numbered files and empties the MongoDB collections |

## MongoDB

| Collection | Holds | Why a document store |
|---|---|---|
| `violation_evidence` | one document per violation, with rule-specific evidence | the shape differs per rule (a rest gap, a 7-day breakdown, certificate details) |
| `audit_log` | one document per user action | append-only, write-heavy, a different payload per action, never joined |

`violation.evidence_doc_id` stores the MongoDB `_id`, which links the two databases. PostgreSQL is the source of
truth: evidence is written after the validation transaction commits, and if MongoDB is down the app keeps working
and says so where the evidence, dashboard charts and activity log would be.

## Roles

| Role | Can |
|---|---|
| `SCHEDULER` | manage crew, ratings, flights and duty assignments |
| `AUDITOR` | read the roster, run validations, review violations |

Demo accounts: `sched_sam` / `Sam@123` (scheduler) and `audit_shriram` / `Shriram@123` (auditor).

## Setup

Prerequisites: **Node.js 20.19+**, **PostgreSQL 16 or 17**, **MongoDB Community 7+** (all installed natively, no Docker).

```bash
git clone https://github.com/samyak-1021/crewguard.git
cd crewguard
npm install
cp .env.example .env.local      # Windows: copy .env.example .env.local
```

Edit `.env.local`:

```
DATABASE_URL=postgres://<user>:<password>@localhost:5432/crewguard
SESSION_SECRET=<any long random string>
MONGODB_URI=mongodb://localhost:27017
MONGODB_DB=crewguard
```

```bash
npm run db:reset   # creates the crewguard database, schema and sample data
npm test           # database tests (constraints, triggers, transactions, views, validator, search)
npm run dev        # http://localhost:3000
```

`npm run db:reset` can be re-run at any time to return to the clean sample data.

## Project structure

```
app/          pages (app/(app)/...), login page, API route handlers (app/api/...)
components/   UI components, form helpers, sidebar
lib/          db.ts (pool + transactions), mongo.ts, audit.ts, auth.ts / session.ts, api.ts, repo/*.ts (SQL and aggregations)
db/           SQL files, sample data, reset script
tests/        database tests (node:test, each test rolled back)
docs/         report, demo script, previous review submissions
```

## Team

| Member | SRN | Part |
|---|---|---|
| Samyak Sanklecha | PES2UG24CS436 | Roster & platform: schema, seed, roster views/functions/trigger, auth and roles, crew / flights / roster / reference pages |
| Shriram Chandrasekar | PES2UG24CS495 | Compliance & analytics: validator procedure, violations and review, rule search, MongoDB evidence and dashboard |

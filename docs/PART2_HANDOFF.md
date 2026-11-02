# CrewGuard — Part 2 Handoff (Compliance & Analytics)

**Owner:** Shriram Chandrasekar (PES2UG24CS495)
**Part 1 (done, merged on `main`):** Samyak Sanklecha (PES2UG24CS436)

This file is the full brief for Part 2. Read it top to bottom before writing code, and
follow it exactly. Also read `docs/PLAN.md` (the agreed plan and guideline checklist) and
`README.md`. The course guidelines are summarised in PLAN.md §4: every row of that table
must be true when Part 2 is finished.

---

## 0. Ground rules

1. **Commits must be yours.** Set your own git identity before the first commit:
   `git config user.name "Shriram Chandrasekar"` and `git config user.email "<your GitHub email>"`.
   Do **not** add `Co-Authored-By` trailers or any tool/AI attribution to commits, PRs or files.
   Part 1 has ~20 small commits, so aim for a similar number in Part 2 (one per feature, not one giant commit).
2. **Git flow:** one branch per step below (`feat/compliance-db`, `feat/mongo`, `feat/runs`, …).
   Make small commits, push, open a PR into `main`, and merge it. Never commit straight to `main`.
3. **Keep the repo clean.** Use only the existing folders: `app/ components/ lib/ db/ tests/ docs/`.
   No new top-level folders, no stray scripts, no screenshots outside `docs/`. `.env.local` is never committed.
4. **No Docker.** PostgreSQL and MongoDB are installed natively.
5. **Do not restructure Part 1.** Edit Part-1 files only at the integration points listed in §6.
6. **Match the existing code style** (see §2). Keep it simple and readable: this project is examined in a
   DBMS viva, so the SQL must be easy to explain. Put good comments in SQL; keep TS comments short.
7. **Verify for real.** After each step: `npm run db:reset`, `npm test`, `npx tsc --noEmit`, `npx eslint .`,
   then run `npm run dev` and exercise the feature in the browser. Every test must pass before merging.

---

## 1. Setup (Windows)

1. **Node.js 20.6 or newer** (`node -v`). Needed for `node --env-file`.
2. **PostgreSQL 17** is already installed (`C:\Program Files\PostgreSQL\17`). Note the `postgres` user's password.
3. **MongoDB Community Server 7+**: install the MSI from mongodb.com (Complete setup, "Install as a Service").
   It listens on `mongodb://localhost:27017`. MongoDB Compass (optional) is useful to look at the data.
   *(macOS: `brew tap mongodb/brew && brew install mongodb-community && brew services start mongodb-community`.)*
4. Clone the repo and install:
   ```
   git clone https://github.com/samyak-1021/crewguard.git
   cd crewguard
   npm install
   copy .env.example .env.local
   ```
5. Edit `.env.local`:
   ```
   DATABASE_URL=postgres://postgres:<your_pg_password>@localhost:5432/crewguard
   SESSION_SECRET=<long random string>
   ```
   (Generate a secret with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.)
6. `npm run db:reset`, then `npm test` (22 tests should pass), then `npm run dev` → http://localhost:3000.
   Log in with `sched_anita` / `Crew@123` (scheduler) or `audit_meera` / `Crew@123` (auditor).

---

## 2. What Part 1 built, and the conventions to follow

### Database (`db/`)
- `01_schema.sql`: all **11 tables**, which already include `rule_definition`, `validation_run`,
  `violation` and `violation_assignment` (do not re-create them). It starts with `DROP TABLE … CASCADE`,
  so every reset rebuilds from zero.
- `02_roster.sql`:
  - functions `fn_duty_hours(start, end)`, `fn_crew_duty_hours(crew, from, to)`, `fn_crew_roster(crew)`, `fn_cert_status(expires_on, on_date)`
  - views `v_duty_roster`, `v_crew_summary`
  - trigger `trg_validate_duty`
- `04_seed.sql`: 13 crew, 24 flights, 62 duties (2–15 Nov 2026, UTC), 4 rules (RST, FDP, WDH, CER).
  **No runs or violations are seeded**: your validator creates them.
- `reset.mjs` runs every `NN_*.sql` file in name order. **Your file `03_compliance.sql` is picked up
  automatically**, and it runs before the seed.
- `queries.sql`: the important read-only queries for the report. Add a `PART 2 : COMPLIANCE` section at the end.

### App
- `lib/db.ts`: `query(sql, params)` and `withTransaction(async client => …)`. The connection runs in **UTC**.
  NUMERIC and COUNT come back as JS numbers.
- `lib/repo/*.ts`: **all SQL lives here**, one file per area. Always use `$1, $2` parameters, never string-concatenate values.
- `app/api/**/route.ts`: every write goes through a route handler wrapped in `handle()` from `lib/api.ts`,
  which first calls `requireRole(...)` from `lib/auth.ts`. `handle()` turns PostgreSQL integrity errors
  into a 400 JSON `{ error, constraint }`. Add messages for your new constraints to `CONSTRAINT_MESSAGES`.
- Pages are Server Components under `app/(app)/…`. They call `requireSession()` when they need the role,
  and read data through `lib/repo/*`. Next.js 16: `params` and `searchParams` are Promises
  (use the global `PageProps<"/route">` and `RouteContext<"/api/route">` types).
- UI kit:
  - `components/ui.tsx`: `PageHeader, Card, Stat, Badge, Table, Td, FilterBar, Field, ButtonLink`
  - `components/forms.tsx`: `ApiForm, DeleteButton, Label, ErrorNote, callApi` (client)
  - `lib/format.ts`: `fmtDateTime, fmtDate, fmtHours, fmtRole`

  Filters are plain GET forms (`FilterBar`). Charts are simple div bars (see `app/(app)/page.tsx`),
  so no chart library is needed.
- Look & feel: grey canvas, white `rounded-2xl` cards, one blue accent (`accent`), badges for statuses.
  New pages must look like the existing ones.
- Roles: `SCHEDULER` manages the roster; **`AUDITOR` runs validations and reviews violations** (your part).

---

## 3. Step A — `db/03_compliance.sql` (PostgreSQL)

Write one well-commented file with these sections, in this order.

### A1. ALTER: violation review workflow (schema change after Review 1)
```sql
ALTER TABLE violation
  ADD COLUMN review_status VARCHAR(15) NOT NULL DEFAULT 'OPEN',
  ADD COLUMN reviewed_by   INTEGER,
  ADD COLUMN review_note   TEXT,
  ADD COLUMN reviewed_at   TIMESTAMPTZ,
  ADD CONSTRAINT chk_violation_review_status CHECK (review_status IN ('OPEN','ACKNOWLEDGED','RESOLVED')),
  ADD CONSTRAINT fk_violation_reviewer FOREIGN KEY (reviewed_by) REFERENCES app_user(user_id)
      ON UPDATE CASCADE ON DELETE SET NULL,
  ADD CONSTRAINT chk_violation_resolution_note CHECK (review_status <> 'RESOLVED' OR review_note IS NOT NULL);
CREATE INDEX idx_violation_rule ON violation (rule_code);
```

### A2. Triggers (3)
- `trg_violation_count`: `AFTER INSERT OR DELETE ON violation`. Keeps `validation_run.violations_found`
  in sync (+1 on insert, −1 on delete). The Review 2 SQL had this (`docs/previous-submissions/Review2_full_sql.sql`, Part K).
- `trg_run_finish`: `BEFORE UPDATE ON validation_run`. When status becomes COMPLETED/FAILED and `finished_at` is NULL, set it to NOW().
- `trg_violation_review`: `BEFORE UPDATE OF review_status ON violation`. When the status changes, set `reviewed_at = NOW()`.

### A3. View `v_violation_report`
One row per violation. Join `violation`, `validation_run`, `rule_definition`, `crew_member` and
`LEFT JOIN app_user` (reviewer). Columns: `violation_id, run_id, period_start, period_end, rule_code, rule_name,
severity, crew_id, employee_code, crew_name, crew_role, window_start, window_end, observed_value,
threshold_value, evidence_doc_id, review_status, reviewer, review_note, reviewed_at, duty_count`.
`duty_count` is a correlated sub-query counting `violation_assignment` rows.

### A4. Stored procedure `sp_run_validation` (the validator, the core of the project)
```sql
CREATE OR REPLACE PROCEDURE sp_run_validation(p_user_id INTEGER, p_start DATE, p_end DATE,
                                              INOUT p_run_id INTEGER DEFAULT NULL)
```
- Opens a `validation_run` (status RUNNING) and returns its id through `p_run_id`.
- Checks a duty if `duty_start_utc` lies in `[p_start, p_end + 1 day)`.
- Reads every threshold and severity from `rule_definition` (no hard-coded 10 / 13 / 60), and runs a rule only if `is_active`.
- For each breach it inserts one `violation` row (`severity` copied from the rule, plus window, observed and threshold values)
  and its `violation_assignment` rows (the duties that caused it, `contribution_value` = that duty's hours).
  Use `FOR r IN <query> LOOP … INSERT … RETURNING violation_id INTO v_id; INSERT INTO violation_assignment …; END LOOP;`,
  the same style as the Review 2 procedure (Part L of `Review2_full_sql.sql`). It is easy to explain.
- Finally it sets the run's status to `COMPLETED`; the trigger stamps `finished_at`.
- Use `(duty_start_utc AT TIME ZONE 'UTC')::date` for date comparisons so results do not depend on the session time zone.

Rule logic:

| Rule | Detection | violation fields | linked duties |
|---|---|---|---|
| **RST** | `LAG(duty_end_utc) OVER (PARTITION BY crew_id ORDER BY duty_start_utc)` over **all** duties (so the previous duty may be before the period); breach when rest < threshold and the *later* duty is in the period | window = prev_end → next_start, observed = rest hours | both duties |
| **FDP** | `fn_duty_hours(start, end) > threshold` | window = duty start → end, observed = duty hours | that duty |
| **WDH** | `SUM(hours) OVER (PARTITION BY crew_id ORDER BY duty_start_utc RANGE BETWEEN INTERVAL '7 days' PRECEDING AND CURRENT ROW)` over **all** duties; among the crew member's in-period duties where the sum > threshold, take the **one with the highest sum (earliest on ties) → one violation per crew member per run** | window = (that duty's start − 7 days) → that duty's end, observed = the 7-day sum | every duty starting in that 7-day window |
| **CER** | pilots only (`assigned_role <> 'CABIN_CREW'`); `NOT EXISTS` a certificate for the flight's `type_code` with duty date `BETWEEN issued_on AND expires_on` | window = duty start → end, observed NULL | that duty |

**Expected results on the seed data** (assert these in tests):

| Period | RST | FDP | WDH | CER | Total |
|---|---|---|---|---|---|
| 2026-11-02 → 2026-11-15 | 7 | 2 | 3 | 4 | **16** |
| 2026-11-02 → 2026-11-08 | 7 | 0 | 3 | 2 | **12** |
| 2026-11-09 → 2026-11-15 | 0 | 2 | 0 | 2 | **4** |

Detail:
- **RST:** Arjun EMP1001 (0.25 h and 9.83 h), Rohan EMP1003 (0.25), Vikram EMP1005 (0.25 and 9.83), Aditya EMP1007 (2.00), Priya EMP1010 (2.00)
- **FDP:** Aditya and Priya, 14.00 h on CG131 (9 Nov)
- **WDH:** Farhan EMP1009, Karan EMP1011, Nisha EMP1006, 66.00 h each with 6 linked duties
- **CER:** Rohan on CG201 and CG202 (no B738 rating); Sneha EMP1004 on CG211 and CG212 (B738 rating expired 11 Aug 2026).
  Kavya EMP1002 must **not** appear, because her A320 rating was renewed.

### A5. Full-text search on the rule catalogue
```sql
CREATE INDEX idx_rule_fts ON rule_definition
  USING GIN (to_tsvector('english', rule_name || ' ' || description || ' ' || COALESCE(regulation_ref, '')));
```
Query with `websearch_to_tsquery('english', $1)`, order by `ts_rank(...)`, and show `ts_headline(...)` snippets.
The expression in the query must be **identical** to the indexed expression or the index is not used.

---

## 4. Step B — MongoDB

1. `npm install mongodb`. Add to `.env.example` **and** your `.env.local`:
   ```
   MONGODB_URI=mongodb://localhost:27017
   MONGODB_DB=crewguard
   ```
2. `lib/mongo.ts`: one shared `MongoClient`, kept on `globalThis` in dev (same pattern as `lib/db.ts`),
   exporting `mongoDb()`. On first use it creates the indexes below (`createIndex` is idempotent).
3. **Collection `violation_evidence`**: one document per violation. The shape of `evidence` depends on the
   rule, which is *the reason MongoDB is used here* (a flexible schema instead of many nullable SQL columns).
   ```js
   { violation_id: 12, run_id: 3, rule_code: "WDH", severity: "MEDIUM", created_at: Date,
     crew: { crew_id: 9, employee_code: "EMP1009", name: "Farhan Ali", role: "CAPTAIN" },
     evidence: { /* rule-specific */ } }
   // RST: { previous_duty: {flight_number, end}, next_duty: {flight_number, start}, rest_hours, required_hours }
   // FDP: { flight_number, sector, duty_start, duty_end, duty_hours, limit_hours }
   // WDH: { window_start, window_end, total_hours, limit_hours, duties: [{flight_number, start, hours}] }
   // CER: { flight_number, aircraft_type, duty_date, reason: "NO_RATING" | "EXPIRED",
   //        ratings_held: [{type_code, issued_on, expires_on}] }
   ```
   Indexes: unique `{ violation_id: 1 }`, `{ run_id: 1 }`, `{ rule_code: 1, severity: 1 }`.
4. **Collection `audit_log`**: append-only activity log.
   `{ ts: Date, user: {id, username, role}, action: "LOGIN" | "CREW_CREATE" | "CREW_UPDATE" | "CREW_DELETE" |
   "CERT_ADD" | "CERT_DELETE" | "FLIGHT_CREATE" | "FLIGHT_DELETE" | "DUTY_ASSIGN" | "DUTY_DELETE" |
   "VALIDATION_RUN" | "VIOLATION_REVIEW", entity: {type, id}, details: {} }`.
   Indexes: `{ ts: -1 }`, `{ action: 1, ts: -1 }`.
   `lib/audit.ts` → `logAudit(session, action, entity, details)`. It must never break the main request:
   wrap it in try/catch and `console.warn` on failure.
5. **Writing evidence:** after the validation transaction commits (Step C1), read the run's new violations
   plus their linked duties from PostgreSQL, build the documents, `insertMany` them, then
   `UPDATE violation SET evidence_doc_id = $1 WHERE violation_id = $2` with the ObjectId's 24-char hex.
   (`evidence_doc_id` is `VARCHAR(24)` on purpose.) Explain the trade-off in the report: PostgreSQL is the
   source of truth, and if MongoDB is down the violations still exist and the UI shows "evidence unavailable".
6. **Aggregation pipelines** (`lib/repo/analytics.ts`): violations by rule (`$group`), by severity,
   top 5 crew by violation count (`$group` → `$sort` → `$limit`), average WDH `total_hours` (`$match` + `$avg`),
   violations per run, and audit actions per day (`$dateToString`).

---

## 5. Step C — Pages and API (add a "Compliance" and an "Analytics" section to `NAV` in `components/sidebar.tsx`)

| Route | Who | What |
|---|---|---|
| `/runs` | all (button: AUDITOR) | runs list (join `app_user`), with period, status, count, duration. "Run validation" form (start/end dates, default 2026-11-02 → 2026-11-08) |
| `POST /api/runs` | AUDITOR | `withTransaction(c => c.query('CALL sp_run_validation($1,$2,$3,NULL)', …))` returns `p_run_id`; then write evidence (B5), `logAudit`, respond `{ id }` → redirect to `/runs/{id}` |
| `/runs/[id]` | all | run header, counts per rule (`GROUP BY rule_code`), and its violations table |
| `/violations` | all | `v_violation_report` with `FilterBar`: rule, severity, review status, run, crew search |
| `/violations/[id]` | all (review form: AUDITOR) | **the explanation page**: rule card (name, regulation ref, threshold), observed vs threshold, the contributing duties (`violation_assignment JOIN v_duty_roster`) with contribution hours, the MongoDB evidence rendered per rule, and the review form (status + note) |
| `PATCH /api/violations/[id]` | AUDITOR | update `review_status`, `review_note`, `reviewed_by`; the trigger sets `reviewed_at`; `logAudit` |
| `/rules` | all | rule catalogue and a full-text search box (`?q=`), ranked, with highlighted snippets |
| `/dashboard` | all | stat cards and div-bar charts from the Mongo aggregations, plus one SQL `GROUP BY` panel next to it to show both databases |
| `/activity` | all | `audit_log` newest first, filter by action and username |

Add a stat card to the Overview page ("Open violations" from PostgreSQL, linking to `/violations?status=OPEN`).

---

## 6. Allowed edits to Part-1 files (integration points only)

- `components/sidebar.tsx`: new NAV sections
- `lib/api.ts`: new entries in `CONSTRAINT_MESSAGES`
- `app/api/auth/login/route.ts` and the roster route handlers in `app/api/{crew,certifications,flights,duties}/`:
  one `await logAudit(...)` line after each successful write
- `app/(app)/page.tsx`: the "Open violations" card
- `db/queries.sql`: append the PART 2 section
- `.env.example`, `README.md`: Mongo variables and setup line, and remove anything that is not true

---

## 7. Step D — Tests (`tests/compliance.test.mjs`, same style as `tests/database.test.mjs`)

Each test runs inside `BEGIN … ROLLBACK`:
- totals per rule for the three periods in §A4 (16 / 12 / 4)
- the RST violation for Arjun's 0.25 h rest links exactly 2 duties
- a WDH violation links 6 duties whose `contribution_value` adds up to 66
- Kavya (crew 2) has no CER violation
- `trg_violation_count`: inserting and deleting a violation moves `violations_found`
- `trg_run_finish` stamps `finished_at`; `trg_violation_review` stamps `reviewed_at`
- CHECK: unknown `review_status` is rejected; RESOLVED without a note is rejected
- full-text search for `rest` returns RST first
- optional `tests/mongo.test.mjs`: insert into a temporary collection, run one `$group`, then drop it

`npm test` runs every file in `tests/`.

---

## 8. Step E — Documentation and demo (`docs/`)

1. **Final project report** (`docs/CrewGuard_Report.docx` + `.pdf`). It needs every section the guidelines require:
   problem statement, objectives, scope, functional requirements, ER diagram, relational schema,
   database choice and justification (PostgreSQL vs MongoDB, see PLAN §2), data dictionary (every table and
   column with type, key and constraint), SQL / NoSQL implementation, important queries (from `queries.sql`),
   system architecture, application screenshots (every page, both roles), testing results (`npm test` output),
   conclusion and future enhancements, and individual contributions (PLAN §6).
2. **ER diagram fix:** Review 1 drew `violation_assignment.resolution_notes`, but the schema uses
   `contribution_value`. Also add the four review columns to `violation` (A1). Update the ER and relational diagrams to match.
3. **`docs/DEMO.md`**, a 10-minute viva script:
   - log in as a scheduler
   - show the constraints rejecting bad input (overlap, inactive crew, same airports)
   - multi-assign rollback
   - log in as an auditor and run validation for week 1 (12 violations)
   - open a WDH violation (6 duties, Mongo evidence)
   - review it
   - FTS search
   - dashboard aggregations
   - `npm test`

---

## 9. Done when

- [ ] `npm run db:reset && npm test`: all Part 1 and Part 2 tests pass
- [ ] `npx tsc --noEmit` and `npx eslint .` are clean
- [ ] Running validation in the browser for 2–15 Nov creates 16 violations, each with a MongoDB evidence document
- [ ] Every page in §5 works for both roles, and an AUDITOR-only action returns 403 for a SCHEDULER
- [ ] Every row of the PLAN §4 guideline table is true
- [ ] README setup works from a fresh clone (both PostgreSQL and MongoDB)
- [ ] Report + PDF, updated diagrams and DEMO.md are in `docs/`
- [ ] ~20 commits authored by Shriram, merged through PRs, with no AI attribution anywhere

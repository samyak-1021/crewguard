# CrewGuard demo script (10 minutes)

Before starting: `npm run db:reset`, then `npm run build` and `npm run start` (or `npm run dev`).
PostgreSQL and MongoDB must both be running. Keep a psql window open:

```
psql -U postgres -d crewguard
SET timezone = 'UTC';
ANALYZE;
```

`ANALYZE` matters: on a freshly rebuilt database the planner has no statistics yet, so it may pick a different
index in step 7 than the one you explain.

## 1. The problem (1 min)

A roster can be fully staffed and still be illegal. The regulator limits how long crew may work and how much rest
they must get, and most limits depend on time windows across many duties, so looking at one flight cannot catch them.
CrewGuard does not generate rosters. It detects breaches and explains each one by linking it to the exact duties.

**Prevention vs detection** is the key idea. The database *prevents* what is wrong in a single row or pair of rows
(constraints and triggers reject it). The validator *detects* what only shows up across many legal-looking rows.

## 2. The database rejects bad input (1.5 min)

Sign in as `sched_sam` / `Sam@123`.

| Do this | Rejected by | What to say |
|---|---|---|
| Flights, New flight: same airport for From and To | `chk_flight_distinct_endpoints` | The error comes from PostgreSQL. The page shows the constraint name. |
| Crew, New crew member: hire date in the future | `chk_crew_hire_date` | Validation lives in the database, so no client can skip it. |

## 3. A transaction rolls back (1 min)

Open flight **CG102** on 2 Nov (`/flights/2`). Assign Farhan Ali together with one more crew member. Farhan is on CG111
at that time, so `excl_duty_no_overlap` rejects him, and the other crew member is not saved either.

What to say: assigning crew is one transaction. `EXCLUDE USING GIST` compares ranges with `&&`, which `UNIQUE` and
`CHECK` cannot do. Refresh the page: nobody new was added.

## 4. Run the validator (1.5 min)

Sign out, then sign in as `audit_shriram` / `Shriram@123`. Validation runs, period **2 Nov to 8 Nov**, Run validation.

Expected: **12 violations** (RST 7, WDH 3, CER 2).

What to say: this calls `sp_run_validation` inside one transaction. Thresholds come from `rule_definition`, not from the
code. Then the app writes one evidence document per violation to MongoDB, after the commit.

Optional: run 9 to 15 Nov for **4 more** (FDP 2, CER 2). Nisha's rolling total there is only 58.67 h, so no WDH.

## 5. The explanation page (2 min)

Violations, filter rule **WDH**, open **Farhan Ali**.

- 66 h against a 60 h limit, and the 6 contributing duties adding up to 66 h. That is `violation_assignment`, the M:N bridge.
- The evidence card comes from MongoDB. Point at the document id: it is stored in `violation.evidence_doc_id`.
- Set the status to **acknowledged** with a note, and save. `trg_violation_review` stamps the time.
- Try **resolved** with an empty note: `chk_violation_resolution_note` rejects it.

Also worth showing: **Kavya Sharma has no CER violation**. Her A320 certificate expired on 31 Oct, but she holds a renewal,
so the anti-join finds a valid row.

## 6. Search and dashboard (1 min)

- Rules, search **rest**: RST comes back ranked, with the word highlighted. GIN index, `websearch_to_tsquery`, `ts_rank`, `ts_headline`.
- Dashboard: the same count per rule from SQL `GROUP BY` and from a MongoDB `$group`, side by side.
- Activity log: every action above is here, a document per action in `audit_log`.

## 7. Under the hood (1.5 min)

```
\d+ duty_assignment
\d+ violation
EXPLAIN ANALYZE SELECT * FROM duty_assignment WHERE crew_id = 1 ORDER BY duty_start_utc;
```

With `SET enable_seqscan = off;` first, the plan shows `Index Scan using idx_duty_crew_start`. With so few rows the planner
otherwise prefers a sequential scan, which is the right call at this size. Say that if asked.

Then run the tests:

```
npm test
```

Every test runs inside `BEGIN ... ROLLBACK`, so the demo data is untouched.

## Questions to expect

| Question | Answer |
|---|---|
| Why two databases? | Relational data needs foreign keys, constraints, transactions and window functions. Evidence has a different shape per rule, and the log is append-only and never joined. |
| What if MongoDB is down? | PostgreSQL is the source of truth. Violations still exist, and the pages say the evidence is unavailable. |
| Why not put the rules in triggers? | A trigger sees one row being written. These rules need a window over many duties, and a roster is built in any order, so the check belongs after the roster is built. |
| Why `RANGE` and not `ROWS` in WDH? | The window is 7 days of time, not 7 rows. |
| Why `clock_timestamp()` in `trg_run_finish`? | `NOW()` is frozen at the start of the transaction, so a run would show a duration of 0. |
| Why `DISTINCT ON` in WDH? | Every duty in an overworked week has a high rolling total. One week should be one violation, not one per duty. |
| Why compute RST and WDH over all duties, not just the period? | The previous duty or the window can begin before the period starts. |

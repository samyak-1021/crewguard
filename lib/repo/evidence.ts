// Rule-specific evidence for each violation, stored in MongoDB. The shape differs
// per rule (a rest gap, a 7-day breakdown, certificate details), which a flexible
// document handles better than many nullable columns.
//
// PostgreSQL stays the source of truth: the evidence is written after the validation
// transaction has committed, and violation.evidence_doc_id links the two databases.
// If MongoDB is down the violations still exist and the UI says "evidence unavailable".
import { ObjectId } from "mongodb";
import { query, withTransaction } from "@/lib/db";
import { mongoDb } from "@/lib/mongo";

export type RstEvidence = {
  previous_duty: { flight_number: string; end: Date };
  next_duty: { flight_number: string; start: Date };
  rest_hours: number;
  required_hours: number;
};
export type FdpEvidence = {
  flight_number: string; sector: string; duty_start: Date; duty_end: Date; duty_hours: number; limit_hours: number;
};
export type WdhEvidence = {
  window_start: Date; window_end: Date; total_hours: number; limit_hours: number;
  duties: { flight_number: string; start: Date; hours: number }[];
};
export type CerEvidence = {
  flight_number: string; aircraft_type: string; duty_date: string; reason: "NO_RATING" | "EXPIRED";
  ratings_held: { type_code: string; issued_on: string; expires_on: string }[];
};

export type EvidenceDoc = {
  violation_id: number; run_id: number; severity: string; created_at: Date;
  crew: { crew_id: number; employee_code: string; name: string; role: string };
} & (
  | { rule_code: "RST"; evidence: RstEvidence }
  | { rule_code: "FDP"; evidence: FdpEvidence }
  | { rule_code: "WDH"; evidence: WdhEvidence }
  | { rule_code: "CER"; evidence: CerEvidence }
);

type ViolationRow = {
  violation_id: number; run_id: number; rule_code: EvidenceDoc["rule_code"]; severity: string;
  crew_id: number; employee_code: string; crew_name: string; crew_role: string;
  window_start: Date; window_end: Date; observed_value: number; threshold_value: number;
};
type DutyRow = {
  violation_id: number; flight_number: string; dep_airport: string; arr_airport: string; type_code: string;
  duty_start_utc: Date; duty_end_utc: Date; contribution_value: number;
};
type RatingRow = { crew_id: number; type_code: string; issued_on: string; expires_on: string };

function buildEvidence(v: ViolationRow, duties: DutyRow[], ratings: RatingRow[]) {
  const d = duties[0];
  switch (v.rule_code) {
    case "RST":
      return {
        previous_duty: { flight_number: d.flight_number, end: d.duty_end_utc },
        next_duty: { flight_number: duties[1].flight_number, start: duties[1].duty_start_utc },
        rest_hours: v.observed_value,
        required_hours: v.threshold_value,
      };
    case "FDP":
      return {
        flight_number: d.flight_number,
        sector: `${d.dep_airport} → ${d.arr_airport}`,
        duty_start: d.duty_start_utc,
        duty_end: d.duty_end_utc,
        duty_hours: v.observed_value,
        limit_hours: v.threshold_value,
      };
    case "WDH":
      return {
        window_start: v.window_start,
        window_end: v.window_end,
        total_hours: v.observed_value,
        limit_hours: v.threshold_value,
        duties: duties.map((x) => ({
          flight_number: x.flight_number, start: x.duty_start_utc, hours: x.contribution_value,
        })),
      };
    case "CER": {
      const dutyDate = d.duty_start_utc.toISOString().slice(0, 10);
      const held = ratings.map(({ type_code, issued_on, expires_on }) => ({ type_code, issued_on, expires_on }));
      // an older certificate for this type means it lapsed; otherwise they never held one
      const lapsed = held.some((r) => r.type_code === d.type_code && r.expires_on < dutyDate);
      return {
        flight_number: d.flight_number,
        aircraft_type: d.type_code,
        duty_date: dutyDate,
        reason: lapsed ? "EXPIRED" : "NO_RATING",
        ratings_held: held,
      };
    }
  }
}

// One document per violation of the run, read from PostgreSQL.
export async function buildEvidenceDocs(runId: number) {
  const [violations, duties, ratings] = await Promise.all([
    query<ViolationRow>(
      `SELECT violation_id, run_id, rule_code, severity, crew_id, employee_code, crew_name, crew_role,
              window_start, window_end, observed_value, threshold_value
       FROM v_violation_report
       WHERE run_id = $1
       ORDER BY violation_id`,
      [runId],
    ),
    query<DutyRow>(
      `SELECT va.violation_id, r.flight_number, r.dep_airport, r.arr_airport, r.type_code,
              r.duty_start_utc, r.duty_end_utc, va.contribution_value
       FROM violation v
       JOIN violation_assignment va ON va.violation_id = v.violation_id
       JOIN v_duty_roster r         ON r.assignment_id = va.assignment_id
       WHERE v.run_id = $1
       ORDER BY r.duty_start_utc`,
      [runId],
    ),
    // ::text keeps the plain date, so it cannot shift with the server's time zone
    query<RatingRow>(
      `SELECT c.crew_id, c.type_code, c.issued_on::text AS issued_on, c.expires_on::text AS expires_on
       FROM certification c
       WHERE c.crew_id IN (SELECT crew_id FROM violation WHERE run_id = $1 AND rule_code = 'CER')
       ORDER BY c.type_code, c.issued_on`,
      [runId],
    ),
  ]);

  return violations.map((v) => ({
    violation_id: v.violation_id,
    run_id: v.run_id,
    rule_code: v.rule_code,
    severity: v.severity,
    created_at: new Date(),
    crew: { crew_id: v.crew_id, employee_code: v.employee_code, name: v.crew_name, role: v.crew_role },
    evidence: buildEvidence(
      v,
      duties.filter((d) => d.violation_id === v.violation_id),
      ratings.filter((r) => r.crew_id === v.crew_id),
    ),
  }));
}

// Called after the validation transaction has committed. Never throws.
export async function writeEvidence(runId: number) {
  try {
    const docs = await buildEvidenceDocs(runId);
    if (docs.length === 0) return;

    const evidence = (await mongoDb()).collection("violation_evidence");
    // These violation ids are brand new in PostgreSQL, so a document that already
    // has one is left over from before a database reset and must go.
    await evidence.deleteMany({ violation_id: { $in: docs.map((d) => d.violation_id) } });
    const { insertedIds } = await evidence.insertMany(docs);

    // Store each document's _id (24 hex characters): the link between the databases.
    await withTransaction(async (client) => {
      for (let i = 0; i < docs.length; i++) {
        await client.query("UPDATE violation SET evidence_doc_id = $1 WHERE violation_id = $2", [
          insertedIds[i].toHexString(),
          docs[i].violation_id,
        ]);
      }
    });
  } catch (err) {
    console.warn(`evidence not written for run ${runId}:`, (err as Error).message);
  }
}

// Evidence for the violation detail page, or null if it is missing or Mongo is down.
export async function getEvidence(docId: string | null) {
  if (!docId) return null;
  try {
    const db = await mongoDb();
    const doc = await db.collection("violation_evidence").findOne({ _id: new ObjectId(docId) });
    return doc as unknown as EvidenceDoc | null;
  } catch (err) {
    console.warn("evidence not read:", (err as Error).message);
    return null;
  }
}

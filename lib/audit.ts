// Activity log: one MongoDB document per action. It is append-only, write-heavy,
// has a different payload per action and is never joined, so it fits a document store.
import { mongoDb } from "@/lib/mongo";
import type { Session } from "@/lib/session";

export const AUDIT_ACTIONS = [
  "LOGIN",
  "CREW_CREATE", "CREW_UPDATE", "CREW_DELETE",
  "CERT_ADD", "CERT_DELETE",
  "FLIGHT_CREATE", "FLIGHT_DELETE",
  "DUTY_ASSIGN", "DUTY_DELETE",
  "VALIDATION_RUN", "VIOLATION_REVIEW",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

// Called after the main write has succeeded. Never throws: losing a log line
// must not fail a request that already did its work in PostgreSQL.
export async function logAudit(
  session: Session,
  action: AuditAction,
  entity: { type: string; id: number },
  details?: Record<string, unknown>,
) {
  try {
    const db = await mongoDb();
    await db.collection("audit_log").insertOne({
      ts: new Date(),
      user: { id: session.userId, username: session.username, role: session.role },
      action,
      entity,
      details: details ?? {},
    });
  } catch (err) {
    console.warn(`audit log not written (${action}):`, (err as Error).message);
  }
}

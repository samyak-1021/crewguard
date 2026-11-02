import { NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth";
import { handle, readJson } from "@/lib/api";
import { writeEvidence } from "@/lib/repo/evidence";
import { runValidation } from "@/lib/repo/runs";

// POST /api/runs  { period_start, period_end }
// Runs the validator in one transaction, then writes the evidence to MongoDB once
// that has committed. A Mongo failure leaves the run and its violations intact.
export const POST = handle(async (req) => {
  const session = await requireRole("AUDITOR");
  const { period_start, period_end } = await readJson(req);
  const id = await runValidation(session.userId, period_start, period_end);
  await writeEvidence(id);
  await logAudit(session, "VALIDATION_RUN", { type: "run", id }, { period_start, period_end });
  return NextResponse.json({ id }, { status: 201 });
});

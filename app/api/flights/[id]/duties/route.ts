import { NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth";
import { badRequest, handle, readJson } from "@/lib/api";
import { assignCrew } from "@/lib/repo/flights";

// POST /api/flights/:id/duties  { crew_ids: number[], duty_start_utc, duty_end_utc }
// Assigns all listed crew in ONE transaction: all succeed or none are saved.
export const POST = handle(async (req, { params }: RouteContext<"/api/flights/[id]/duties">) => {
  const session = await requireRole("SCHEDULER");
  const body = await readJson(req);
  const crewIds = Array.isArray(body.crew_ids) ? body.crew_ids.map(Number) : [];
  if (crewIds.length === 0) return badRequest("Select at least one crew member.");
  const flightId = Number((await params).id);
  const ids = await assignCrew(
    flightId, crewIds, String(body.duty_start_utc), String(body.duty_end_utc), session.userId,
  );
  await logAudit(session, "DUTY_ASSIGN", { type: "flight", id: flightId }, { crew_ids: crewIds, assignment_ids: ids });
  return NextResponse.json({ ids }, { status: 201 });
});

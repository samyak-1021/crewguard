import { NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth";
import { handle, readJson } from "@/lib/api";
import { createCrew } from "@/lib/repo/crew";

// POST /api/crew - add a crew member
export const POST = handle(async (req) => {
  const session = await requireRole("SCHEDULER");
  const body = await readJson(req);
  const id = await createCrew(body);
  await logAudit(session, "CREW_CREATE", { type: "crew", id }, { employee_code: body.employee_code });
  return NextResponse.json({ id }, { status: 201 });
});

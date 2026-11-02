import { NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth";
import { handle, readJson } from "@/lib/api";
import { createFlight } from "@/lib/repo/flights";

// POST /api/flights - schedule a flight (times are UTC)
export const POST = handle(async (req) => {
  const session = await requireRole("SCHEDULER");
  const body = await readJson(req);
  const id = await createFlight(body);
  await logAudit(session, "FLIGHT_CREATE", { type: "flight", id }, { flight_number: body.flight_number });
  return NextResponse.json({ id }, { status: 201 });
});

import { NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth";
import { handle } from "@/lib/api";
import { deleteFlight } from "@/lib/repo/flights";

// DELETE /api/flights/:id - its duties go with it (ON DELETE CASCADE)
export const DELETE = handle(async (_req, { params }: RouteContext<"/api/flights/[id]">) => {
  const session = await requireRole("SCHEDULER");
  const id = Number((await params).id);
  if (!(await deleteFlight(id))) return NextResponse.json({ error: "Not found." }, { status: 404 });
  await logAudit(session, "FLIGHT_DELETE", { type: "flight", id });
  return NextResponse.json({ ok: true });
});

import { NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth";
import { handle } from "@/lib/api";
import { deleteDuty } from "@/lib/repo/roster";

// DELETE /api/duties/:id - take a crew member off a flight
export const DELETE = handle(async (_req, { params }: RouteContext<"/api/duties/[id]">) => {
  const session = await requireRole("SCHEDULER");
  const id = Number((await params).id);
  if (!(await deleteDuty(id))) return NextResponse.json({ error: "Not found." }, { status: 404 });
  await logAudit(session, "DUTY_DELETE", { type: "duty", id });
  return NextResponse.json({ ok: true });
});

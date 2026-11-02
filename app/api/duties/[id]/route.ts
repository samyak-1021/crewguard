import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { handle } from "@/lib/api";
import { deleteDuty } from "@/lib/repo/roster";

// DELETE /api/duties/:id - take a crew member off a flight
export const DELETE = handle(async (_req, { params }: RouteContext<"/api/duties/[id]">) => {
  await requireRole("SCHEDULER");
  if (!(await deleteDuty(Number((await params).id)))) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
});

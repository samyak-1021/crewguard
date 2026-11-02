import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { handle } from "@/lib/api";
import { deleteFlight } from "@/lib/repo/flights";

// DELETE /api/flights/:id - its duties go with it (ON DELETE CASCADE)
export const DELETE = handle(async (_req, { params }: RouteContext<"/api/flights/[id]">) => {
  await requireRole("SCHEDULER");
  if (!(await deleteFlight(Number((await params).id)))) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
});

import { NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth";
import { handle, readJson } from "@/lib/api";
import { deleteCrew, updateCrew } from "@/lib/repo/crew";

type Ctx = RouteContext<"/api/crew/[id]">;

// PATCH /api/crew/:id - edit name, base, active flag
export const PATCH = handle(async (req, { params }: Ctx) => {
  const session = await requireRole("SCHEDULER");
  const id = Number((await params).id);
  const body = await readJson(req);
  if (!(await updateCrew(id, body))) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const { first_name, last_name, home_base, is_active } = body;
  await logAudit(session, "CREW_UPDATE", { type: "crew", id }, { first_name, last_name, home_base, is_active });
  return NextResponse.json({ id });
});

// DELETE /api/crew/:id - certificates and duties go with it (ON DELETE CASCADE)
export const DELETE = handle(async (_req, { params }: Ctx) => {
  const session = await requireRole("SCHEDULER");
  const id = Number((await params).id);
  if (!(await deleteCrew(id))) return NextResponse.json({ error: "Not found." }, { status: 404 });
  await logAudit(session, "CREW_DELETE", { type: "crew", id });
  return NextResponse.json({ ok: true });
});

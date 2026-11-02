import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { handle, readJson } from "@/lib/api";
import { deleteCrew, updateCrew } from "@/lib/repo/crew";

type Ctx = RouteContext<"/api/crew/[id]">;

// PATCH /api/crew/:id - edit name, base, active flag
export const PATCH = handle(async (req, { params }: Ctx) => {
  await requireRole("SCHEDULER");
  const id = Number((await params).id);
  if (!(await updateCrew(id, await readJson(req)))) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ id });
});

// DELETE /api/crew/:id - certificates and duties go with it (ON DELETE CASCADE)
export const DELETE = handle(async (_req, { params }: Ctx) => {
  await requireRole("SCHEDULER");
  if (!(await deleteCrew(Number((await params).id)))) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
});

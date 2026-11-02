import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { handle } from "@/lib/api";
import { deleteCertification } from "@/lib/repo/crew";

// DELETE /api/certifications/:id
export const DELETE = handle(async (_req, { params }: RouteContext<"/api/certifications/[id]">) => {
  await requireRole("SCHEDULER");
  if (!(await deleteCertification(Number((await params).id)))) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
});

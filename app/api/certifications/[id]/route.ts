import { NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth";
import { handle } from "@/lib/api";
import { deleteCertification } from "@/lib/repo/crew";

// DELETE /api/certifications/:id
export const DELETE = handle(async (_req, { params }: RouteContext<"/api/certifications/[id]">) => {
  const session = await requireRole("SCHEDULER");
  const id = Number((await params).id);
  if (!(await deleteCertification(id))) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  await logAudit(session, "CERT_DELETE", { type: "certification", id });
  return NextResponse.json({ ok: true });
});

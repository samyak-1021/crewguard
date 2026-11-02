import { NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth";
import { handle, readJson } from "@/lib/api";
import { addCertification } from "@/lib/repo/crew";

// POST /api/crew/:id/certifications - record a type rating
export const POST = handle(async (req, { params }: RouteContext<"/api/crew/[id]/certifications">) => {
  const session = await requireRole("SCHEDULER");
  const crewId = Number((await params).id);
  const body = await readJson(req);
  const id = await addCertification(crewId, body);
  await logAudit(session, "CERT_ADD", { type: "certification", id }, { crew_id: crewId, type_code: body.type_code });
  return NextResponse.json({ id }, { status: 201 });
});

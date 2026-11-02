import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { handle, readJson } from "@/lib/api";
import { addCertification } from "@/lib/repo/crew";

// POST /api/crew/:id/certifications - record a type rating
export const POST = handle(async (req, { params }: RouteContext<"/api/crew/[id]/certifications">) => {
  await requireRole("SCHEDULER");
  const id = await addCertification(Number((await params).id), await readJson(req));
  return NextResponse.json({ id }, { status: 201 });
});

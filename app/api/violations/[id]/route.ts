import { NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth";
import { handle, readJson } from "@/lib/api";
import { toId } from "@/lib/ids";
import { reviewViolation } from "@/lib/repo/violations";

// PATCH /api/violations/:id  { review_status, review_note }
export const PATCH = handle(async (req, { params }: RouteContext<"/api/violations/[id]">) => {
  const session = await requireRole("AUDITOR");
  const id = toId((await params).id);
  const { review_status, review_note } = await readJson(req);
  if (id === null || !(await reviewViolation(id, review_status, review_note, session.userId))) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  await logAudit(session, "VIOLATION_REVIEW", { type: "violation", id }, { review_status });
  return NextResponse.json({ id });
});

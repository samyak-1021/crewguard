import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { handle, readJson } from "@/lib/api";
import { createCrew } from "@/lib/repo/crew";

// POST /api/crew - add a crew member
export const POST = handle(async (req) => {
  await requireRole("SCHEDULER");
  const id = await createCrew(await readJson(req));
  return NextResponse.json({ id }, { status: 201 });
});

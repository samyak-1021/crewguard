import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { handle, readJson } from "@/lib/api";
import { createFlight } from "@/lib/repo/flights";

// POST /api/flights - schedule a flight (times are UTC)
export const POST = handle(async (req) => {
  await requireRole("SCHEDULER");
  const id = await createFlight(await readJson(req));
  return NextResponse.json({ id }, { status: 201 });
});

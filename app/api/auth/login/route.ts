import { NextResponse } from "next/server";
import { checkLogin } from "@/lib/auth";
import { badRequest, handle, readJson } from "@/lib/api";
import { SESSION_COOKIE, SESSION_HOURS, signSession } from "@/lib/session";

// POST /api/auth/login  { username, password }
export const POST = handle(async (req) => {
  const { username, password } = await readJson(req);
  if (typeof username !== "string" || typeof password !== "string") {
    return badRequest("Enter your username and password.");
  }
  const session = await checkLogin(username.trim(), password);
  if (!session) {
    // same message for wrong username and wrong password, so attackers
    // cannot find out which usernames exist
    return NextResponse.json({ error: "Incorrect username or password." }, { status: 401 });
  }
  const res = NextResponse.json({ username: session.username, role: session.role });
  res.cookies.set(SESSION_COOKIE, await signSession(session), {
    httpOnly: true, // page JavaScript cannot read the cookie
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  });
  return res;
});

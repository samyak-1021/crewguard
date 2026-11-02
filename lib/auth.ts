// Login check and session helpers for pages and API routes.
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { query } from "@/lib/db";
import { SESSION_COOKIE, verifySession, type Role, type Session } from "@/lib/session";

// Look the user up by username and compare the password with the stored
// bcrypt hash. The plain password is never stored or logged.
export async function checkLogin(username: string, password: string): Promise<Session | null> {
  const rows = await query<{ user_id: number; username: string; password_hash: string; app_role: Role }>(
    "SELECT user_id, username, password_hash, app_role FROM app_user WHERE username = $1",
    [username],
  );
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) return null;
  return { userId: user.user_id, username: user.username, role: user.app_role };
}

export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  return verifySession(jar.get(SESSION_COOKIE)?.value);
}

// For pages: signed-in user, or a redirect to the login page.
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

// For API routes: thrown when the caller is not allowed to do something.
export class AuthError extends Error {
  constructor(public status: 401 | 403, message: string) {
    super(message);
  }
}

// For API routes: the session, or an AuthError if the role is not allowed.
export async function requireRole(...roles: Role[]): Promise<Session> {
  const session = await getSession();
  if (!session) throw new AuthError(401, "Please sign in again.");
  if (!roles.includes(session.role)) {
    throw new AuthError(403, `Only ${roles.join(" or ")} users can do this.`);
  }
  return session;
}

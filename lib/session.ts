// Signed session tokens (JWT). Kept free of Node-only imports so the proxy
// can use it too.
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "cg_session";
export const SESSION_HOURS = 8;

export type Role = "SCHEDULER" | "AUDITOR";
export type Session = { userId: number; username: string; role: Role };

const secret = () => new TextEncoder().encode(process.env.SESSION_SECRET);

// The token is signed with SESSION_SECRET, so a user cannot edit their own
// role inside it without the signature check failing.
export async function signSession(s: Session): Promise<string> {
  return new SignJWT({ username: s.username, role: s.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(s.userId))
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(secret());
}

export async function verifySession(token: string | undefined): Promise<Session | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return { userId: Number(payload.sub), username: String(payload.username), role: payload.role as Role };
  } catch {
    return null; // bad signature or expired
  }
}

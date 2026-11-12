import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { db } from "../db";
import { sendEmail } from "../email";
import { bearerToken } from "./mobile";
import { getSessionUser, setActingAs as actAs, type Deps, type SessionUser } from "./service";

export const SESSION_COOKIE = "thunder_session";

// DEV_LOGIN_BYPASS=true in .env.local, and only under `npm run dev`.
export const devBypass = process.env.NODE_ENV === "development" && process.env.DEV_LOGIN_BYPASS === "true";

export const deps: Deps = {
  pool: db,
  sendEmail,
  now: () => new Date(),
  devStarterBypass: devBypass,
  devFixedCode: devBypass ? "123456" : undefined,
  pinOnly: process.env.LOGIN_PIN_ONLY === "true",
};

export async function sessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

export async function setSessionCookie(token: string, expires: Date) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

// The logged-in person, with roles fresh from the user record. Call this in every page and action.
export async function currentUser(): Promise<SessionUser | null> {
  // Always check at request time; never let Next.js pre-build a page with someone's login in it.
  await connection();
  return userFor(await sessionToken());
}

// Read once per page being built (a page's many cards each ask; roles are still re-read on every request). Outside a
// page render (a server action) React's cache doesn't hold, so it reads fresh each time.
const userFor = cache((token: string | undefined) => getSessionUser(deps, token));

// The phone app sends its session token as "Authorization: Bearer <token>" instead of a cookie.
export function phoneToken(request: Request): string | undefined {
  return bearerToken(request.headers.get("authorization"));
}

// The phone app's logged-in person, with roles fresh from the user record. Call this in every /api/mobile endpoint.
export async function phoneUser(request: Request): Promise<SessionUser | null> {
  return getSessionUser(deps, phoneToken(request));
}

// Shown when a Director tries to save something while viewing the app as someone else.
export const VIEW_ONLY = "You're viewing the app as someone else, so nothing can be changed. Tap Stop at the top first.";

// Director "Act as": view the app as another user (view only), or stop. Checked again on the server.
export async function setActingAs(coachId: string | null) {
  return actAs(deps, await sessionToken(), coachId);
}

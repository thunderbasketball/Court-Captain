import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/lib/auth/server";
import { CONTEXT_COOKIE, PLATFORM, userContexts } from "@/lib/contexts";
import { db } from "@/lib/db";
import { isOrgSlug } from "@/lib/orgs";

// Header chip: /switch?to=director, /switch?to=team:<id>, /switch?to=scenic:<role>.
// Organization switcher and org login links: /switch?org=<slug> → the role used last there, else the first one.
// /switch?org=courtcaptain → the CourtCaptain page (admins; the CourtCaptain login sends everyone here first).
// Only switches to a role the person holds right now.
export async function GET(req: NextRequest) {
  const user = await currentUser();
  const asked = req.nextUrl.searchParams.get("org");
  const org = isOrgSlug(asked) || asked === PLATFORM ? asked : null;
  if (!user) return NextResponse.redirect(new URL(isOrgSlug(org) ? `/login/${org}` : "/login", req.url));
  const contexts = await userContexts(db, user);
  const to = req.nextUrl.searchParams.get("to");
  const remembered = req.cookies.get(CONTEXT_COOKIE)?.value;
  const target = org
    ? (contexts.find((c) => c.org === org && c.key === remembered) ?? contexts.find((c) => c.org === org))
    : contexts.find((c) => c.key === to);
  // No role there yet: Scenic City offers its join form; otherwise home (the role used last, pending, or request access).
  if (!target) return NextResponse.redirect(new URL(org === "scenic-city" ? "/join/scenic-city" : "/", req.url));
  const res = NextResponse.redirect(new URL(target.href, req.url));
  res.cookies.set(CONTEXT_COOKIE, target.key, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}

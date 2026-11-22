import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/lib/auth/server";
import { CONTEXT_COOKIE, PLATFORM, userContexts } from "@/lib/contexts";
import { db } from "@/lib/db";
import { isOrgSlug } from "@/lib/orgs";

// Header chip: /switch?to=director, /switch?to=team:<id>, /switch?to=scenic:<role>.
// Organization switcher and org login links: /switch?org=<slug> → the role used last there, else the first one.
// /switch?org=courtcaptain → the CourtCaptain page (admins; the CourtCaptain login sends everyone here first).
// Only switches to a role the person holds right now.
// By path only, so the browser stays on the address it's using (req.url can be the server's own, localhost).
const go = (path: string) => new NextResponse(null, { status: 307, headers: { Location: path } });

export async function GET(req: NextRequest) {
  const user = await currentUser();
  const asked = req.nextUrl.searchParams.get("org");
  const org = isOrgSlug(asked) || asked === PLATFORM ? asked : null;
  if (!user) return go(isOrgSlug(org) ? `/login/${org}` : "/login");
  const contexts = await userContexts(db, user);
  const to = req.nextUrl.searchParams.get("to");
  const remembered = req.cookies.get(CONTEXT_COOKIE)?.value;
  const target = org
    ? (contexts.find((c) => c.org === org && c.key === remembered) ?? contexts.find((c) => c.org === org))
    : contexts.find((c) => c.key === to);
  // No role there yet: home (the role used last, pending, or getting started).
  if (!target) return go("/");
  const res = go(target.href);
  res.cookies.set(CONTEXT_COOKIE, target.key, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}

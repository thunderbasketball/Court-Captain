"use server";

import { redirect } from "next/navigation";
import { currentUser, setActingAs } from "@/lib/auth/server";
import { CONTEXT_COOKIE, userContexts } from "@/lib/contexts";
import { db } from "@/lib/db";
import { isOrgSlug } from "@/lib/orgs";
import { cookies } from "next/headers";

// Where the Admin was when they started viewing as someone (their role chip), so Stop brings them back there.
const RETURN_COOKIE = "courtcaptain_view_return";
const cookieOpts = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/" };

// Admins only (checked in lib/auth/service). Starts on the person's home page in the organization the Admin is in
// (their first role there), else in their first role.
export async function actAs(coachId: string) {
  const r = await setActingAs(String(coachId));
  if (!r.ok) return r;
  const jar = await cookies();
  const mine = jar.get(CONTEXT_COOKIE)?.value;
  if (mine) jar.set(RETURN_COOKIE, mine, { ...cookieOpts, maxAge: 60 * 60 * 24 });
  const org = mine?.startsWith("org:") ? mine.slice(4) : mine?.startsWith("scenic:") ? "scenic-city" : "thunder";
  const them = await currentUser(); // now the person being viewed
  // CourtCaptain staff (support) start in the person's first role, whatever organization it's in.
  const theirs = them ? await userContexts(db, them) : [];
  const start = theirs.find((c) => c.org === org) ?? (mine === "platform" ? theirs[0] : undefined);
  if (start) jar.set(CONTEXT_COOKIE, start.key, { ...cookieOpts, maxAge: 60 * 60 * 24 * 365 });
  else jar.delete(CONTEXT_COOKIE);
  redirect(start?.href ?? "/");
}

// Back to yourself, in the role and organization you started from (its Users page; the CourtCaptain page for its staff).
export async function stopActing() {
  await setActingAs(null);
  const jar = await cookies();
  const back = jar.get(RETURN_COOKIE)?.value;
  jar.delete(RETURN_COOKIE);
  if (back) jar.set(CONTEXT_COOKIE, back, { ...cookieOpts, maxAge: 60 * 60 * 24 * 365 });
  else jar.delete(CONTEXT_COOKIE);
  // The chip is only a preference: pages still check the real roles, and /switch-style checks pick another if it's gone.
  redirect(
    back === "platform"
      ? "/platform"
      : back?.startsWith("org:") && isOrgSlug(back.slice(4))
        ? `/org/${back.slice(4)}/members?open=staff`
        : back?.startsWith("scenic:")
          ? "/org/scenic-city/users"
          : "/org/thunder/members/staff",
  );
}

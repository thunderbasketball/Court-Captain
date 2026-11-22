import { currentUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { orgInfo } from "@/lib/org-registry";
import { isOrgSlug } from "@/lib/orgs";
import { resumeConnect, startConnect } from "@/lib/stripe/connect";
import { goTo, homeOf, siteOrigin, stripeDeps } from "../deps";

// Payments → Connect Stripe / Finish Stripe setup (a form on the organization's settings): Owners only, checked in
// lib/stripe/connect. Sends them to Stripe's sign-up for the organization's own account.
export async function POST(request: Request) {
  const site = siteOrigin(request);
  // Only this site's own form (another site can't start it for a logged-in Owner).
  const origin = request.headers.get("origin");
  if (origin && origin !== site) return new Response("Forbidden", { status: 403 });
  const form = await request.formData();
  const org = form.get("org");
  const user = await currentUser();
  if (!user) return goTo("/login");
  if (user.actingBy || !isOrgSlug(org)) return goTo("/");
  const o = await orgInfo(db, org);
  if (!o) return goTo("/");
  const email = (await db.query<{ email: string | null }>("select email from users where coach_id = $1", [user.coachId])).rows[0]?.email ?? null;
  try {
    const r = await startConnect(stripeDeps(), user, org, site, { name: o.name, email });
    if (!r.ok) return say(r.message, 403);
    return Response.redirect(r.url, 303);
  } catch (e) {
    console.error("Connect Stripe failed:", e);
    return say("Stripe couldn't start the setup just now. Go back and try again in a minute.", 502);
  }
}

// Stripe sends them here when its sign-up link ran out: a fresh link for the account the organization already has.
export async function GET(request: Request) {
  const site = siteOrigin(request);
  const org = new URL(request.url).searchParams.get("org");
  const user = await currentUser();
  if (!user) return goTo("/login");
  if (user.actingBy || !isOrgSlug(org)) return goTo("/");
  try {
    const r = await resumeConnect(stripeDeps(), user, org, site);
    return r.ok ? Response.redirect(r.url, 303) : goTo(homeOf(org));
  } catch (e) {
    console.error("Stripe setup link failed:", e);
    return say("Stripe couldn't continue the setup just now. Go back and try again in a minute.", 502);
  }
}

// A plain message (no user text in it).
const say = (message: string, status: number) => new Response(message, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

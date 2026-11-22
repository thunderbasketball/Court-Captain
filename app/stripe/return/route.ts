import { currentUser } from "@/lib/auth/server";
import { isOrgOwner } from "@/lib/org-admin";
import { db } from "@/lib/db";
import { isOrgSlug } from "@/lib/orgs";
import { refresh } from "@/lib/stripe/connect";
import { goTo, homeOf, stripeDeps } from "../deps";

// Back from Stripe's sign-up: asks Stripe whether the organization's account can take payments now, then its Home.
export async function GET(request: Request) {
  const org = new URL(request.url).searchParams.get("org");
  const user = await currentUser();
  if (!user) return goTo("/login");
  if (!isOrgSlug(org)) return goTo("/");
  if (await isOrgOwner(db, user.coachId, org))
    await refresh(stripeDeps(), org).catch((e) => console.error("Stripe account check failed:", e)); // the gear asks again later
  return goTo(homeOf(org));
}

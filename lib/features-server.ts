import "server-only";
import { notFound } from "next/navigation";
import { db } from "./db";
import { NO_FEATURE, hasFeature, type Feature } from "./features";
import type { OrgSlug } from "./orgs";

// For pages: an organization without this feature gets "not found", even from a typed-in link.
export async function requireFeature(org: OrgSlug, feature: Feature) {
  if (!(await hasFeature(db, org, feature))) notFound();
}

// For server actions: the refusal to return when the organization doesn't have this feature, else null.
export async function featureRefusal(org: OrgSlug, feature: Feature) {
  return (await hasFeature(db, org, feature)) ? null : { ok: false as const, message: NO_FEATURE };
}

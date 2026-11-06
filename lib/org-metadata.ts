// Each organization's pages (and its login link) show its logo as the browser tab's icon and its name in the tab's
// title, so a tab says whose it is. Falls back to CourtCaptain's when it isn't an organization.
import type { Metadata } from "next";
import { db } from "./db";
import { orgInfo } from "./org-registry";
import { isOrgSlug } from "./orgs";

export async function orgMetadata(slug: string): Promise<Metadata> {
  if (!isOrgSlug(slug)) return {};
  const o = await orgInfo(db, slug);
  if (!o) return {};
  return { title: `${o.short} · CourtCaptain`, ...(o.logo ? { icons: { icon: o.logo, apple: o.bigLogo ?? o.logo } } : {}) };
}

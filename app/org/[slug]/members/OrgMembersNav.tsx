import { managesOfficials } from "@/lib/officials";
import { officiatingRequests } from "@/lib/officiating";
import type { SessionUser } from "@/lib/auth/service";
import { db } from "@/lib/db";
import { hasFeature } from "@/lib/features";
import { isOrgAdmin, orgHasArea } from "@/lib/org-admin";
import type { OrgSlug } from "@/lib/orgs";

// A registered organization's Members parts, the same as Thunder's: Staff (its Owners and Admins) and Coaches (Admins
// and Directors of Teams; with Team Management).
export async function orgMemberParts(user: SessionUser, slug: string) {
  const admin = await isOrgAdmin(db, user.coachId, slug as OrgSlug);
  const teams = await hasFeature(db, slug as OrgSlug, "team-building");
  const parts: { key: "staff" | "coaches" | "officials" | "officials-groups"; title: string; show: boolean }[] = [
    { key: "staff", title: "Staff", show: admin },
    { key: "coaches", title: "Coaches", show: teams && (admin || (await orgHasArea(db, user.coachId, slug, "teams"))) },
    // An Officials Group's officials (CourtOfficials): its Admins and Directors of Officials.
    { key: "officials", title: "Officials", show: await managesOfficials(db, user, slug) },
    // A league's officials groups (asking to officiate, approved): its Admins and Directors of Scheduling or Programs.
    { key: "officials-groups", title: "Officials Groups", show: (await officiatingRequests({ pool: db }, user, slug as OrgSlug)) !== null },
  ];
  return parts.filter((c) => c.show);
}

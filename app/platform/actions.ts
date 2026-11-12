"use server";

import { VIEW_ONLY, currentUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import * as platform from "@/lib/platform";
import { deleteOrganization as deleteOrg } from "@/lib/org-delete";

const deps = { pool: db, now: () => new Date() };

// Session checked here; the CourtCaptain Admin role is re-read inside lib/platform for every change.
async function guarded(
  fn: (
    user: NonNullable<Awaited<ReturnType<typeof currentUser>>>,
  ) => Promise<({ ok: true } & Record<string, unknown>) | { ok: false; message: string }>,
) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  try {
    return await fn(user);
  } catch (e) {
    console.error("Platform change failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}

export async function setOrgFeature(org: string, feature: string, on: boolean) {
  return guarded((u) => platform.setOrgFeature(deps, u, org, feature, on === true));
}
export async function setPlatformAdmin(coachId: string, on: boolean) {
  return guarded((u) => platform.setPlatformAdmin(deps, u, coachId, on === true));
}
export async function setOrgOwner(org: string, coachId: string, on: boolean) {
  return guarded((u) => platform.setOrgOwner(deps, u, org, coachId, on === true));
}
export async function addOrgOwnerByCell(org: string, input: { first: string; last: string; cell: string }) {
  return guarded((u) => platform.addOrgOwnerByCell(deps, u, org, input));
}

// Delete an organization and all its teams (CourtCaptain Admins; its name typed to confirm; checked in lib/org-delete).
export async function deleteOrganization(org: string, typedName: string) {
  return guarded((u) => deleteOrg(deps, u, org, typedName));
}

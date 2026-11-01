"use server";

import { VIEW_ONLY, currentUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import * as teams from "@/lib/org-teams";

// Session checked here; the organization, Team Management and the Teams area are checked in lib/org-teams.
async function guarded<T>(fn: (user: NonNullable<Awaited<ReturnType<typeof currentUser>>>) => Promise<T>) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  try {
    return await fn(user);
  } catch (e) {
    console.error("Team change failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}
const deps = () => ({ pool: db, now: () => new Date() });

export async function addTeam(org: string, input: teams.OrgTeamInput) {
  return guarded((u) => teams.createOrgTeam(deps(), u, org, input));
}
export async function removeTeam(org: string, id: string) {
  return guarded((u) => teams.deleteOrgTeam(deps(), u, org, id));
}
export async function addCoach(org: string, teamId: string, input: teams.OrgCoachInput) {
  return guarded((u) => teams.addOrgTeamCoach(deps(), u, org, teamId, input));
}
export async function removeCoach(org: string, teamId: string, coachId: string) {
  return guarded((u) => teams.removeOrgTeamCoach(deps(), u, org, teamId, coachId));
}

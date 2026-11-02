"use server";

import { VIEW_ONLY, currentUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import * as leagues from "@/lib/org-leagues";
import * as thunderLeagues from "@/lib/thunder-leagues";

// Session checked here; who may (each organization's Admins and Directors of Teams) is checked in lib/org-leagues.
async function guarded<T>(fn: (user: NonNullable<Awaited<ReturnType<typeof currentUser>>>) => Promise<T>) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  try {
    return await fn(user);
  } catch (e) {
    console.error("League change failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}
const deps = () => ({ pool: db, now: () => new Date() });

export async function registerTeam(org: string, teamId: string, programId: string, choice?: unknown) {
  return guarded((u) => leagues.registerOrgTeam(deps(), u, org, teamId, programId, choice));
}
export async function registerAll(org: string, programId: string) {
  // Thunder's teams are its own kind; every other organization's are organization teams.
  return guarded((u) =>
    org === "thunder" ? thunderLeagues.registerAllThunderTeams(deps(), u, programId) : leagues.registerAllOrgTeams(deps(), u, org, programId),
  );
}
export async function setDayOff(org: string, teamId: string, programId: string, what: string, out: boolean) {
  return guarded((u) => leagues.setOrgTeamDayOff(deps(), u, org, teamId, programId, what, out === true));
}
export async function withdrawTeam(org: string, teamId: string, programId: string) {
  return guarded((u) => leagues.withdrawOrgTeam(deps(), u, org, teamId, programId));
}

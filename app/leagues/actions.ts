"use server";

import { VIEW_ONLY, currentUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import * as leagues from "@/lib/org-leagues";
import * as thunderLeagues from "@/lib/thunder-leagues";
import * as batches from "@/lib/register-batches";

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
// `preview`: what Register all would do, nothing kept (its confirmation).
// `only`: the teams left checked in it (checked on the server).
export async function registerAll(org: string, programId: string, preview?: boolean, only?: string[]) {
  // Thunder's teams are its own kind; every other organization's are organization teams.
  const p = preview === true;
  return guarded((u) =>
    org === "thunder"
      ? thunderLeagues.registerAllThunderTeams(deps(), u, programId, p, only)
      : leagues.registerAllOrgTeams(deps(), u, org, programId, p, only),
  );
}
// Undo a Register all (who may is checked in lib/register-batches).
export async function undoRegisterAll(batchId: string) {
  return guarded((u) => batches.undoRegisterAll(deps(), u, batchId));
}
export async function setDayOff(org: string, teamId: string, programId: string, what: string, out: boolean) {
  return guarded((u) => leagues.setOrgTeamDayOff(deps(), u, org, teamId, programId, what, out === true));
}
export async function withdrawTeam(org: string, teamId: string, programId: string) {
  return guarded((u) => leagues.withdrawOrgTeam(deps(), u, org, teamId, programId));
}

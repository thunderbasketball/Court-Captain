"use server";

import { VIEW_ONLY, currentUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import * as teams from "@/lib/org-teams";
import * as rosters from "@/lib/org-rosters";

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
export async function setAltName(org: string, id: string, alt: string) {
  return guarded((u) => teams.setOrgTeamAltName(deps(), u, org, id, alt));
}
export async function previewImport(org: string, text: string) {
  return guarded((u) => teams.previewTeamImport(deps(), u, org, text));
}
export async function importTeams(org: string, text: string) {
  return guarded((u) => teams.importTeams(deps(), u, org, text));
}
export async function undoImport(org: string, importId: string) {
  return guarded((u) => teams.undoTeamImport(deps(), u, org, importId));
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

// Rosters (checked again in lib/org-rosters).
export async function addPlayer(org: string, teamId: string, input: rosters.PlayerInput) {
  return guarded((u) => rosters.addOrgPlayer(deps(), u, org, teamId, input));
}
export async function removePlayer(org: string, teamId: string, playerId: string) {
  return guarded((u) => rosters.removeOrgPlayer(deps(), u, org, teamId, playerId));
}
export async function previewPlayers(org: string, teamId: string, text: string) {
  return guarded((u) => rosters.previewPlayerImport(deps(), u, org, teamId, text));
}
export async function importPlayers(org: string, teamId: string, text: string) {
  return guarded((u) => rosters.importOrgPlayers(deps(), u, org, teamId, text));
}

// A Head Coach named without a cell yet: fix the name, or remove them (null). Their cell goes through addCoach (Head
// Coach). Checked again in lib/org-teams.
export async function saveWaitingCoach(org: string, teamId: string, input: { first: string; last: string } | null) {
  return guarded((u) => teams.setOrgWaitingCoach(deps(), u, org, teamId, input));
}
export async function saveHeadCoachEmail(org: string, teamId: string, email: string) {
  return guarded((u) => teams.setOrgHeadCoachEmail(deps(), u, org, teamId, String(email)));
}

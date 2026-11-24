"use server";

import { VIEW_ONLY, currentUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import * as teams from "@/lib/org-teams";
import * as rosters from "@/lib/org-rosters";
import * as league from "@/lib/league-roster";

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
export async function editTeam(org: string, id: string, input: { gender: unknown; grades: unknown; level: unknown }) {
  return guarded((u) => teams.updateOrgTeam(deps(), u, org, id, input));
}
// Many teams' Alternate names at once (Teams card → Edit team names; checked in lib/org-teams).
export async function setAltNames(org: string, list: { id: string; alt: string }[]) {
  return guarded((u) => teams.setOrgTeamAltNames(deps(), u, org, list));
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
// Fill in (or fix) a player's birthdate on the roster (checked in lib/org-rosters).
export async function setPlayerBirthdate(org: string | null, teamId: string, playerId: string, birthdate: string) {
  return guarded((u) =>
    org === null ? league.setLeagueBirthdate(deps(), u, teamId, playerId, birthdate) : rosters.setOrgPlayerBirthdate(deps(), u, org, teamId, playerId, birthdate),
  );
}
// Fix a player's name or grade (`org` null: a League team kept by the League).
export async function setPlayerInfo(org: string | null, teamId: string, playerId: string, input: { first: string; last: string; grade: string }) {
  return guarded((u) =>
    org === null ? league.setLeaguePlayerInfo(deps(), u, teamId, playerId, input) : rosters.setOrgPlayerInfo(deps(), u, org, teamId, playerId, input),
  );
}
export async function removePlayer(org: string, teamId: string, playerId: string) {
  return guarded((u) => rosters.removeOrgPlayer(deps(), u, org, teamId, playerId));
}
// Import players (`org` null: a League team kept by the League). The form says which column holds what (checked again
// in lib/org-rosters and lib/league-roster).
export async function previewPlayers(org: string | null, teamId: string, text: string, layout: { columns: string[]; header: boolean }) {
  return guarded((u) => (org === null ? league.previewLeagueImport(deps(), u, teamId, text, layout) : rosters.previewPlayerImport(deps(), u, org, teamId, text, layout)));
}
// The Preview's rows (some fixed by hand there): checked again on the server, then shown again or added.
type ImportRow = { line: number; first: string; last: string; grade: string; jersey: string; birthdate: string };
export async function recheckPlayers(org: string | null, teamId: string, rows: ImportRow[]) {
  return guarded((u) => (org === null ? league.previewLeagueRows(deps(), u, teamId, rows) : rosters.previewPlayerRows(deps(), u, org, teamId, rows)));
}
export async function importPlayers(org: string | null, teamId: string, rows: ImportRow[]) {
  return guarded((u) => (org === null ? league.importLeagueRows(deps(), u, teamId, rows) : rosters.importPlayerRows(deps(), u, org, teamId, rows)));
}

// A Head Coach named without a cell yet: fix the name, or remove them (null). Their cell goes through addCoach (Head
// Coach). Checked again in lib/org-teams.
export async function saveWaitingCoach(org: string, teamId: string, input: { first: string; last: string } | null) {
  return guarded((u) => teams.setOrgWaitingCoach(deps(), u, org, teamId, input));
}
export async function saveHeadCoachEmail(org: string, teamId: string, email: string) {
  return guarded((u) => teams.setOrgHeadCoachEmail(deps(), u, org, teamId, String(email)));
}

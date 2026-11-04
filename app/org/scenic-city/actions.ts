"use server";

import { VIEW_ONLY, currentUser } from "@/lib/auth/server";
import { featureRefusal } from "@/lib/features-server";
import type { Feature } from "@/lib/features";
import { db } from "@/lib/db";
import * as scenic from "@/lib/scenic";
import * as partners from "@/lib/scenic-partners";
import * as programs from "@/lib/scenic-programs";
import * as teams from "@/lib/scenic-teams";
import * as clubs from "@/lib/scenic-club-teams";
import * as matchups from "@/lib/scenic-matchups";
import * as grid from "@/lib/scenic-grid";
import type { JoinInput } from "@/lib/scenic";

const deps = { pool: db, now: () => new Date() };

// Session (and, inside lib/scenic, the Scenic City role) checked on the server for every change.
async function guarded<T>(fn: (user: NonNullable<Awaited<ReturnType<typeof currentUser>>>) => Promise<T>, feature?: Feature) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  const refused = feature && (await featureRefusal("scenic-city", feature));
  if (refused) return refused;
  try {
    return await fn(user);
  } catch (e) {
    console.error("Scenic City change failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}

export async function requestJoin(input: JoinInput) {
  return guarded((u) => scenic.requestJoin(deps, u, input));
}
export async function approveRequest(coachId: string, as: string) {
  return guarded((u) => scenic.approveRequest(deps, u, coachId, as));
}
export async function denyRequest(coachId: string) {
  return guarded((u) => scenic.denyRequest(deps, u, coachId));
}
export async function setScenicRoles(coachId: string, roles: string[]) {
  return guarded((u) => scenic.setScenicRoles(deps, u, coachId, roles));
}

// ---- Partners, gyms, courts, game days (rules and role checks in lib/scenic-partners) ----

export async function savePartner(id: string | null, input: partners.PartnerInput) {
  return guarded((u) => partners.savePartner(deps, u, id, input), "hosting-partners");
}
export async function saveGym(partnerId: string, gymId: string | null, input: { name: string; address: string }) {
  return guarded((u) => partners.saveGym(deps, u, partnerId, gymId, input), "hosting-partners");
}
export async function deleteGym(gymId: string) {
  return guarded((u) => partners.deleteGym(deps, u, gymId), "hosting-partners");
}
export async function addCourt(gymId: string, name: string) {
  return guarded((u) => partners.addCourt(deps, u, gymId, name), "hosting-partners");
}
export async function deleteCourt(courtId: string) {
  return guarded((u) => partners.deleteCourt(deps, u, courtId), "hosting-partners");
}
export async function setHours(partnerId: string, input: partners.HoursInput) {
  return guarded((u) => partners.setHours(deps, u, partnerId, input), "hosting-partners");
}
export async function setContact(partnerId: string, coachId: string, on: boolean) {
  return guarded((u) => partners.setContact(deps, u, partnerId, coachId, on), "hosting-partners");
}

// ---- Teams (rules and role checks in lib/scenic-teams) ----

export async function createScenicTeam(input: teams.TeamInput) {
  return guarded((u) => teams.createScenicTeam(deps, u, input), "team-registration");
}
export async function updateScenicTeam(id: string, input: teams.TeamInput) {
  return guarded((u) => teams.updateScenicTeam(deps, u, id, input), "team-registration");
}
export async function setScenicCoachEmail(id: string, email: string) {
  return guarded((u) => teams.setScenicCoachEmail(deps, u, id, String(email)), "team-registration");
}
export async function deleteScenicTeam(id: string) {
  return guarded((u) => teams.deleteScenicTeam(deps, u, id), "team-registration");
}

// ---- Programs (rules and role checks in lib/scenic-programs) ----

export async function saveProgram(id: string | null, input: programs.ProgramInput) {
  return guarded((u) => programs.saveProgram(deps, u, id, input), "programs");
}
export async function deleteProgram(id: string) {
  return guarded((u) => programs.deleteProgram(deps, u, id), "programs");
}
export async function registerTeam(programId: string, teamId: string, choice?: unknown) {
  return guarded((u) => programs.registerTeam(deps, u, programId, teamId, choice), "programs");
}
export async function registerAllScenicTeams(programId: string) {
  return guarded((u) => programs.registerAllScenicTeams(deps, u, programId), "programs");
}
export async function setTeamOff(programId: string, teamId: string, what: string, out: boolean) {
  return guarded((u) => programs.setTeamOff(deps, u, programId, teamId, what, out === true), "programs");
}
export async function withdrawTeam(programId: string, teamId: string) {
  return guarded((u) => programs.withdrawTeam(deps, u, programId, teamId), "programs");
}
export async function setPaid(programId: string, teamId: string, paid: boolean) {
  return guarded((u) => programs.setPaid(deps, u, programId, teamId, paid === true), "programs");
}
export async function copyDivisions(programId: string, fromProgramId: string) {
  return guarded((u) => programs.copyDivisions(deps, u, programId, fromProgramId), "programs");
}
export async function addDivision(programId: string, input: programs.DivisionInput) {
  return guarded((u) => programs.addDivision(deps, u, programId, input), "programs");
}
export async function removeDivision(id: string) {
  return guarded((u) => programs.removeDivision(deps, u, id), "programs");
}
export async function addPool(groupId: string) {
  return guarded((u) => programs.addPool(deps, u, groupId), "programs");
}
export async function removePool(poolId: string) {
  return guarded((u) => programs.removePool(deps, u, poolId), "programs");
}
export async function moveTeam(programId: string, teamId: string, poolId: string) {
  return guarded((u) => programs.moveTeam(deps, u, programId, teamId, poolId), "programs");
}
export async function saveProgramDates(programId: string, input: { add: string[]; addBrackets: string[]; remove: string[] }) {
  return guarded((u) => programs.saveProgramDates(deps, u, programId, input), "programs");
}

// Outside clubs' teams (Directors of Teams; checked in lib/scenic-club-teams).
export async function addClubTeam(input: clubs.ClubTeamInput) {
  return guarded((u) => clubs.addClubTeam(deps, u, input), "team-registration");
}
export async function previewClubImport(text: string) {
  return guarded((u) => clubs.previewClubImport(deps, u, text), "team-registration");
}
export async function importClubTeams(text: string) {
  return guarded((u) => clubs.importClubTeams(deps, u, text), "team-registration");
}
export async function undoClubImport(id: string) {
  return guarded((u) => clubs.undoClubImport(deps, u, id), "team-registration");
}

// Scheduler: create (or create again) one division's matchups on a Game Day (Admins and Directors of Scheduling).
export async function createMatchups(programId: string, day: string, divisionId: string) {
  return guarded((u) => matchups.createMatchups(deps, u, programId, day, divisionId), "programs");
}
export async function saveMatchups(programId: string, day: string, divisionId: string, games: [string, string][]) {
  return guarded((u) => matchups.saveMatchups(deps, u, programId, day, divisionId, games), "programs");
}
// Scheduler Grid: a Game Day's game length in minutes (Admins and Directors of Scheduling).
export async function setGameLength(day: string, minutes: number) {
  return guarded((u) => grid.setGameLength(deps, u, day, minutes), "programs");
}
// Scheduler Grid: put a game in a slot (court and start time), move it, or take it off the grid (null).
export async function placeGame(matchupId: string, slot: { court: string; starts: string } | null) {
  return guarded((u) => grid.placeGame(deps, u, matchupId, slot), "programs");
}

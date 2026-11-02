"use server";

import { VIEW_ONLY, currentUser } from "@/lib/auth/server";
import { featureRefusal } from "@/lib/features-server";
import type { Feature } from "@/lib/features";
import { db } from "@/lib/db";
import * as evaluations from "@/lib/evaluations";
import * as rosters from "@/lib/rosters";
import * as teams from "@/lib/teams";
import * as thunderImport from "@/lib/thunder-team-import";
import * as uniforms from "@/lib/uniforms";
import type { CreateTeamInput, CreateTeamResult, UpdateTeamInput } from "@/lib/teams";

const deps = { pool: db, now: () => new Date() };
type Result = ({ ok: true } & object) | { ok: false; message: string };

// Session and role are checked again inside each lib/teams function.
async function guarded<T extends Result>(
  fn: (user: NonNullable<Awaited<ReturnType<typeof currentUser>>>) => Promise<T>,
  feature: Feature = "team-building",
): Promise<T | { ok: false; message: string }> {
  const user = await currentUser();
  if (!user) return { ok: false, message: "Please log in again." };
  if (user.actingBy) return { ok: false, message: VIEW_ONLY };
  const refused = await featureRefusal("thunder", feature);
  if (refused) return refused;
  try {
    return await fn(user);
  } catch (e) {
    console.error("Team change failed:", e);
    return { ok: false, message: "Something went wrong. Please try again." };
  }
}

export async function createTeam(input: CreateTeamInput): Promise<CreateTeamResult> {
  return guarded((u) => teams.createTeam(deps, u, input));
}

// Import teams (pasted or a CSV): preview, add the new ones, undo an import.
export async function previewThunderImport(text: string) {
  return guarded((u) => thunderImport.previewThunderImport(deps, u, text));
}
export async function importThunderTeams(text: string) {
  return guarded((u) => thunderImport.importThunderTeams(deps, u, text));
}
export async function undoThunderImport(importId: string) {
  return guarded((u) => thunderImport.undoThunderImport(deps, u, importId));
}

export async function deleteTeam(id: string) {
  return guarded((u) => teams.deleteTeam(deps, u, String(id)));
}
export async function updateTeam(id: string, input: UpdateTeamInput) {
  return guarded((u) => teams.updateTeam(deps, u, String(id), input));
}

export async function addStaff(teamId: string, input: { role: unknown; person: unknown }) {
  return guarded((u) => teams.addStaff(deps, u, String(teamId), input));
}

export async function removeStaff(teamId: string, input: { coachId: unknown; role: unknown }) {
  return guarded((u) => teams.removeStaff(deps, u, String(teamId), input));
}

export async function addPlayers(teamId: string, ids: string[]) {
  return guarded((u) => rosters.addPlayers(deps, u, String(teamId), ids));
}
export async function removePlayer(teamId: string, registrantId: string) {
  return guarded((u) => rosters.removePlayer(deps, u, String(teamId), String(registrantId)));
}

// changes: only the fields that changed (checked again in lib/evaluations).
export async function saveEvaluation(teamId: string, registrantId: string, changes: Record<string, unknown>) {
  return guarded((u) => evaluations.saveEvaluation(deps, u, String(teamId), String(registrantId), changes));
}

export async function saveUniform(
  teamId: string,
  registrantId: string,
  changes: { number?: string | null; size?: string | null },
) {
  const clean = changes && typeof changes === "object" ? changes : {};
  return guarded((u) => uniforms.saveUniform(deps, u, String(teamId), String(registrantId), clean), "uniforms");
}

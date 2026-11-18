"use server";

import { VIEW_ONLY, currentUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { draftPlay, type DraftInput } from "@/lib/play-draft";
import { addPlay, changePlay, copyPlay, removeFormation, removePlay, saveFormation, type FormationInput, type PlayInput } from "@/lib/playbook";

const deps = { pool: db, now: () => new Date() };
const LOGIN = { ok: false as const, message: "Please log in again." };

// A playbook (CourtPlaybook): a team's, or (teamId "") the organization's own. Who may change it is checked inside
// lib/playbook.
export async function addTeamPlay(org: string, teamId: string, input: PlayInput) {
  const user = await currentUser();
  if (!user) return LOGIN;
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  return addPlay(deps, user, { org: String(org), teamId: String(teamId) }, input);
}

export async function changeTeamPlay(org: string, teamId: string, id: string, input: PlayInput) {
  const user = await currentUser();
  if (!user) return LOGIN;
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  return changePlay(deps, user, { org: String(org), teamId: String(teamId) }, id, input);
}

export async function removeTeamPlay(org: string, teamId: string, id: string) {
  const user = await currentUser();
  if (!user) return LOGIN;
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  return removePlay(deps, user, { org: String(org), teamId: String(teamId) }, id);
}

// A play from a library (the organization's, or another organization's Public play) copied into this playbook.
export async function copyLibraryPlay(org: string, teamId: string, id: string) {
  const user = await currentUser();
  if (!user) return LOGIN;
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  return copyPlay(deps, user, { org: String(org), teamId: String(teamId) }, id);
}

// A playbook's own Base Formation: added (id null), changed, or deleted.
export async function savePlayFormation(org: string, teamId: string, id: string | null, input: FormationInput) {
  const user = await currentUser();
  if (!user) return LOGIN;
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  return saveFormation(deps, user, { org: String(org), teamId: String(teamId) }, id === null ? null : String(id), input);
}

export async function removePlayFormation(org: string, teamId: string, id: string) {
  const user = await currentUser();
  if (!user) return LOGIN;
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  return removeFormation(deps, user, { org: String(org), teamId: String(teamId) }, String(id));
}

// ✨ Draft from description: Claude drafts the play's drawing from the coach's words (nothing is saved).
export async function draftTeamPlay(org: string, teamId: string, input: DraftInput) {
  const user = await currentUser();
  if (!user) return LOGIN;
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  return draftPlay(deps, user, { org: String(org), teamId: String(teamId) }, input);
}

"use server";

import { VIEW_ONLY, currentUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { addPlay, changePlay, copyPlay, removePlay, sharePlay, type PlayInput } from "@/lib/playbook";

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

// A team's play shared with the organization (or not any more).
export async function shareTeamPlay(org: string, teamId: string, id: string, on: boolean) {
  const user = await currentUser();
  if (!user) return LOGIN;
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  return sharePlay(deps, user, { org: String(org), teamId: String(teamId) }, id, on === true);
}

// A play from the organization's library copied into this playbook.
export async function copyLibraryPlay(org: string, teamId: string, id: string) {
  const user = await currentUser();
  if (!user) return LOGIN;
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  return copyPlay(deps, user, { org: String(org), teamId: String(teamId) }, id);
}

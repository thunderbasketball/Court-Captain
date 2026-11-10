"use server";

import { VIEW_ONLY, currentUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { addOwnPractice, removeOwnPractice, type OwnPracticeInput } from "@/lib/team-practices";

const deps = { pool: db, now: () => new Date() };
const LOGIN = { ok: false as const, message: "Please log in again." };

// A team's own practices (a place it found itself). Who may change them is checked inside lib/team-practices.
export async function addTeamPractice(org: string, teamId: string, input: OwnPracticeInput) {
  const user = await currentUser();
  if (!user) return LOGIN;
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  const r = await addOwnPractice(deps, user, { org: String(org), teamId: String(teamId) }, input);
  return r.ok ? { ok: true as const, added: r.added.length, skipped: r.skipped.length } : r;
}

export async function removeTeamPractice(org: string, teamId: string, id: string, laterWeeks: boolean) {
  const user = await currentUser();
  if (!user) return LOGIN;
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  return removeOwnPractice(deps, user, { org: String(org), teamId: String(teamId) }, id, laterWeeks === true);
}

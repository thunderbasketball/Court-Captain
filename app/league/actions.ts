"use server";

import { db } from "@/lib/db";
import { hasFeature } from "@/lib/features";
import { followedTeams, publicLeague } from "@/lib/public-league";
import { easternDate } from "@/lib/time";

// One program's public Teams and Schedule, loaded when it's opened on the login page. No login on purpose: only what the
// public League page already shows (team names, groups, game times and places; no contact information), and only a
// program on the public list (registration opened, ended no more than 30 days ago).
export async function loadPublicProgram(org: string, id: string) {
  if (org !== "scenic-city" || !(await hasFeature(db, org, "programs"))) return { ok: false as const, message: "Not found." };
  const now = new Date();
  const p = await publicLeague(db, now, String(id));
  if (!p) return { ok: false as const, message: "That program isn't public right now." };
  return { ok: true as const, groups: p.groups, schedule: p.schedule, today: easternDate(now) };
}

// My Teams on the login page: the teams a device follows (ids kept on the device; nothing stored here). The same public
// details only: team names, groups, game times and places.
export async function loadFollowedTeams(org: string, ids: string[]) {
  if (org !== "scenic-city" || !(await hasFeature(db, org, "programs"))) return { ok: false as const, message: "Not found." };
  const now = new Date();
  return { ok: true as const, teams: await followedTeams(db, now, ids), today: easternDate(now) };
}

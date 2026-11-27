"use server";

import { db } from "@/lib/db";
import { hasFeature } from "@/lib/features";
import { isOrgSlug } from "@/lib/orgs";
import { leagueGyms } from "@/lib/league-gyms";
import { MAX_FOLLOWED, followedTeams, publicLeague } from "@/lib/public-league";
import { easternDate } from "@/lib/time";
import { publicly } from "@/lib/public-cache";
import { findableTeams, searchTeams } from "@/lib/team-finder";

// One program's public Teams and Schedule, loaded when it's opened on the login page. No login on purpose: only what the
// public League page already shows (team names, groups, game times and places; no contact information), and only a
// program on the public list (registration opened, ended no more than 30 days ago).
export async function loadPublicProgram(org: string, id: string) {
  if (!isOrgSlug(org) || !(await hasFeature(db, org, "programs"))) return { ok: false as const, message: "Not found." };
  const now = new Date();
  if (!/^\d{1,18}$/.test(String(id))) return { ok: false as const, message: "That program isn't public right now." };
  const today = easternDate(now);
  const p = await publicly(`program:${today}:${org}:${id}`, () => publicLeague(db, now, String(id), org)); // only that organization's programs
  if (!p) return { ok: false as const, message: "That program isn't public right now." };
  const gyms = p.kind === "League" ? await publicly(`league-gyms:${today}:${p.id}`, () => leagueGyms(db, now, p.id)) : null;
  return { ok: true as const, gyms, groups: p.groups, schedule: p.schedule, soon: p.soon, today };
}

// My Teams on the login page: the teams a device follows (ids kept on the device; nothing stored here). The same public
// details only: team names, groups, game times and places.
// Any organization's page: one that runs programs shows its own programs' games; one whose teams play in someone else's
// League (Thunder in Scenic City's) shows every public program's.
export async function loadFollowedTeams(org: string, ids: string[]) {
  if (!isOrgSlug(org)) return { ok: false as const, message: "Not found." };
  const now = new Date();
  const today = easternDate(now);
  const list = Array.isArray(ids) ? [...new Set(ids.filter((x) => typeof x === "string" && /^\d{1,18}$/.test(x)))].slice(0, MAX_FOLLOWED) : [];
  const own = await hasFeature(db, org, "programs");
  const teams = await publicly(`followed:${today}:${own ? org : "*"}:${list.join(",")}`, () => followedTeams(db, now, list, own ? org : undefined));
  return { ok: true as const, teams, today };
}

// Find your team, as they type a coach's last name (no login): teams only, no coach's name or contact. The list is read at
// most every 30 seconds and searched here, never sent whole.
export async function findTeams(org: string, text: string) {
  if (!isOrgSlug(org) || !(await hasFeature(db, org, "programs"))) return { ok: false as const, message: "Not found." };
  const now = new Date();
  const teams = await publicly(`find:${easternDate(now)}:${org}`, () => findableTeams(db, now, org));
  return { ok: true as const, teams: searchTeams(teams, text) };
}

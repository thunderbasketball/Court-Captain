"use server";

import { VIEW_ONLY, currentUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { addLeagueDates } from "@/lib/league-dates";
import { actionBase, stripeDeps } from "../../../../stripe/deps";
import { addLeaguePlayer, removeLeaguePlayer, removeLeagueStaff, saveLeagueStaff } from "@/lib/league-roster";

const deps = { pool: db, now: () => new Date() };

// Session checked here; who may (the team's coach, Scenic City's Directors of Teams) in lib/league-roster.
async function guarded<T>(fn: (user: NonNullable<Awaited<ReturnType<typeof currentUser>>>) => Promise<T>) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  try {
    return await fn(user);
  } catch (e) {
    console.error("League roster change failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}

export async function addPlayerToLeagueTeam(teamId: string, input: { first: string; last: string; grade: string; jersey: string; birthdate: string }) {
  return guarded((u) => addLeaguePlayer(deps, u, String(teamId), input));
}
export async function removePlayerFromLeagueTeam(playerId: string) {
  return guarded((u) => removeLeaguePlayer(deps, u, String(playerId)));
}
export async function saveLeagueTeamStaff(teamId: string, input: { role: string; first: string; last: string; cell: string; email: string }) {
  return guarded((u) => saveLeagueStaff(deps, u, String(teamId), input));
}
export async function removeLeagueTeamStaff(teamId: string, role: string) {
  return guarded((u) => removeLeagueStaff(deps, u, String(teamId), String(role)));
}

// Add dates (and a 2nd Game) to a registration the team already has; who may is checked in lib/league-dates.
// When it costs something and the League takes cards, `pay` is Stripe Checkout's address: added once Stripe says it's paid.
// `inPage`: Stripe's form opens in the page (`payInPage`) instead of Stripe's own page.
export async function addDatesToLeagueTeam(programId: string, teamId: string, choice: unknown, inPage = false) {
  const base = await actionBase();
  return guarded((u) => addLeagueDates(stripeDeps(), u, String(programId), String(teamId), choice, base, inPage === true));
}

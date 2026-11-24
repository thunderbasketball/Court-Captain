"use server";

import { VIEW_ONLY, currentUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { setLeagueNumbers, setOrgNumbers } from "@/lib/roster-numbers";

const deps = () => ({ pool: db, now: () => new Date() });

// Uniform numbers for a typed-in roster's players (all saved or none). `org` null: a League team kept by Scenic City.
// Session checked here; who may change that roster in lib/roster-numbers.
export async function saveRosterNumbers(org: string | null, teamId: string, numbers: { id: string; number: string }[]) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  try {
    return org === null ? await setLeagueNumbers(deps(), user, teamId, numbers) : await setOrgNumbers(deps(), user, org, teamId, numbers);
  } catch (e) {
    console.error("Roster numbers failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}

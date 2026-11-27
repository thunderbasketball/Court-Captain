"use server";

import { VIEW_ONLY, currentUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { saveLeagueBlock, saveRequest, saveRequestSettings, setRequestDay, setSitOut } from "@/lib/schedule-requests";

const deps = { pool: db, now: () => new Date() };

// Session checked here; who may do it (team coaches, Directors of Programs or Scheduling) in lib/schedule-requests.
async function guarded<T>(fn: (user: NonNullable<Awaited<ReturnType<typeof currentUser>>>) => Promise<T>) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  try {
    return await fn(user);
  } catch (e) {
    console.error("Schedule request failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}

// A team's blocked time blocks for one Game Day (up to 2).
export async function saveScheduleRequest(teamId: string, programId: string, day: string, blocks: string[]) {
  return guarded((u) => saveRequest(deps, u, String(teamId), String(programId), String(day), blocks));
}

// A League's Game Day takes schedule requests (on) or not.
export async function setScheduleRequestDay(programId: string, day: string, on: boolean) {
  return guarded((u) => setRequestDay(deps, u, String(programId), String(day), on === true));
}

// A League's time blocks and how many a team can check (Directors of Programs or Scheduling).
export async function saveScheduleRequestSettings(
  programId: string,
  input: { blocks: { start: string; end: string }[]; max: number; compDays?: string; recDays?: string },
) {
  return guarded((u) => saveRequestSettings(deps, u, String(programId), input));
}

// The team sits out one of its dates or the Brackets (out), or plays it again.
export async function setScheduleSitOut(teamId: string, programId: string, what: string, out: boolean) {
  return guarded((u) => setSitOut(deps, u, String(teamId), String(programId), String(what), out === true));
}

// The League's own blocks for a team on one Game Day, by the hour (its Owners, Admins and Directors of Scheduling).
export async function saveLeagueHourBlock(teamId: string, programId: string, day: string, hours: number[]) {
  return guarded((u) => saveLeagueBlock(deps, u, String(teamId), String(programId), String(day), hours));
}

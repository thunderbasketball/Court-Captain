"use server";

import { VIEW_ONLY, currentUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { saveRequest, setRequestDay, setSitOut } from "@/lib/schedule-requests";

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

// The team sits out one of its dates or the Brackets (out), or plays it again.
export async function setScheduleSitOut(teamId: string, programId: string, what: string, out: boolean) {
  return guarded((u) => setSitOut(deps, u, String(teamId), String(programId), String(what), out === true));
}

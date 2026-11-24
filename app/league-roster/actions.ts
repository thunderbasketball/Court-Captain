"use server";

import { VIEW_ONLY, currentUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { addSnapshotPlayer, setSnapshotPlayer } from "@/lib/roster-snapshot";

const deps = { pool: db, now: () => new Date() };

// Session checked here; who may (the League's Owners, Admins and Directors of Teams) in lib/roster-snapshot.
async function guarded<T>(fn: (user: NonNullable<Awaited<ReturnType<typeof currentUser>>>) => Promise<T>) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  try {
    return await fn(user);
  } catch (e) {
    console.error("League roster fix failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}

export async function addToLeagueRoster(
  programId: string,
  teamId: string,
  input: { first: string; last: string; grade: string; jersey: string; birthdate: string },
) {
  return guarded((u) => addSnapshotPlayer(deps, u, programId, teamId, input));
}
export async function setOnLeagueRoster(playerId: string, off: boolean) {
  return guarded((u) => setSnapshotPlayer(deps, u, playerId, off));
}

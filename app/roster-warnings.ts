"use server";

import { currentUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { rosterAddWarnings, type WarnTarget } from "@/lib/roster-warnings";

// What to warn about before adding these players (who may is checked in lib/roster-warnings). Never stops an add: no login,
// or something went wrong, is no warnings.
export async function rosterWarnings(target: WarnTarget, players: unknown[]): Promise<string[]> {
  const user = await currentUser();
  if (!user || user.actingBy) return [];
  try {
    return await rosterAddWarnings({ pool: db, now: () => new Date() }, user, target, players);
  } catch (e) {
    console.error("Roster warnings failed:", e);
    return [];
  }
}

"use server";

import { VIEW_ONLY, currentUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { saveScore } from "@/lib/scores";

// A game's final score, a forfeit, or clearing it. Session checked here; who may (a Director of Scores of the gym's
// organization or the League's) in lib/scores.
export async function saveGameScore(matchupId: string, input: { home: string; away: string; forfeit: "" | "home" | "away" }) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  try {
    return await saveScore({ pool: db, now: () => new Date() }, user, String(matchupId), input);
  } catch (e) {
    console.error("Score save failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}

"use server";

import { db } from "@/lib/db";
import { gameDetails } from "@/lib/game-details";

// A published League game's details, opened from a schedule. No login needed: only what public pages already show
// (checked in lib/game-details: published, both teams, no simulated teams).
export async function loadGameDetails(id: string) {
  try {
    return await gameDetails(db, String(id));
  } catch (e) {
    console.error("Game details failed:", e);
    return null;
  }
}

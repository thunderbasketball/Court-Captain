"use server";

import { VIEW_ONLY, currentUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { deletePlayerProgram, savePlayerProgram, type PlayerProgramInput } from "@/lib/player-programs";

// Add (id null) or change a player program (who may is checked in lib/player-programs).
export async function changePlayerProgram(org: string, id: string | null, input: PlayerProgramInput) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  try {
    return await savePlayerProgram({ pool: db, now: () => new Date() }, user, String(org), id, input);
  } catch (e) {
    console.error("Program save failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}

// Delete an empty player program (checked in lib/player-programs).
export async function removePlayerProgram(org: string, id: string) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  try {
    return await deletePlayerProgram({ pool: db, now: () => new Date() }, user, String(org), id);
  } catch (e) {
    console.error("Program delete failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}

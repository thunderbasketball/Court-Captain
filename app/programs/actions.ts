"use server";

import { createEvent } from "@/lib/events";
import { VIEW_ONLY, currentUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { addGymAtPlace } from "@/lib/places";
import { deletePlayerProgram, savePlayerProgram, type PlayerProgramInput } from "@/lib/player-programs";

// Add (id null) or change a player program (who may is checked in lib/player-programs).
// A tryout added on the program's form: Boys, Girls or Coed, its grades, the day, time and place.
export type TryoutInput = { gender: string; grades: string[]; date: string; time: string; location: string };

// Saves the program; then each tryout added on its form becomes one of its Tryouts sessions (sign-up open during its
// tryout registration dates; checked again in lib/events). Tryouts that couldn't be added are named.
export async function changePlayerProgram(org: string, id: string | null, input: PlayerProgramInput, tryouts: TryoutInput[] = []) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  try {
    const deps = { pool: db, now: () => new Date() };
    const r = await savePlayerProgram(deps, user, String(org), id, input);
    if (!r.ok || !Array.isArray(tryouts) || !tryouts.length) return r;
    const problems: string[] = [];
    let added = 0;
    for (const t of tryouts.slice(0, 40)) {
      const e = await createEvent(deps, user, {
        kind: "Tryouts",
        gender: t?.gender,
        grades: t?.grades,
        date: t?.date,
        time: t?.time,
        location: t?.location ?? "",
        notes: "",
        staff: [],
        programId: r.id,
      });
      if (e.ok) added++;
      else problems.push(`${t?.gender ?? ""} ${Array.isArray(t?.grades) ? t.grades.join(", ") : ""}: ${e.message}`.trim());
    }
    return { ...r, tryoutsAdded: added, problems };
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

// "+ Add a facility…" on a tryout's Place: a gym from its looked-up location (checked in lib/places).
export async function addFacilityAt(org: string, placeId: string, session: string) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  try {
    return await addGymAtPlace({ pool: db, now: () => new Date() }, user, String(org), placeId, session);
  } catch (e) {
    console.error("Add facility failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}

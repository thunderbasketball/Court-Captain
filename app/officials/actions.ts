"use server";

import { VIEW_ONLY, currentUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { addOfficial, removeOfficial } from "@/lib/officials";

// Session checked here; who may (Admins and Directors of Officials, with CourtSync's Scheduler side) in lib/officials.
export async function addOfficialAction(org: string, input: { first: string; last: string; cell: string }) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  try {
    return await addOfficial({ pool: db, now: () => new Date() }, user, org, input);
  } catch (e) {
    console.error("Add official failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}

export async function removeOfficialAction(org: string, coachId: string) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  try {
    return await removeOfficial({ pool: db }, user, org, coachId);
  } catch (e) {
    console.error("Remove official failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}

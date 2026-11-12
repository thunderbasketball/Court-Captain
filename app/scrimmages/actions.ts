"use server";

import { VIEW_ONLY, currentUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { isOrgSlug } from "@/lib/orgs";
import { addScrimmage, removeScrimmage, updateScrimmage, type ScrimmageInput } from "@/lib/scrimmages";

// Session checked here; who may (Directors, a playing team's Head Coach) and everything else in lib/scrimmages.
async function guarded<T>(org: string, fn: (user: NonNullable<Awaited<ReturnType<typeof currentUser>>>) => Promise<T>) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  if (!isOrgSlug(org)) return { ok: false as const, message: "That organization wasn't found." };
  try {
    return await fn(user);
  } catch (e) {
    console.error("Scrimmage change failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}

export async function addScrimmageAction(org: string, programId: string, input: ScrimmageInput) {
  return guarded(org, (u) => addScrimmage({ pool: db, now: () => new Date() }, u, org, programId, input));
}

export async function removeScrimmageAction(org: string, id: string) {
  return guarded(org, (u) => removeScrimmage({ pool: db, now: () => new Date() }, u, org, id));
}

export async function updateScrimmageAction(org: string, id: string, input: ScrimmageInput) {
  return guarded(org, (u) => updateScrimmage({ pool: db, now: () => new Date() }, u, org, id, input));
}

"use server";

import { VIEW_ONLY, currentUser } from "@/lib/auth/server";
import { featureRefusal } from "@/lib/features-server";
import type { Feature } from "@/lib/features";
import { db } from "@/lib/db";
import * as admin from "@/lib/practice/admin";
import type { BlackoutInput } from "@/lib/practice/admin";
import * as booking from "@/lib/practice/booking";

const deps = { pool: db, now: () => new Date() };

// Session and role are checked again inside each lib/practice function.
async function guarded<T>(
  fn: (user: NonNullable<Awaited<ReturnType<typeof currentUser>>>) => Promise<T>,
  feature: Feature = "practice",
) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  const refused = await featureRefusal("thunder", feature);
  if (refused) return refused;
  try {
    return await fn(user);
  } catch (e) {
    console.error("Practice change failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}

const iso = <T extends { startsAt: Date }>(list: T[]) => list.map((x) => ({ ...x, startsAt: x.startsAt.toISOString() }));

export async function addGym(input: { name: unknown; courts: unknown }) {
  return guarded((u) => admin.addGym(deps, u, input));
}
export async function deleteGym(gymId: string) {
  return guarded((u) => admin.deleteGym(deps, u, String(gymId)));
}
export async function blackoutDates(input: BlackoutInput) {
  return guarded(async (u) => {
    const r = await admin.blackoutDates(deps, u, input);
    return r.ok ? { ...r, removed: iso(r.removed) } : r;
  });
}
export async function deleteBlackoutRule(ruleId: string) {
  return guarded((u) => admin.deleteBlackoutRule(deps, u, ruleId));
}
export async function setSlotBlocked(input: { slotId: unknown; blocked: unknown; reason?: unknown }) {
  return guarded((u) => admin.setSlotBlocked(deps, u, input));
}
export async function bookSlot(input: { slotId: unknown; teamId: unknown; everyWeek?: unknown; asTeam?: unknown }) {
  return guarded(async (u) => {
    const r = await booking.bookSlot(deps, u, input);
    return r.ok ? { ...r, booked: iso(r.booked), skipped: iso(r.skipped) } : r;
  });
}
export async function releaseSlot(input: { slotId: unknown; everyWeek?: unknown }) {
  return guarded((u) => booking.releaseSlot(deps, u, input));
}

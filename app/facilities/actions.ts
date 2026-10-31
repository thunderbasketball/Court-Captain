"use server";

import { VIEW_ONLY, currentUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import * as facilities from "@/lib/facilities";

// Session checked here; the Facilities area and Thunder's features are checked in lib/facilities.
export async function setAvailability(input: facilities.AvailabilityInput) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  try {
    return await facilities.setAvailability({ pool: db, now: () => new Date() }, user, input);
  } catch (e) {
    console.error("Availability change failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}

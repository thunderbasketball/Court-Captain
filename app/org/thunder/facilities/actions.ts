"use server";

import { VIEW_ONLY, currentUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import * as facilities from "@/lib/facilities";
import * as gymImport from "@/lib/gym-import";

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

// A registered organization's gyms (checked again in lib/facilities).
export async function addOrgGym(org: string, input: { name: string; short: string; courts: string[] }) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  try {
    return await facilities.addOrgGym({ pool: db, now: () => new Date() }, user, org, input);
  } catch (e) {
    console.error("Add gym failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}
export async function removeOrgGym(org: string, gymId: string) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  try {
    return await facilities.removeOrgGym({ pool: db, now: () => new Date() }, user, org, gymId);
  } catch (e) {
    console.error("Remove gym failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}

// Import gyms (pasted or a CSV) for Thunder ("thunder") or another organization; checked again in lib/gym-import.
export async function previewGyms(org: string, text: string) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  try {
    return await gymImport.previewGymImport({ pool: db, now: () => new Date() }, user, String(org), text);
  } catch (e) {
    console.error("Gym preview failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}
export async function importGyms(org: string, text: string) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  try {
    return await gymImport.importGyms({ pool: db, now: () => new Date() }, user, String(org), text);
  } catch (e) {
    console.error("Gym import failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}

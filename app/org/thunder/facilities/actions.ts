"use server";

import { VIEW_ONLY, currentUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import * as facilities from "@/lib/facilities";
import * as gymImport from "@/lib/gym-import";
import { setTeamGym } from "@/lib/practice/team-gyms";
import { managesGyms, setGymPin, setGymPlace, setSchedulerPin, suggestPlaces } from "@/lib/places";

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
export async function renameGym(org: string, gymId: string, input: { name: string; short?: string }) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  try {
    return await facilities.renameGym({ pool: db, now: () => new Date() }, user, org, gymId, input);
  } catch (e) {
    console.error("Rename gym failed:", e);
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

// Gym locations (lib/places; who may is checked there): search Google Places, then set or clear a gym's place.
export async function searchPlaces(org: string, text: string, session: string) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (!(await managesGyms(db, user, String(org)))) return { ok: false as const, message: "Only an Admin or Director of Facilities can search." };
  try {
    return await suggestPlaces(text, session);
  } catch (e) {
    console.error("Places search failed:", e);
    return { ok: false as const, message: "Location search isn't working right now. Try again later." };
  }
}
export async function setGymLocation(org: string, gymId: string, placeId: string | null, session: string | null) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  try {
    return await setGymPlace({ pool: db, now: () => new Date() }, user, org, gymId, placeId, session);
  } catch (e) {
    console.error("Set gym location failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}
export async function setGymPinLocation(org: string, gymId: string, pin: string, address: string) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  try {
    return await setGymPin({ pool: db, now: () => new Date() }, user, org, gymId, { pin, address });
  } catch (e) {
    console.error("Set gym pin failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}
export async function removeGymPin(org: string, gymId: string) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  try {
    return await setGymPin({ pool: db, now: () => new Date() }, user, org, gymId, null);
  } catch (e) {
    console.error("Remove gym pin failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}

// A CourtSync Scheduler's own pin for a gym its games use (who may is checked in lib/places): set (pin + label) or remove.
export async function setSchedulerGymPin(org: string, gymKey: string, pin: string | null, label: string | null) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  try {
    return await setSchedulerPin({ pool: db, now: () => new Date() }, user, String(org), gymKey, pin === null ? null : { pin, label });
  } catch (e) {
    console.error("Scheduler pin failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}

// Team Practice Facilities: check or uncheck a gym for a team (Directors of Facilities or Practices; checked again in
// lib/practice/team-gyms).
export async function setTeamGymAction(input: { teamId: unknown; gym: unknown; on: unknown }) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  try {
    return await setTeamGym({ pool: db, now: () => new Date() }, user, input);
  } catch (e) {
    console.error("Team practice facility change failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}

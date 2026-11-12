"use server";

import { VIEW_ONLY, currentUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { addOfficial, importOfficials, previewOfficialImport, removeOfficial, setAcceptsRecruits, setOfficialLevel } from "@/lib/officials";

// Session checked here; who may (Admins and Directors of Officials, with CourtSync's Scheduler side) in lib/officials.
export async function addOfficialAction(org: string, input: { first: string; last: string; cell: string; email: string; level: string }) {
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

export async function previewOfficialsAction(org: string, text: string) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  try {
    return await previewOfficialImport({ pool: db }, user, org, text);
  } catch (e) {
    console.error("Preview officials failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}

export async function importOfficialsAction(org: string, text: string) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  try {
    return await importOfficials({ pool: db, now: () => new Date() }, user, org, text);
  } catch (e) {
    console.error("Import officials failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}

export async function setOfficialLevelAction(org: string, coachId: string, level: string) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  try {
    return await setOfficialLevel({ pool: db }, user, org, coachId, level);
  } catch (e) {
    console.error("Set official level failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}

export async function setAcceptsRecruitsAction(org: string, on: boolean) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  try {
    return await setAcceptsRecruits({ pool: db }, user, org, on === true);
  } catch (e) {
    console.error("Accept recruits failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}

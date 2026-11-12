"use server";

import { VIEW_ONLY, currentUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { setTeamWarnings } from "@/lib/team-warnings";
import { setClubActiveDays } from "@/lib/court-club";
import { setChatEmailSetting } from "@/lib/chat";
import { setCourtSync } from "@/lib/features";

// Admins (checked in lib/team-warnings): which team warnings the organization turns on, and their numbers.
export async function changeTeamWarnings(org: string, settings: unknown) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  try {
    return await setTeamWarnings({ pool: db, now: () => new Date() }, user, String(org), settings);
  } catch (e) {
    console.error("Team warnings change failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}

// Admins (checked in lib/court-club): how many days CourtClub teams stay active after an event ends.
export async function changeClubActiveDays(org: string, days: number) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  try {
    return await setClubActiveDays({ pool: db }, user, String(org), days);
  } catch (e) {
    console.error("CourtClub settings change failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}

// Admins (checked in lib/chat): email unseen chat messages after this many hours, or not at all.
export async function changeChatEmailSetting(org: string, on: boolean, hours: number) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  try {
    return await setChatEmailSetting({ pool: db }, user, String(org), { on, hours });
  } catch (e) {
    console.error("Chat settings change failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}

// Owners and Admins (checked in lib/features): CourtSync on or off.
export async function changeCourtSync(org: string, on: boolean) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  try {
    return await setCourtSync({ pool: db, now: () => new Date() }, user, String(org), on);
  } catch (e) {
    console.error("CourtSync switch failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}

"use server";

import { VIEW_ONLY, currentUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { isLiveSite, sendMail } from "@/lib/email";
import { noteTexts, nudgeList, sendNudges } from "@/lib/coach-nudges";
import { actionBase } from "../stripe/deps";

const deps = () => ({ pool: db, now: () => new Date() });

// Reminders to coaches from Home's metrics. Session checked here; who may (the organization's Owners and Admins) and who
// gets it in lib/coach-nudges. Live site: each coach their own email; anywhere else only the sender gets a test.
async function guarded<T>(fn: (user: NonNullable<Awaited<ReturnType<typeof currentUser>>>) => Promise<T>, viewOnly: T) {
  const user = await currentUser();
  if (!user || user.actingBy) return viewOnly;
  try {
    return await fn(user);
  } catch (e) {
    console.error("Coach reminder failed:", e);
    return viewOnly;
  }
}

export async function loadNudges(org: string, kind: string) {
  const base = await actionBase();
  return guarded((u) => nudgeList(deps(), u, String(org), kind, base, isLiveSite()), null);
}

export async function emailNudges(org: string, kind: string, coachIds: string[], note: string) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  const base = await actionBase();
  try {
    return await sendNudges({ ...deps(), sendMail }, user, String(org), kind, coachIds, note, base, isLiveSite());
  } catch (e) {
    console.error("Coach reminder failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}

export async function textNudges(org: string, kind: string, coachIds: string[]) {
  return guarded((u) => noteTexts(deps(), u, String(org), kind, coachIds, isLiveSite()), { ok: false, cells: [] as string[] });
}

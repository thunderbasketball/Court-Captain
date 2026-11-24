"use server";

import { VIEW_ONLY, currentUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { isLiveSite, sendMail } from "@/lib/email";
import { guideKind, seasonGuidePreview, sendSeasonGuide } from "@/lib/season-guide";
import { actionBase } from "../stripe/deps";

const deps = () => ({ pool: db, now: () => new Date() });

// Session checked here; who may (its Owners, Admins, Directors of Teams) in lib/season-guide. On the live site it goes
// to everyone; anywhere else (test mode) only to whoever sends it, listing the addresses.
async function guarded<T>(fn: (user: NonNullable<Awaited<ReturnType<typeof currentUser>>>) => Promise<T>) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  try {
    return await fn(user);
  } catch (e) {
    console.error("Season guide failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}

export async function previewGuide(org: string, kind: string) {
  const base = await actionBase();
  return guarded((u) => seasonGuidePreview(deps(), u, String(org), base, isLiveSite(), guideKind(kind)));
}
export async function sendGuideNow(org: string, kind: string) {
  const base = await actionBase();
  return guarded((u) => sendSeasonGuide({ ...deps(), sendMail }, u, String(org), base, isLiveSite(), guideKind(kind)));
}

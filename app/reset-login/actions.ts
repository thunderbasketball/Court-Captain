"use server";

import { VIEW_ONLY, currentUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { resetOrgLogin } from "@/lib/login-reset";

// Session checked here; who may reset whom is re-read from the roles inside lib/login-reset.
export async function resetMemberLogin(org: string, coachId: string) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  try {
    return await resetOrgLogin({ pool: db, now: () => new Date() }, user, org, coachId);
  } catch (e) {
    console.error("Reset login failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}

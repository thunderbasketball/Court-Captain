"use server";

import { db } from "@/lib/db";
import { applyToOfficiate } from "@/lib/officials";

// Apply to officiate, from a login page: no login needed. Everything (the organization taking applications, each field,
// the hourly limit) is checked in lib/officials.
export async function applyToOfficiateAction(
  org: string,
  input: { first: string; last: string; cell: string; email: string; experience: string; website: string },
) {
  try {
    return await applyToOfficiate({ pool: db, now: () => new Date() }, org, input);
  } catch (e) {
    console.error("Officials application failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}

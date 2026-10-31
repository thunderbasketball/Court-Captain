"use server";

import { VIEW_ONLY, currentUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import * as hosting from "@/lib/org-partnerships";

const deps = { pool: db, now: () => new Date() };

// Session checked here; each side's Admin / Director of Facilities role and features are checked in lib/org-partnerships.
async function guarded(
  fn: (user: NonNullable<Awaited<ReturnType<typeof currentUser>>>) => Promise<{ ok: true } | { ok: false; message: string }>,
) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  try {
    return await fn(user);
  } catch (e) {
    console.error("Hosting change failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}

export async function requestHosting(hostOrg: string, forOrg: string) {
  return guarded((u) => hosting.requestHosting(deps, u, hostOrg, forOrg));
}
export async function decideHosting(id: string, approve: boolean) {
  return guarded((u) => hosting.decideHosting(deps, u, id, approve === true));
}

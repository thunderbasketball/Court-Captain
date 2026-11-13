"use server";

import { VIEW_ONLY, currentUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { decideOfficiating, requestOfficiating, setGymOfficials } from "@/lib/officiating";
import { answerGame, assignOfficial, removeOfficialFrom } from "@/lib/officiating-schedule";

// Session checked here; who may (each side) in lib/officiating.
async function guarded<T>(fn: (u: NonNullable<Awaited<ReturnType<typeof currentUser>>>) => Promise<T>) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  try {
    return await fn(user);
  } catch (e) {
    console.error("Officiating change failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}

export async function requestOfficiatingAction(officialsOrg: string, forOrg: string) {
  return guarded((u) => requestOfficiating({ pool: db, now: () => new Date() }, u, officialsOrg, forOrg));
}
export async function decideOfficiatingAction(id: string, approve: boolean) {
  return guarded((u) => decideOfficiating({ pool: db, now: () => new Date() }, u, id, approve === true));
}
export async function setGymOfficialsAction(org: string, gymKey: string, officialsOrg: string | null) {
  return guarded((u) => setGymOfficials({ pool: db, now: () => new Date() }, u, org, gymKey, officialsOrg));
}

export async function assignOfficialAction(
  officialsOrg: string,
  input: { gameId: string; position: number; officialId: string | null; from?: { gameId: string; position: number } | null },
) {
  return guarded((u) => assignOfficial({ pool: db, now: () => new Date() }, u, officialsOrg, input));
}

export async function removeOfficialFromAction(officialsOrg: string, officialId: string, gameIds: string[]) {
  return guarded((u) => removeOfficialFrom({ pool: db, now: () => new Date() }, u, officialsOrg, officialId, gameIds));
}
// An official's ✓ / ✗ on a game they're on (their own spot only; checked in lib/officiating-schedule).
export async function answerGameAction(gameId: string, answer: "yes" | "no" | null) {
  return guarded((u) => answerGame({ pool: db, now: () => new Date() }, u, { gameId, answer }));
}

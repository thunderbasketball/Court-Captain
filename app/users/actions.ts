"use server";

import { VIEW_ONLY, currentUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import * as admin from "@/lib/user-admin";
import type { AddUserInput, EditUserInput } from "@/lib/user-admin";

const deps = { pool: db, now: () => new Date() };

// Session and Director role are checked again inside each lib/user-admin function.
async function guarded<T>(fn: (user: NonNullable<Awaited<ReturnType<typeof currentUser>>>) => Promise<T>) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  try {
    return await fn(user);
  } catch (e) {
    console.error("User change failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}

export async function updateUser(coachId: string, input: EditUserInput) {
  return guarded((u) => admin.updateUser(deps, u, String(coachId), input));
}
export async function denyRequest(coachId: string) {
  return guarded((u) => admin.denyRequest(deps, u, String(coachId)));
}
export async function approveJoin(coachId: string) {
  return guarded((u) => admin.approveJoin(deps, u, String(coachId)));
}
export async function addUser(input: AddUserInput) {
  return guarded((u) => admin.addUser(deps, u, input));
}
export async function resetLogin(coachId: string) {
  return guarded((u) => admin.resetLogin(deps, u, String(coachId)));
}
export async function deleteUser(coachId: string) {
  return guarded((u) => admin.deleteUser(deps, u, String(coachId)));
}

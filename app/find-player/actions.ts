"use server";

import { deps } from "@/lib/auth/server";
import { findComplete, findStart, type FindStep } from "@/lib/find-player";

// Find my player's team (no login): every check is in lib/find-player.
async function run(fn: () => Promise<FindStep>): Promise<FindStep> {
  try {
    return await fn();
  } catch (e) {
    console.error("Find my player's team failed:", e);
    return { step: "error", message: "Something went wrong (the email may not have sent). Please try again." };
  }
}

export async function sendFindCode(cell: string) {
  return run(() => findStart(deps, cell));
}

export async function showMyPlayers(cell: string, code: string) {
  return run(() => findComplete(deps, cell, code));
}

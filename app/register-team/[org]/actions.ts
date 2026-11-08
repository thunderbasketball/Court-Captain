"use server";

import { deps, setSessionCookie } from "@/lib/auth/server";
import { featureRefusal } from "@/lib/features-server";
import * as signup from "@/lib/team-signup";

// Register a team (no login yet: the Head Coach proves their email with a code). Every check is in lib/team-signup.
type ClientStep = Exclude<signup.TeamStep, { step: "loggedIn" }> | { step: "loggedIn"; next: string };

async function run(fn: () => Promise<Awaited<ReturnType<typeof signup.teamSignupComplete>>>): Promise<ClientStep> {
  if (await featureRefusal("scenic-city", "team-registration"))
    return { step: "error", message: "Team registration isn't open." };
  try {
    const s = await fn();
    if (s.step !== "loggedIn") return s;
    await setSessionCookie(s.token, s.expiresAt);
    // Next: pick the League's dates for the new team.
    const next = "programId" in s && s.programId ? `/org/scenic-city/programs/${s.programId}` : "/org/scenic-city/teams";
    return { step: "loggedIn", next };
  } catch (e) {
    console.error("Team registration step failed:", e);
    return { step: "error", message: "Something went wrong (the email may not have sent). Please try again." };
  }
}

export async function lookupCell(cell: string) {
  return run(() => signup.teamSignupLookup(deps, cell));
}
export async function startTeamSignup(input: signup.TeamSignupInput) {
  return run(() => signup.teamSignupStart(deps, input));
}
export async function completeTeamSignup(cell: string, code: string) {
  return run(() => signup.teamSignupComplete(deps, cell, code));
}

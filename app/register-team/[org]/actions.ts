"use server";

import { cookies } from "next/headers";
import { deps, setSessionCookie } from "@/lib/auth/server";
import { CONTEXT_COOKIE } from "@/lib/contexts";
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
    // Next: the team's own CourtSolo account (its Teams page shows where it's registered).
    const next = "slug" in s && s.slug ? `/switch?org=${s.slug}` : "/";
    return { step: "loggedIn", next };
  } catch (e) {
    console.error("Team registration step failed:", e);
    return { step: "error", message: "Something went wrong (the email may not have sent). Please try again." };
  }
}

export async function lookupCell(cell: string) {
  return run(() => signup.teamSignupLookup(deps, cell));
}
export async function pinTeamSignup(cell: string, pin: string) {
  return run(() => signup.teamSignupPin(deps, cell, pin));
}
export async function forgotTeamPin(cell: string) {
  return run(() => signup.teamSignupForgot(deps, cell));
}
export async function resetTeamPin(cell: string, code: string, pin1: string, pin2: string) {
  return run(() => signup.teamSignupReset(deps, cell, code, pin1, pin2));
}
export async function startTeamSignup(input: signup.TeamSignupInput) {
  return run(() => signup.teamSignupStart(deps, input));
}
export async function completeTeamSignup(cell: string, code: string) {
  return run(() => signup.teamSignupComplete(deps, cell, code));
}

// A returning coach's choice (their CourtSolo team, their organization, or switching to CourtOrg): logged in, in that
// account, on its Teams page.
export async function goTeamSignup(cell: string, pin: string, target: signup.GoTarget): Promise<ClientStep> {
  if (await featureRefusal("scenic-city", "team-registration"))
    return { step: "error", message: "Team registration isn't open." };
  try {
    const s = await signup.teamSignupGo(deps, cell, pin, target);
    if (s.step !== "loggedIn") return s;
    await setSessionCookie(s.token, s.expiresAt);
    (await cookies()).set(CONTEXT_COOKIE, `org:${s.slug}`, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
    return { step: "loggedIn", next: s.next };
  } catch (e) {
    console.error("Team registration choice failed:", e);
    return { step: "error", message: "Something went wrong. Please try again." };
  }
}

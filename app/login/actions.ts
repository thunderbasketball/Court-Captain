"use server";

import * as auth from "@/lib/auth/service";
import { clearSessionCookie, deps, sessionToken, setSessionCookie } from "@/lib/auth/server";

// What the browser gets back: the step to show next. The session token only ever travels as a cookie.
export type ClientStep = Exclude<auth.Step, { step: "loggedIn" }> | { step: "loggedIn" };

async function run(fn: () => Promise<auth.Step>): Promise<ClientStep> {
  try {
    const s = await fn();
    if (s.step === "loggedIn") {
      await setSessionCookie(s.token, s.expiresAt);
      return { step: "loggedIn" };
    }
    return s;
  } catch (e) {
    console.error("Login step failed:", e);
    return { step: "error", message: "Something went wrong (the email may not have sent). Please try again." };
  }
}

export async function lookupPhone(cell: string) {
  return run(() => auth.lookupPhone(deps, cell));
}
export async function submitPin(cell: string, pin: string) {
  return run(() => auth.submitPin(deps, cell, pin));
}
export async function sendStarterCode(cell: string, email: string | null) {
  return run(() => auth.sendStarterCode(deps, cell, email));
}
export async function completeStarter(cell: string, code: string, pin1: string, pin2: string) {
  return run(() => auth.completeStarter(deps, cell, code, pin1, pin2));
}
export async function sendVerifyCode(cell: string, pin: string, email: string | null) {
  return run(() => auth.sendVerifyCode(deps, cell, pin, email));
}
export async function completeVerify(cell: string, pin: string, code: string) {
  return run(() => auth.completeVerify(deps, cell, pin, code));
}
export async function startForgot(cell: string) {
  return run(() => auth.startForgot(deps, cell));
}
export async function completeReset(cell: string, code: string, pin1: string, pin2: string) {
  return run(() => auth.completeReset(deps, cell, code, pin1, pin2));
}
export async function startSignup(form: {
  cell: string;
  firstName: string;
  lastName: string;
  email: string;
  pin1: string;
  pin2: string;
  join?: string;
  purpose?: string;
  staffRole?: string;
  teamId?: string;
  teamText?: string;
  notes?: string;
}) {
  return run(() => auth.startSignup(deps, form));
}

// For the sign-up form's "Which team?" list: Thunder's team names (names only, no login needed), by grade then name.
export async function signupTeams(): Promise<{ id: string; name: string }[]> {
  const r = await deps.pool.query<{ id: string; name: string }>("select id::text, name from teams order by gender, grade_sort, name");
  return r.rows;
}
export async function completeSignup(cell: string, code: string) {
  return run(() => auth.completeSignup(deps, cell, code));
}

export async function devLogin(cell: string, code: string) {
  return run(() => auth.devLogin(deps, cell, code));
}


export async function logout() {
  await auth.logout(deps, await sessionToken());
  await clearSessionCookie();
}

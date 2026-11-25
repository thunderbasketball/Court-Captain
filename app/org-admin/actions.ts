"use server";

import { VIEW_ONLY, currentUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import * as orgAdmin from "@/lib/org-admin";
import * as removal from "@/lib/owner-removal";

// Session checked here; the Admin role in that organization is re-read inside lib/org-admin.
export async function setDirectorAreas(org: string, coachId: string, areas: string[]) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  try {
    return await orgAdmin.setDirectorAreas({ pool: db, now: () => new Date() }, user, org, coachId, areas);
  } catch (e) {
    console.error("Director areas change failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}

// Owners: make someone another Owner, or take Owner away (the Owner role is re-read inside lib/org-admin).
export async function setOwner(org: string, coachId: string, on: boolean) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  try {
    // Another Owner is asked (and emailed); they approve it on their own Home.
    if (on !== true && coachId !== user.coachId)
      return await removal.requestOwnerRemoval({ pool: db, now: () => new Date(), sendEmail }, user, org, coachId, process.env.APP_URL || "http://localhost:3000");
    return await orgAdmin.setOwner({ pool: db, now: () => new Date() }, user, org, coachId, on === true);
  } catch (e) {
    console.error("Owner change failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}

// Owners: make someone an Admin, or take it away (the Owner role is re-read inside lib/org-admin).
export async function setAdmin(org: string, coachId: string, on: boolean) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  try {
    return await orgAdmin.setAdmin({ pool: db, now: () => new Date() }, user, org, coachId, on === true);
  } catch (e) {
    console.error("Admin change failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}

// Admins: a new person (first, last, cell) to give a role to; checked again in lib/org-admin.
export async function addPerson(org: string, input: { first: string; last: string; cell: string }) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  try {
    return await orgAdmin.addPersonFor({ pool: db, now: () => new Date() }, user, org, input);
  } catch (e) {
    console.error("Add person failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}

// Admins: make someone an Officials Assigner or a Director of Scores, or not (the Admin role is re-read inside lib/org-admin).
export async function setAssigner(org: string, coachId: string, on: boolean, area: string = "officials") {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  try {
    return await orgAdmin.setAssigner({ pool: db, now: () => new Date() }, user, org, coachId, on === true, area);
  } catch (e) {
    console.error("Assigner change failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}

// Admins: switch one of the organization's Director roles Active or off (re-checked inside lib/org-admin).
export async function setDirectorRoleActive(org: string, area: string, active: boolean) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  try {
    return await orgAdmin.setDirectorRoleActive({ pool: db, now: () => new Date() }, user, org, area, active === true);
  } catch (e) {
    console.error("Director role change failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}

// The Owner's own answer to being removed; any Owner takes a request back.
export async function decideOwnerRemoval(id: string, approve: boolean) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  try {
    return await removal.decideOwnerRemoval({ pool: db, now: () => new Date(), sendEmail }, user, id, approve === true);
  } catch (e) {
    console.error("Owner removal failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}
export async function cancelOwnerRemoval(id: string) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  try {
    return await removal.cancelOwnerRemoval({ pool: db, now: () => new Date() }, user, id);
  } catch (e) {
    console.error("Owner removal cancel failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}

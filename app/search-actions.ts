"use server";

import { currentUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { searchOrg } from "@/lib/org-search";

// Home's 🔍 search. Viewing only, so allowed while viewing as someone; the role is checked in lib/org-search.
export async function searchOrganization(org: string, q: string) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  try {
    const r = await searchOrg({ pool: db }, user, org, q);
    if (!r) return { ok: false as const, message: "Only the organization's Owners, Admins and Directors can search." };
    return { ok: true as const, ...r };
  } catch (e) {
    console.error("Search failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}

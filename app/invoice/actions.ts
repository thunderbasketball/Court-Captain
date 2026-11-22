"use server";

import { VIEW_ONLY, currentUser } from "@/lib/auth/server";
import { payInvoice } from "@/lib/invoices";
import { actionBase, stripeDeps } from "../stripe/deps";

// Pay an open invoice's balance by card (whoever manages the organization's teams; checked in lib/invoices).
export async function payOpenInvoice(org: string, programId: string) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  try {
    return await payInvoice(stripeDeps(), user, programId, org, await actionBase());
  } catch (e) {
    console.error("Invoice payment failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}

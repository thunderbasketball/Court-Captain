"use server";

import { VIEW_ONLY, currentUser } from "@/lib/auth/server";
import * as cart from "@/lib/cart";
import * as invoices from "@/lib/cart-invoices";
import { sendEmail } from "@/lib/email";
import { after } from "next/server";
import { actionBase, stripeDeps } from "../stripe/deps";
import { sendInvoice } from "../stripe/invoice-mail";

// Session checked here; who may register what, and its price, is checked in lib/cart (when it's put in and when it's paid).
async function guarded<T>(fn: (user: NonNullable<Awaited<ReturnType<typeof currentUser>>>) => Promise<T>) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  try {
    return await fn(user);
  } catch (e) {
    console.error("Cart change failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}

export async function addCartItem(programId: string, team: cart.CartTeam, choice?: unknown) {
  return guarded((u) => cart.addToCart(stripeDeps(), u, programId, team, choice));
}
export async function removeCartItem(id: string) {
  return guarded((u) => cart.removeFromCart(stripeDeps(), u, id));
}
// Ask for an invoice for one organization's teams in one program: emailed, and paid later from its page.
export async function requestCartInvoice(org: string, programId: string) {
  return guarded(async (u) => {
    const r = await invoices.requestInvoice(stripeDeps(), u, org, programId);
    if (r.ok)
      after(async () => {
        try {
          const m = await invoices.requestedInvoiceEmail(stripeDeps(), u, r.id, process.env.APP_URL || "http://localhost:3000");
          for (const to of m?.to ?? []) await sendEmail(to, m!.subject, m!.text);
        } catch (e) {
          console.error("Requested invoice email failed:", e);
        }
      });
    return r;
  });
}
export async function payRequestedInvoice(id: string, inPage = false) {
  const base = await actionBase();
  return guarded((u) => invoices.payRequested(stripeDeps(), u, id, base, inPage === true));
}
export async function cancelRequestedInvoice(id: string) {
  return guarded((u) => invoices.cancelRequested(stripeDeps(), u, id));
}
// The League's Owners: paid another way (a check); its teams register now, and its PAID invoice is emailed.
export async function markRequestedInvoicePaid(id: string) {
  const base = await actionBase();
  return guarded(async (u) => {
    const r = await invoices.markRequestedPaid(stripeDeps(), u, id);
    if (r.ok && r.org !== "scenic-city") after(() => sendInvoice(r.programId, r.org, base));
    return r;
  });
}
// A League Owner registers an item in someone's cart now, to be paid later (its invoice is emailed).
export async function registerCartItemLater(id: string) {
  const base = await actionBase();
  return guarded(async (u) => {
    const r = await cart.registerPayLater(stripeDeps(), u, id);
    if (r.ok && r.org !== "scenic-city") after(() => sendInvoice(r.programId, r.org, base));
    return r;
  });
}
// Pay for one organization's teams in one program. `mode` (a Pay later organization, after it's asked): "card" or "later".
// `inPage`: Stripe's form opens in the page (`payInPage`) instead of Stripe's own page.
export async function payCartGroup(org: string, programId: string, mode?: "card" | "later", inPage = false) {
  const base = await actionBase();
  return guarded(async (u) => {
    const r = await cart.payCart(stripeDeps(), u, org, programId, base, mode, inPage === true);
    if (r.ok && r.registered) after(() => sendInvoice(programId, org, base)); // registered now: its invoice (PAID or PAY LATER)
    return r;
  });
}

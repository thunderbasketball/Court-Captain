"use server";

import { VIEW_ONLY, currentUser } from "@/lib/auth/server";
import { setFeePayer } from "@/lib/stripe/connect";
import { refundPayment } from "@/lib/stripe/refunds";
import { stripeDeps } from "./deps";

// Payments → who pays Stripe's card fee (Owners; checked in lib/stripe/connect).
export async function setStripeFeePayer(org: string, payer: "org" | "team") {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  try {
    return await setFeePayer(stripeDeps(), user, String(org), payer);
  } catch (e) {
    console.error("Card fee setting failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}

// Refund part (or all) of a team's card payment (the League's Owners; checked in lib/stripe/refunds).
export async function refundCardPayment(paymentId: string, cents: number) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  try {
    return await refundPayment(stripeDeps(), user, paymentId, cents);
  } catch (e) {
    console.error("Refund failed:", e);
    return { ok: false as const, message: "Stripe couldn't make that refund just now. Nothing was refunded; try again in a minute." };
  }
}

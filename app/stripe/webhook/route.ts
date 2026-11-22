import { verifiedEvent } from "@/lib/stripe/client";
import { handleStripeEvent, type StripeEvent } from "@/lib/stripe/webhook";
import { after } from "next/server";
import { stripeDeps } from "../deps";
import { sendInvoice } from "../invoice-mail";

// Stripe's notices (no login: Stripe calls it). Only accepted when Stripe's signature checks out; then a paid Checkout
// registers its team (lib/stripe/webhook). A 500 makes Stripe try again later.
export async function POST(request: Request) {
  const body = await request.text();
  const event = verifiedEvent(body, request.headers.get("stripe-signature"));
  if (!event) return new Response("Bad signature", { status: 400 });
  try {
    const did = await handleStripeEvent(stripeDeps(), event as unknown as StripeEvent, ({ programId, org }) =>
      after(() => sendInvoice(programId, org)), // paid: its invoice, marked PAID
    );
    if (did !== "ignored") console.log(`[stripe] ${event.type} ${event.id}: ${did}`);
    return Response.json({ received: true });
  } catch (e) {
    console.error("Stripe notice failed:", e);
    return new Response("Try again", { status: 500 });
  }
}

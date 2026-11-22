import { confirmPayment } from "@/lib/stripe/registration";
import { after } from "next/server";
import { goTo, siteOrigin, stripeDeps } from "../deps";
import { sendInvoice } from "../invoice-mail";

// Back from Stripe Checkout (a team's registration fee): asks Stripe whether it's paid, registers the team if so, then
// the team's page with how it went. The session id is checked against our own record and with Stripe (never trusted).
export async function GET(request: Request) {
  const url = new URL(request.url);
  let r: Awaited<ReturnType<typeof confirmPayment>>;
  try {
    r = await confirmPayment(stripeDeps(), url.searchParams.get("p"), url.searchParams.get("session_id"));
  } catch (e) {
    console.error("Payment check failed:", e);
    return goTo("/");
  }
  if (r.ok && r.paidNow) {
    const { programId, org } = r.paidNow;
    after(() => sendInvoice(programId, org, siteOrigin(request))); // paid: its invoice, marked PAID
  }
  const page = r.teamPage ?? "/";
  return goTo(`${page}${page.includes("?") ? "&" : "?"}paid=${!r.ok ? "failed" : r.registered ? "done" : "pending"}`);
}

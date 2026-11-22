import "server-only";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { stripeApi } from "@/lib/stripe/client";

export const stripeDeps = () => ({ pool: db, stripe: stripeApi(), now: () => new Date() });

// Where an organization's Owner lands after Stripe: its Home (the gear's Payments card shows where it stands).
export const homeOf = (org: string) => `/org/${encodeURIComponent(org)}`;

// This site's address as the person's browser sees it (a phone on 192.168…, or the host's site), from the Host header;
// request.url can be the server's own (localhost). Used for Stripe's way back and the same-site check.
export function siteOrigin(request: Request) {
  const h = request.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return new URL(request.url).origin;
  const proto = h.get("x-forwarded-proto")?.split(",")[0].trim() ?? new URL(request.url).protocol.replace(":", "");
  return `${proto}://${host}`;
}

// Sends the browser to a page of this site by path only (so it stays on the address it's using).
export const goTo = (path: string) => new Response(null, { status: 303, headers: { Location: path } });

// This site's address in a server action (for Stripe's way back): the page's own origin, else its host.
export async function actionBase() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const base = h.get("origin") ?? (host ? `${h.get("x-forwarded-proto")?.split(",")[0].trim() ?? "http"}://${host}` : (process.env.APP_URL ?? ""));
  return base.replace(/\/$/, "");
}

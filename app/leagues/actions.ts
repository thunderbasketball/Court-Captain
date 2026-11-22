"use server";

import { VIEW_ONLY, currentUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import * as leagues from "@/lib/org-leagues";
import * as thunderLeagues from "@/lib/thunder-leagues";
import * as batches from "@/lib/register-batches";
import { requestRemoval } from "@/lib/schedule-removal";
import { payLater, type BatchPay } from "@/lib/scenic-programs";
import { insertPayment, openCheckout, payee, registerOrPay } from "@/lib/stripe/registration";
import { after } from "next/server";
import { actionBase, stripeDeps } from "../stripe/deps";
import { sendInvoice } from "../stripe/invoice-mail";

// Session checked here; who may (each organization's Admins and Directors of Teams) is checked in lib/org-leagues.
async function guarded<T>(fn: (user: NonNullable<Awaited<ReturnType<typeof currentUser>>>) => Promise<T>) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  try {
    return await fn(user);
  } catch (e) {
    console.error("League change failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}
const deps = () => ({ pool: db, now: () => new Date() });

// Register (or Add dates): when the League takes card payments and it costs something, `pay` is Stripe Checkout's address
// (the team is registered once Stripe says it's paid); otherwise it registers at once.
// `mode` (a Pay later organization, after it's asked): "card" pays now, "later" registers now unpaid.
export async function registerTeam(org: string, teamId: string, programId: string, choice?: unknown, mode?: "card" | "later") {
  const base = await actionBase();
  return guarded(async (u) => {
    const r = await registerOrPay(stripeDeps(), u, org, teamId, programId, choice, base, mode);
    if (r.ok && !r.pay && !r.choose) after(() => sendInvoice(programId, org, base)); // registered now: its invoice (PAID or PAY LATER)
    return r;
  });
}
// `preview`: what Register all would do, nothing kept (its confirmation).
// `only`: the teams left checked in it (checked on the server).
// When the League takes card payments and the teams cost something, `pay` is Stripe Checkout's address: one payment for
// all of them, registered once Stripe says it's paid (lib/stripe/registration).
// `mode` (a Pay later organization): "later" registers now unpaid; otherwise (or "card") pays by card when the League takes it.
export async function registerAll(org: string, programId: string, preview?: boolean, only?: string[], mode?: "card" | "later") {
  // Thunder's teams are its own kind; every other organization's are organization teams.
  const p = preview === true;
  const sd = stripeDeps();
  const base = await actionBase();
  return guarded(async (u) => {
    // Pay later (set for this organization in the program): it may pay now by card, or register now and pay later.
    const later = await payLater(db, programId, org);
    const to = later && mode === "later" ? null : await payee(db, sd.stripe);
    const startedBy = `${u.firstName} ${u.lastName}`;
    const pay: BatchPay | null = to && {
      feePayer: to.fee_payer,
      record: (q, teams) => insertPayment(q, to, { programId, teamOrg: org, teams, startedBy, now: new Date() }),
    };
    const r =
      org === "thunder"
        ? await thunderLeagues.registerAllThunderTeams(deps(), u, programId, p, only, pay)
        : await leagues.registerAllOrgTeams(deps(), u, org, programId, p, only, pay);
    if (r.ok && !r.paymentId && r.batchId) after(() => sendInvoice(programId, org, base)); // registered now: its invoice
    // Its confirmation offers Pay later beside paying now when the organization may (and cards are taken).
    if (r.ok && p) return { ...r, payLaterOk: later && !!to };
    if (!r.ok || !r.paymentId) return r;
    const cancel = `/org/${encodeURIComponent(org)}?open=register&paid=cancelled`;
    return { ...r, pay: await openCheckout(sd, r.paymentId, base, cancel) };
  });
}
// Undo a Register all (who may is checked in lib/register-batches).
export async function undoRegisterAll(batchId: string) {
  return guarded((u) => batches.undoRegisterAll(deps(), u, batchId));
}
export async function setDayOff(org: string, teamId: string, programId: string, what: string, out: boolean) {
  return guarded((u) => leagues.setOrgTeamDayOff(deps(), u, org, teamId, programId, what, out === true));
}
export async function withdrawTeam(org: string, teamId: string, programId: string) {
  return guarded((u) => leagues.withdrawOrgTeam(deps(), u, org, teamId, programId));
}

// Ask the League's Scheduler to take a team off an event's schedule (whoever manages it; checked in lib/schedule-removal).
// `teamId`: its copy in the League.
export async function requestScheduleRemoval(programId: string, teamId: string) {
  return guarded((u) => requestRemoval(deps(), u, programId, teamId));
}

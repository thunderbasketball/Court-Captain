// Card payments and refunds (SPEC.md section 14, Payments). The League's Owners see each program's card payments (its
// teams, what was paid, refunds, and whether each team is still registered) and refund any amount up to what's left, more
// than once. Nothing is refunded on its own (a team withdrawing or deleted keeps its payment for the Owners to decide).
// A full refund of a team still registered and marked Paid by card turns its Paid off. Checked here, on the server.
import type { Pool } from "pg";
import type { SessionUser } from "../auth/service";
import { isOrgOwner } from "../org-admin";
import { withTx, type Queryable } from "../sql";
import { isScheduled } from "../team-guards";
import type { StripeApi } from "./connect";

type Deps = { pool: Pool; stripe: StripeApi | null; now: () => Date };
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };
const LEAGUE = "scenic-city";
const isId = (v: unknown): v is string => typeof v === "string" && /^\d{1,18}$/.test(v);
const by = (v: SessionUser) => `${v.firstName} ${v.lastName}`;

export type PaymentTeam = {
  teamId: string | null;
  name: string;
  state: "registered" | "withdrawn" | "deleted" | "waiting";
  cents: number; // this team's part of the payment (before the card fee)
  what: string; // what it paid for: "ALL Season", "Dec 5 · 2nd Game", "Invoice"…
};
export type CardPayment = {
  id: string;
  teams: PaymentTeam[];
  org: string | null; // the teams' organization (its name)
  paidCents: number; // what was charged: the fee, plus the card fee when it was added for the team
  cardFeeCents: number; // the card fee added for the team (0 when the organization pays it)
  kind: "register" | "invoice"; // registering (or adding), or paying an invoice
  refundedCents: number;
  status: "started" | "registered" | "failed";
  error: string | null; // paid, but not registered: why
  startedBy: string;
  at: Date; // registered (or started)
  refunds: { cents: number; by: string; at: Date }[];
};

// What a payment's team paid for, from the choice it registered (or added): "ALL Season", "Dec 5, Dec 12 · 1 Game",
// "Dec 5 · 2nd Game"; a program without options (a Circuit or Tournament): "Registration".
const DAY = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const KIND: Record<string, string> = { single_1: "1 Game", single_2: "2 Games", single_2nd: "2nd Game" };
export function paidFor(choice: unknown): string {
  const c = (choice && typeof choice === "object" ? choice : null) as { allSeason?: boolean; days?: { date: string; kind: string }[] } | null;
  if (!c) return "Registration";
  const parts: string[] = [];
  if (c.allSeason) parts.push("ALL Season");
  for (const kind of ["single_1", "single_2", "single_2nd"]) {
    const ds = (c.days ?? []).filter((d) => d.kind === kind).map((d) => d.date).sort();
    if (ds.length) parts.push(`${ds.map(DAY).join(", ")} · ${KIND[kind]}`);
  }
  return parts.join("; ") || "Registration";
}

// The program's card payments that went through (and failed ones that were paid), newest first. Null: not an Owner.
export async function cardPayments(q: Pick<Queryable, "query">, viewer: SessionUser, programId: string, live: boolean): Promise<CardPayment[] | null> {
  if (!(await isOrgOwner(q, viewer.coachId, LEAGUE))) return null;
  const r = await q.query<{
    id: string;
    org: string | null;
    paid: number;
    card_fee: number;
    kind: "register" | "invoice";
    status: CardPayment["status"];
    error: string | null;
    started_by: string;
    at: Date;
    teams: { name: string | null; team_id: string | null; registered: boolean; cents: number; choice: unknown }[];
    refunds: { cents: number; by: string; at: string }[];
  }>(
    `select p.id::text, o.name as org, p.fee_cents + p.card_fee_cents as paid, p.card_fee_cents as card_fee, p.kind, p.status, p.error, p.started_by,
            coalesce(p.registered_at, p.started_at) as at,
            coalesce((select json_agg(json_build_object('name', x.team_name, 'team_id', x.team_id, 'cents', x.fee_cents, 'choice', x.choice,
                        'registered', exists (select 1 from scenic_registrations r where r.program_id = p.program_id and r.team_id = x.team_id))
                        order by lower(x.team_name)) from registration_payment_teams x where x.payment_id = p.id), '[]') as teams,
            coalesce((select json_agg(json_build_object('cents', f.cents, 'by', f.refunded_by, 'at', f.refunded_at) order by f.refunded_at)
                        from registration_refunds f where f.payment_id = p.id), '[]') as refunds
       from registration_payments p left join organizations o on o.slug = p.team_org
      where p.program_id = $1 and p.org = $2 and p.livemode = $3 and p.status in ('registered', 'failed')
      order by coalesce(p.registered_at, p.started_at) desc, p.id desc`,
    [programId, LEAGUE, live],
  );
  return r.rows.map((p) => {
    const refunds = p.refunds.map((f) => ({ cents: f.cents, by: f.by, at: new Date(f.at) }));
    return {
      id: p.id,
      org: p.org,
      paidCents: p.paid,
      cardFeeCents: p.card_fee,
      kind: p.kind,
      refundedCents: refunds.reduce((n, f) => n + f.cents, 0),
      status: p.status,
      error: p.error,
      startedBy: p.started_by,
      at: p.at,
      refunds,
      teams: p.teams.map((t) => ({
        teamId: t.team_id,
        name: t.name ?? "A team",
        state: !t.team_id ? "deleted" : t.registered ? "registered" : p.status === "registered" ? "withdrawn" : "waiting",
        cents: t.cents,
        what: p.kind === "invoice" ? "Invoice balance" : paidFor(t.choice),
      })),
    };
  });
}

// Refund part (or all) of a card payment: any amount up to what's left. Owners of the League only. `withdraw`: also
// cancel that team's registration (one of the payment's teams), together with the refund: a team on the schedule
// can't be (the Scheduler removes it first), and then nothing is refunded.
export async function refundPayment(
  deps: Deps,
  viewer: SessionUser,
  paymentId: unknown,
  cents: unknown,
  withdraw?: unknown,
): Promise<Result<{ left: number; withdrawn?: boolean }>> {
  if (!isId(paymentId)) return { ok: false, message: "That payment wasn't found." };
  if (withdraw !== undefined && withdraw !== null && !isId(withdraw)) return { ok: false, message: "That team wasn't found." };
  if (typeof cents !== "number" || !Number.isInteger(cents) || cents <= 0) return { ok: false, message: "Enter an amount to refund." };
  if (!(await isOrgOwner(deps.pool, viewer.coachId, LEAGUE))) return { ok: false, message: "Only Scenic City's Owners can refund." };
  const stripe = deps.stripe;
  if (!stripe) return { ok: false, message: "Online payments aren't set up on CourtCaptain." };
  return withTx(deps.pool, async (q) => {
    const p = (
      await q.query<{ account_id: string; session_id: string | null; paid: number; status: string; program_id: string; livemode: boolean }>(
        `select account_id, session_id, fee_cents + card_fee_cents as paid, status, program_id::text, livemode
           from registration_payments where id = $1 and org = $2 for update`,
        [paymentId, LEAGUE],
      )
    ).rows[0];
    if (!p || !p.session_id || p.livemode !== stripe.live) return { ok: false as const, message: "That payment wasn't found." };
    if (p.status === "started") return { ok: false as const, message: "That payment never went through, so there's nothing to refund." };
    const done = (await q.query<{ n: number }>("select coalesce(sum(cents), 0)::int as n from registration_refunds where payment_id = $1", [paymentId])).rows[0].n;
    const left = p.paid - done;
    if (left <= 0) return { ok: false as const, message: "It's already refunded in full." };
    if (cents > left) return { ok: false as const, message: `At most $${(left / 100).toFixed(2)} is left to refund.` };
    if (withdraw) {
      const reg = await q.query(
        `select 1 from scenic_registrations r join registration_payment_teams x on x.team_id = r.team_id and x.payment_id = $1
          where r.program_id = $2 and r.team_id = $3 for update of r`,
        [paymentId, p.program_id, withdraw],
      );
      if (!reg.rowCount) return { ok: false as const, message: "That team isn't registered anymore. Nothing was refunded." };
      if (await isScheduled(q, p.program_id, withdraw))
        return {
          ok: false as const,
          message: "That team is on the schedule, so its registration can't be cancelled here. The Scheduler removes it first (TBD in its games). Nothing was refunded.",
        };
    }
    // The same refund (this payment, this much, after this much) is never made twice, even on a double tap.
    const refundId = await stripe.refund({ account: p.account_id, sessionId: p.session_id, cents, key: `cc-refund-${paymentId}-${done}-${cents}` });
    await q.query(
      "insert into registration_refunds (payment_id, cents, refund_id, refunded_by, refunded_at) values ($1, $2, $3, $4, $5) on conflict (refund_id) do nothing",
      [paymentId, cents, refundId, by(viewer), deps.now()],
    );
    if (cents === left)
      // Refunded in full: its teams still registered and marked Paid by card aren't paid now.
      await q.query(
        `update scenic_registrations r set paid = false, paid_set_by = $3, paid_set_at = $4
           from registration_payment_teams x
          where x.payment_id = $1 and r.program_id = $2 and r.team_id = x.team_id and r.paid and r.paid_set_by = 'Card (Stripe)'`,
        [paymentId, p.program_id, `Refunded by ${by(viewer)}`, deps.now()],
      );
    if (withdraw) {
      await q.query("delete from scenic_registrations where program_id = $1 and team_id = $2", [p.program_id, withdraw]);
      return { ok: true as const, left: left - cents, withdrawn: true };
    }
    return { ok: true as const, left: left - cents };
  });
}

// A card payment as shown on each of its registered teams' cards (Registrations), by `${programId}-${teamId}`.
export type TeamCardPayment = {
  id: string;
  paidCents: number;
  cardFeeCents: number;
  teamCents: number; // this team's part (before the card fee)
  what: string; // what this team paid for
  kind: "register" | "invoice";
  refundedCents: number;
  teams: number; // one payment can cover several teams (Register ALL)
  who: string; // its organization, else who paid
  by: string;
  at: string; // ISO
  refunds: { cents: number; by: string; at: string }[];
};

// Each program's card payments by its registered teams, newest first (Owners; null otherwise): a team's first
// registration and each addition (dates, a 2nd Game) or invoice paid are separate payments. Payments with no team still registered
// (withdrawn, deleted, or paid but not registered) stay on the Card payments card instead.
export async function paymentsByTeam(q: Pick<Queryable, "query">, viewer: SessionUser, programIds: string[], live: boolean) {
  const byTeam: Record<string, TeamCardPayment[]> = {};
  for (const programId of programIds) {
    const list = await cardPayments(q, viewer, programId, live);
    if (!list) return null;
    for (const p of list) {
      if (p.status !== "registered") continue;
      for (const t of p.teams)
        if (t.state === "registered" && t.teamId)
          (byTeam[`${programId}-${t.teamId}`] ??= []).push({
            id: p.id,
            paidCents: p.paidCents,
            cardFeeCents: p.cardFeeCents,
            teamCents: t.cents,
            what: t.what,
            kind: p.kind,
            refundedCents: p.refundedCents,
            teams: p.teams.length,
            who: p.org ?? p.startedBy,
            by: p.startedBy,
            at: p.at.toISOString(),
            refunds: p.refunds.map((f) => ({ ...f, at: f.at.toISOString() })),
          });
    }
  }
  return byTeam;
}

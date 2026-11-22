// Card payments and refunds (SPEC.md section 14, Payments). The League's Owners see each program's card payments (its
// teams, what was paid, refunds, and whether each team is still registered) and refund any amount up to what's left, more
// than once. Nothing is refunded on its own (a team withdrawing or deleted keeps its payment for the Owners to decide).
// A full refund of a team still registered and marked Paid by card turns its Paid off. Checked here, on the server.
import type { Pool } from "pg";
import type { SessionUser } from "../auth/service";
import { isOrgOwner } from "../org-admin";
import { withTx, type Queryable } from "../sql";
import type { StripeApi } from "./connect";

type Deps = { pool: Pool; stripe: StripeApi | null; now: () => Date };
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };
const LEAGUE = "scenic-city";
const isId = (v: unknown): v is string => typeof v === "string" && /^\d{1,18}$/.test(v);
const by = (v: SessionUser) => `${v.firstName} ${v.lastName}`;

export type PaymentTeam = { name: string; state: "registered" | "withdrawn" | "deleted" | "waiting" };
export type CardPayment = {
  id: string;
  teams: PaymentTeam[];
  org: string | null; // the teams' organization (its name)
  paidCents: number; // what was charged: the fee, plus the card fee when it was added for the team
  refundedCents: number;
  status: "started" | "registered" | "failed";
  error: string | null; // paid, but not registered: why
  startedBy: string;
  at: Date; // registered (or started)
  refunds: { cents: number; by: string; at: Date }[];
};

// The program's card payments that went through (and failed ones that were paid), newest first. Null: not an Owner.
export async function cardPayments(q: Pick<Queryable, "query">, viewer: SessionUser, programId: string, live: boolean): Promise<CardPayment[] | null> {
  if (!(await isOrgOwner(q, viewer.coachId, LEAGUE))) return null;
  const r = await q.query<{
    id: string;
    org: string | null;
    paid: number;
    status: CardPayment["status"];
    error: string | null;
    started_by: string;
    at: Date;
    teams: { name: string | null; team_id: string | null; registered: boolean }[];
    refunds: { cents: number; by: string; at: string }[];
  }>(
    `select p.id::text, o.name as org, p.fee_cents + p.card_fee_cents as paid, p.status, p.error, p.started_by,
            coalesce(p.registered_at, p.started_at) as at,
            coalesce((select json_agg(json_build_object('name', x.team_name, 'team_id', x.team_id,
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
      refundedCents: refunds.reduce((n, f) => n + f.cents, 0),
      status: p.status,
      error: p.error,
      startedBy: p.started_by,
      at: p.at,
      refunds,
      teams: p.teams.map((t) => ({
        name: t.name ?? "A team",
        state: !t.team_id ? "deleted" : t.registered ? "registered" : p.status === "registered" ? "withdrawn" : "waiting",
      })),
    };
  });
}

// Refund part (or all) of a card payment: any amount up to what's left. Owners of the League only.
export async function refundPayment(deps: Deps, viewer: SessionUser, paymentId: unknown, cents: unknown): Promise<Result<{ left: number }>> {
  if (!isId(paymentId)) return { ok: false, message: "That payment wasn't found." };
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
    return { ok: true as const, left: left - cents };
  });
}

// Add dates (and a 2nd Game on a date it already plays) to a League team's registration, from its League team page
// (SPEC.md section 13). Who: a COMP team's coaches (never a REC team's), the Owners, Admins and Directors of Teams of the
// organization it belongs to and of Scenic City, and the Scheduler. Only a registration it already has (the first one is
// made on its organization's page, or by Scenic City). REC teams register ALL Season only, so they add nothing (saveChoice).
// When the League takes cards and the addition costs something, it goes to Stripe Checkout and is added only once Stripe
// says it's paid (lib/stripe/registration's confirmPayment, the same as Register). Nothing is added unpaid, except for an
// organization in a Pay later price group (added now; a Paid registration whose fee goes up turns Unpaid, marked by who
// added the dates) or when it costs nothing.
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { hasFeature } from "./features";
import { leagueEntry, owesMore, payLater, saveChoice, teamOrgOf, type Entry } from "./scenic-programs";
import { whoForTeam } from "./schedule-requests";
import { withTx, type Queryable } from "./sql";
import type { StripeApi } from "./stripe/connect";
import { dryRun, insertPayment, openCheckout, openCheckoutInPage, owed, payee, type InPage } from "./stripe/registration";

type Deps = { pool: Pool; now: () => Date; stripe?: StripeApi | null };
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };
const isId = (v: unknown): v is string => typeof v === "string" && /^\d{1,18}$/.test(v);
const by = (v: SessionUser) => `${v.firstName} ${v.lastName}`;

export type AddDatesResult = Result<
  | { pay: string; payInPage?: undefined } // to Stripe's page
  | { payInPage: InPage; pay?: undefined } // Stripe's form in the page
  | { pay?: undefined; payInPage?: undefined; entry: Entry | null; unpaid: boolean }
>;

// Why this person can't add dates to this League team (null: they can). A REC team's dates are added by its directors
// only; a COMP team's coaches add them too; with CourtPlayers, its Directors.
export async function mayNotAddDates(q: Pick<Queryable, "query">, viewer: SessionUser, teamId: string): Promise<string | null> {
  const who = await whoForTeam(q, viewer, teamId);
  if (who.director) return null;
  const teamOrg = await teamOrgOf(q, teamId);
  if (who.coach && teamOrg && (await hasFeature(q, teamOrg, "player-registration"))) return "Your Director handles registrations.";
  if (who.coach && who.level !== "REC") return null;
  return who.coach ? "A REC team's dates are added by its Director, Admin or Owner." : "Only the team's coaches and its directors can add dates.";
}

export async function addLeagueDates(
  deps: Deps,
  viewer: SessionUser,
  programId: unknown,
  teamId: unknown,
  choice: unknown,
  base = "", // this site's address, for Stripe's way back
  inPage = false, // Stripe's form opens in the page (the site has Stripe's publishable key)
): Promise<AddDatesResult> {
  if (!isId(programId) || !isId(teamId)) return { ok: false, message: "Pick a team and a League." };
  const no = await mayNotAddDates(deps.pool, viewer, teamId);
  if (no) return { ok: false, message: no };
  const registered = await deps.pool.query(
    `select 1 from scenic_registrations r join scenic_programs p on p.id = r.program_id
      where r.program_id = $1 and r.team_id = $2 and r.removed_at is null and p.kind = 'League'`,
    [programId, teamId],
  );
  if (!registered.rowCount) return { ok: false, message: "The team isn't registered in this League yet." };

  // What the addition costs (nothing kept). Something to pay: to Stripe, added once it's paid. Its organization in a Pay
  // later price group: added now, Unpaid (its invoice). Without either, nothing is added until card payments work.
  const check = await dryRun(deps.pool, (q) => owed(q, programId, teamId, choice, by(viewer), deps.now()));
  if ("error" in check) return { ok: false, message: check.error };
  if (check.cents > 0) {
    const t = (
      await deps.pool.query<{ org: string; org_team_id: string | null; page: string }>(
        `select coalesce(ot.org, case when st.thunder_team_id is not null then 'thunder' else 'scenic-city' end) as org,
                st.org_team_id::text,
                case when st.thunder_team_id is not null then '/org/thunder/teams/' || st.thunder_team_id
                     when ot.id is not null then '/org/' || ot.org || '/teams/' || ot.id else '/org/scenic-city/teams/' || st.id end as page
           from scenic_teams st left join org_teams ot on ot.id = st.org_team_id where st.id = $1`,
        [teamId],
      )
    ).rows[0];
    const later = await payLater(deps.pool, programId, t.org);
    const to = !later && deps.stripe ? await payee(deps.pool, deps.stripe) : null;
    if (!later) {
      if (!to || !deps.stripe) return { ok: false, message: "Card payments aren't available right now, so nothing was added. Try again later." };
      const id = await insertPayment(deps.pool, to, {
        programId,
        teamOrg: t.org,
        teams: [{ teamId, orgTeamId: t.org_team_id, choice, cents: check.cents }],
        startedBy: by(viewer),
        now: deps.now(),
      });
      const sd = { pool: deps.pool, stripe: deps.stripe, now: deps.now };
      if (inPage) return { ok: true, payInPage: await openCheckoutInPage(sd, id, base) };
      return { ok: true, pay: await openCheckout(sd, id, base, `${t.page}?paid=cancelled`) };
    }
  }

  // Nothing to pay, or Pay later: added now.
  return withTx(deps.pool, async (q) => {
    const reg = await q.query<{ paid: boolean }>(
      "select paid from scenic_registrations where program_id = $1 and team_id = $2 and removed_at is null for update",
      [programId, teamId],
    );
    if (!reg.rows[0]) return { ok: false as const, message: "The team isn't registered in this League yet." };
    const before = (await leagueEntry(q, programId, teamId)).entry?.feeCents ?? 0;
    const saved = await saveChoice(q, programId, teamId, choice, by(viewer), deps.now());
    if ("error" in saved) return { ok: false as const, message: saved.error };
    const after = saved.entry?.feeCents ?? before;
    const unpaid = reg.rows[0].paid && after > before;
    if (unpaid) await owesMore(q, programId, teamId, after - before, by(viewer), deps.now());
    return { ok: true as const, entry: saved.entry, unpaid };
  });
}

// Reminders to coaches from Home's metrics (SPEC.md section 14), for an organization's Owners and Admins: to its coaches who
// haven't used the app in 7 days ("use"), or to the Head Coaches and Team Managers of its teams whose roster isn't complete
// ("rosters"). Each email is the coach's own (their name, their teams, what their roster is missing), with why it matters and
// by when; a text is one message to all of them, opened in the sender's Messages. Who sent each, and when, is kept.
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { COACHES, ORG_COACHES, USE_DAYS } from "./coach-use";
import { isOrgAdmin } from "./org-admin";
import { orgFeatures } from "./features";
import { rosterTeams } from "./roster-done";
import type { Queryable } from "./sql";
import { easternDate } from "./time";
import { nudgeEmail, nudgeText, type NudgeContext, type NudgeKind, type Recipient } from "./coach-nudge-text";

export type { NudgeContext, NudgeKind, Recipient } from "./coach-nudge-text";
export { nudgeEmail, nudgeText } from "./coach-nudge-text";

export type NudgeList = { kind: NudgeKind; recipients: Recipient[]; context: NudgeContext; text: string; live: boolean };
type Deps = { pool: Pool; now: () => Date };
type Q = Pick<Queryable, "query">;

const isKind = (v: unknown): v is NudgeKind => v === "use" || v === "rosters";

// The next Game Day of the Leagues it runs or its teams play in (null: none coming).
async function nextGameDay(q: Q, org: string, today: string): Promise<string | null> {
  const r = await q.query<{ day: string | null }>(
    `select min(gd.day)::text as day
       from scenic_programs p join program_game_days pg on pg.program_id = p.id and pg.kind = 'game' join game_days gd on gd.id = pg.game_day_id
      where p.kind = 'League' and gd.day >= $2::date
        and (p.org = $1 or exists (
          select 1 from scenic_registrations r join scenic_teams t on t.id = r.team_id
            left join org_teams ot on ot.id = t.org_team_id left join partners pa on pa.id = t.partner_id
           where r.program_id = p.id and r.removed_by is null
             and (($1 = 'thunder' and t.thunder_team_id is not null) or ot.org = $1 or pa.org_slug = $1)))`,
    [org, today],
  );
  return r.rows[0]?.day ?? null;
}

// Each team's Head Coach and Team Manager (a League team: from wherever it's kept), for the teams given.
async function rosterStaff(q: Q, org: string, ids: string[]): Promise<{ team: string; coach_id: string }[]> {
  if (!ids.length) return [];
  const sql =
    org === "scenic-city"
      ? `select t.id::text as team, x.coach_id from scenic_teams t cross join lateral (
           select t.coach_id where t.org_team_id is null and t.thunder_team_id is null and t.coach_id is not null
           union select s.coach_id from team_staff s where s.team_id = t.thunder_team_id and s.role in ('HeadCoach', 'Manager')
           union select c.coach_id from org_team_coaches c where c.team_id = t.org_team_id and c.role in ('HeadCoach', 'Manager')
         ) x where t.id = any($1::bigint[])`
      : org === "thunder"
        ? "select team_id::text as team, coach_id from team_staff where team_id = any($1::bigint[]) and role in ('HeadCoach', 'Manager')"
        : "select team_id::text as team, coach_id from org_team_coaches where team_id = any($1::bigint[]) and role in ('HeadCoach', 'Manager')";
  return (await q.query<{ team: string; coach_id: string }>(sql, [ids])).rows;
}

// Who's copied on each team's reminders: its whole staff (any role; a Solo team: its coach and owner) and its organization's
// Owners, Admins and Directors of Teams. Emails by team.
async function teamCopies(q: Q, org: string, ids: string[]): Promise<Map<string, string[]>> {
  if (!ids.length) return new Map();
  const sql =
    org === "scenic-city"
      ? `select t.id::text as team, x.coach_id, coalesce(case when t.thunder_team_id is not null then 'thunder' end, ot.org, pa.org_slug) as org
           from scenic_teams t left join org_teams ot on ot.id = t.org_team_id left join partners pa on pa.id = t.partner_id
           left join lateral (
             select s.coach_id from team_staff s where s.team_id = t.thunder_team_id
             union select c.coach_id from org_team_coaches c where c.team_id = t.org_team_id
             union select t.coach_id where t.thunder_team_id is null and t.org_team_id is null
             union select t.owner_coach_id where t.thunder_team_id is null and t.org_team_id is null
           ) x on true where t.id = any($1::bigint[])`
      : org === "thunder"
        ? "select t.id::text as team, s.coach_id, 'thunder' as org from teams t left join team_staff s on s.team_id = t.id where t.id = any($1::bigint[])"
        : "select t.id::text as team, c.coach_id, t.org from org_teams t left join org_team_coaches c on c.team_id = t.id where t.id = any($1::bigint[])";
  const staff = (await q.query<{ team: string; coach_id: string | null; org: string | null }>(sql, [ids])).rows;
  const orgs = [...new Set(staff.flatMap((x) => (x.org ? [x.org] : [])))];
  const heads = orgs.length
    ? (
        await q.query<{ org: string; coach_id: string }>(
          `select distinct r.org, r.coach_id from org_roles r
            where r.org = any($1::text[]) and has_role(r.coach_id, r.org, r.role)
              and (r.role in ('Owner', 'Admin')
                   or (r.role = 'Director' and exists (select 1 from director_areas a where a.coach_id = r.coach_id and a.org = r.org and a.area = 'teams')))`,
          [orgs],
        )
      ).rows
    : [];
  const people = [...new Set([...staff.flatMap((x) => (x.coach_id ? [x.coach_id] : [])), ...heads.map((h) => h.coach_id)])];
  const email = new Map(
    (
      await q.query<{ coach_id: string; email: string | null }>(
        "select coach_id, coalesce(verified_email, email) as email from users where coach_id = any($1::text[]) and active",
        [people],
      )
    ).rows.flatMap((u) => (u.email?.includes("@") ? [[u.coach_id, u.email.trim()] as const] : [])),
  );
  const out = new Map<string, Set<string>>();
  for (const x of staff) {
    const set = out.get(x.team) ?? out.set(x.team, new Set()).get(x.team)!;
    if (x.coach_id && email.has(x.coach_id)) set.add(email.get(x.coach_id)!);
    for (const h of heads) if (h.org === x.org && email.has(h.coach_id)) set.add(email.get(h.coach_id)!);
  }
  return new Map([...out].map(([k, v]) => [k, [...v]]));
}

// Whether jersey numbers count toward a complete roster (as on Home's card): Thunder with Uniforms on; everyone else always.
const numbersCount = async (q: Q, org: string) => org !== "thunder" || (await orgFeatures(q, org)).has("uniforms");

// Who'd get this reminder now (active logins only), by last name, with their teams (and, for rosters, what's missing).
export async function nudgeRecipients(q: Q, org: string, now: Date, kind: NudgeKind): Promise<Recipient[]> {
  const today = easternDate(now);
  const byCoach = new Map<string, Map<string, { name: string; missing: string[] }>>(); // coach → team id → its name, what's missing
  const add = (coach: string, id: string, name: string, missing: string[]) =>
    (byCoach.get(coach) ?? byCoach.set(coach, new Map()).get(coach)!).set(id, { name, missing });
  if (kind === "use") {
    const r = await q.query<{ coach_id: string; team: string; team_id: string }>(
      `with c as (${COACHES[org] ?? ORG_COACHES})
       select distinct c.coach_id, c.team, c.team_id from c join users u on u.coach_id = c.coach_id
        where u.active and $1::text is not null and $3::date is not null
          and not (coalesce(u.last_login_at > $2::timestamptz - make_interval(days => ${USE_DAYS}), false)
                   or exists (select 1 from site_visits v where v.coach_id = u.coach_id and v.hour > $2::timestamptz - make_interval(days => ${USE_DAYS})))`,
      [org, now, today],
    );
    for (const x of r.rows) add(x.coach_id, x.team_id, x.team, []);
  } else {
    const open = (await rosterTeams(q, org, now, await numbersCount(q, org))).filter((t) => t.missing.length);
    const team = new Map(open.map((t) => [t.id, t]));
    for (const s of await rosterStaff(q, org, open.map((t) => t.id))) {
      const t = team.get(s.team)!;
      add(s.coach_id, t.id, t.name, t.missing);
    }
  }
  if (!byCoach.size) return [];
  const copies = await teamCopies(q, org, [...new Set([...byCoach.values()].flatMap((m) => [...m.keys()]))]);
  const u = await q.query<{ coach_id: string; first: string; last: string; cell: string | null; email: string | null; channel: "email" | "text" | null; by: string | null; at: Date | null }>(
    `select u.coach_id, u.first_name as first, u.last_name as last, u.cell, coalesce(u.verified_email, u.email) as email, n.channel, n.sent_by as by, n.sent_at as at
       from users u left join lateral (select channel, sent_by, sent_at from coach_nudges n where n.org = $2 and n.kind = $3 and n.coach_id = u.coach_id and not n.test
                                         order by sent_at desc limit 1) n on true
      where u.coach_id = any($1::text[]) and u.active
      order by lower(u.last_name), lower(u.first_name)`,
    [[...byCoach.keys()], org, kind],
  );
  return u.rows.map((x) => ({
    coachId: x.coach_id,
    name: `${x.first} ${x.last}`,
    first: x.first,
    cell: x.cell,
    email: x.email?.includes("@") ? x.email : null,
    teams: [...byCoach.get(x.coach_id)!.values()].sort((a, b) => a.name.localeCompare(b.name)),
    // Everyone copied on their teams, but them.
    cc: [...new Set([...byCoach.get(x.coach_id)!.keys()].flatMap((t) => copies.get(t) ?? []))]
      .filter((e) => e.toLowerCase() !== (x.email ?? "").trim().toLowerCase())
      .sort((a, b) => a.localeCompare(b)),
    last: x.channel && x.by && x.at ? { channel: x.channel, by: x.by, at: x.at.toISOString() } : null,
  }));
}

async function context(q: Q, viewer: SessionUser, org: string, now: Date, base: string): Promise<NudgeContext> {
  const today = easternDate(now);
  const o = (await q.query<{ name: string }>("select name from organizations where slug = $1", [org])).rows[0];
  return { org, orgName: o?.name ?? org, link: `${base.replace(/\/$/, "")}/login/${org}`, sender: `${viewer.firstName} ${viewer.lastName}`, next: await nextGameDay(q, org, today), today };
}

// Owners and Admins: who'd get it, and the text. Null when they may not.
export async function nudgeList(deps: Deps, viewer: SessionUser, org: string, kind: unknown, base: string, live: boolean): Promise<NudgeList | null> {
  if (!isKind(kind) || !(await isOrgAdmin(deps.pool, viewer.coachId, org))) return null;
  const now = deps.now();
  const [recipients, c] = await Promise.all([nudgeRecipients(deps.pool, org, now, kind), context(deps.pool, viewer, org, now, base)]);
  return { kind, recipients, context: c, text: nudgeText(kind, c), live };
}

export const BATCH = 10; // emails per call (a host's request time limit)
type Send = (m: { to: string; cc?: string[]; subject: string; text: string }) => Promise<void>;
export type SendResult = { ok: true; sent: number; noEmail: string[] } | { ok: false; message: string };

// Email the chosen coaches (only those who'd get it now; the browser picks, the server decides). Live: each their own, up to
// BATCH per call. Test site: one email to the sender, the first coach's, with who'd get it.
export async function sendNudges(
  deps: Deps & { sendMail: Send },
  viewer: SessionUser,
  org: string,
  kind: unknown,
  coachIds: unknown,
  note: unknown,
  base: string,
  live: boolean,
): Promise<SendResult> {
  if (!isKind(kind) || !Array.isArray(coachIds) || !coachIds.every((x) => typeof x === "string")) return { ok: false, message: "Choose who to email." };
  const n = typeof note === "string" ? note.slice(0, 1000) : "";
  if (!(await isOrgAdmin(deps.pool, viewer.coachId, org))) return { ok: false, message: "Only the organization's Owners and Admins can send these." };
  if (live && coachIds.length > BATCH) return { ok: false, message: "Too many at once." };
  const now = deps.now();
  const want = new Set(coachIds as string[]);
  const [all, c] = await Promise.all([nudgeRecipients(deps.pool, org, now, kind), context(deps.pool, viewer, org, now, base)]);
  const chosen = all.filter((r) => want.has(r.coachId));
  if (!chosen.length) return { ok: false, message: "None of them need this reminder now." };
  const withEmail = chosen.filter((r) => r.email);
  const noEmail = chosen.filter((r) => !r.email).map((r) => r.name);
  if (!live) {
    const me = (await deps.pool.query<{ email: string | null }>("select coalesce(verified_email, email) as email from users where coach_id = $1", [viewer.coachId])).rows[0]?.email;
    if (!me) return { ok: false, message: "Add your email to your profile to get the test email." };
    const first = nudgeEmail(kind, withEmail[0] ?? chosen[0], c, n);
    const head = [
      "TEST MODE: nothing went to anyone else. On the live site each of these coaches gets their own email (this is the first one's):",
      ...withEmail.map((r) => `  ${r.name} <${r.email}>: ${r.teams.map((t) => t.name).join(", ")}${r.cc.length ? `\n      Cc: ${r.cc.join(", ")}` : ""}`),
      ...(noEmail.length ? ["No email on file (text them instead):", ...noEmail.map((x) => `  ${x}`)] : []),
      "",
      "----------",
      "",
    ];
    await deps.sendMail({ to: me, subject: `[TEST] ${first.subject}`, text: head.join("\n") + first.text });
  } else for (const r of withEmail) await deps.sendMail({ to: r.email!, cc: r.cc, ...nudgeEmail(kind, r, c, n) });
  if (withEmail.length)
    await deps.pool.query(
      `insert into coach_nudges (org, kind, channel, coach_id, sent_by, sent_at, test) select $1, $2, 'email', x, $4, $5, $6 from unnest($3::text[]) x`,
      [org, kind, withEmail.map((r) => r.coachId), c.sender, now, !live],
    );
  return { ok: true, sent: withEmail.length, noEmail };
}

// A text opened in the sender's Messages: kept as sent to those with a cell (the app can't see it go).
export async function noteTexts(deps: Deps, viewer: SessionUser, org: string, kind: unknown, coachIds: unknown, live: boolean): Promise<{ ok: boolean; cells: string[] }> {
  if (!isKind(kind) || !Array.isArray(coachIds) || !(await isOrgAdmin(deps.pool, viewer.coachId, org))) return { ok: false, cells: [] };
  const want = new Set(coachIds.filter((x): x is string => typeof x === "string"));
  const chosen = (await nudgeRecipients(deps.pool, org, deps.now(), kind)).filter((r) => want.has(r.coachId) && r.cell);
  if (chosen.length)
    await deps.pool.query(
      `insert into coach_nudges (org, kind, channel, coach_id, sent_by, sent_at, test) select $1, $2, 'text', x, $4, $5, $6 from unnest($3::text[]) x`,
      [org, kind, chosen.map((r) => r.coachId), `${viewer.firstName} ${viewer.lastName}`, deps.now(), !live],
    );
  return { ok: true, cells: chosen.map((r) => r.cell!) };
}

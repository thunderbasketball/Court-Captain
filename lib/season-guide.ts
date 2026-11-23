// The season guide (SPEC.md section 13): a CourtTeams organization (one that runs Leagues and events, like Scenic City)
// emails how to use CourtCaptain for a good season: key dates, what's available and how to use each part. Its Owners,
// Admins and Directors of Teams; they see the email and every address first, then confirm.
// Live site: one email To whoever sends it, Cc the staff (Owners, Admins, Directors) of the organizations with teams
// playing in its current events or hosting their games, Bcc every coach (Head and Assistant Coaches with an email) of
// those teams; Bcc goes in groups (an email each), Cc on the first. Test mode (not the live site): only to whoever sends
// it, listing the addresses it would have gone to. Who sent it, when, and to whom are recorded.
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { hasFeature } from "./features";
import { orgName } from "./org-registry";
import { leagueStaff } from "./scenic-team-page";
import { requestSettings } from "./schedule-requests";
import { REC_DAYS_DEFAULT, closesOn } from "./schedule-request-blocks";
import { withTx, type Queryable } from "./sql";
import { easternDate } from "./time";

type Deps = { pool: Pool; now: () => Date };
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };
export type GuideMail = { to: string; cc?: string[]; bcc?: string[]; subject: string; text: string; html: string };
const by = (v: SessionUser) => `${v.firstName} ${v.lastName}`;
const BCC_GROUP = 45; // coaches per email (email services cap recipients per message)
const isEmail = (v: string | null | undefined): v is string => !!v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

// Its Owners, Admins (CourtCaptain staff too) and Directors of Teams, read straight from the roles (actions run it).
async function mayGuide(q: Pick<Queryable, "query">, viewer: SessionUser, org: string): Promise<boolean> {
  const r = await q.query<{ ok: boolean }>(
    `select acts_as($1, $2, 'Admin')
         or (has_role($1, $2, 'Director') and exists (select 1 from active_director_areas a where a.coach_id = $1 and a.org = $2 and a.area = 'teams')) as ok`,
    [viewer.coachId, org],
  );
  return r.rows[0]?.ok ?? false;
}

// Who it goes to: the coaches (Bcc) of the teams in its events that haven't ended, and the staff (Cc) of the
// organizations with teams in them or hosting their games. Emails only, each once; the sender's own left out.
async function audience(q: Pick<Queryable, "query">, org: string, today: string, me: string | null) {
  const t = await q.query<{ id: string; team_org: string | null }>(
    `select distinct t.id::text, coalesce(ot.org, case when t.thunder_team_id is not null then 'thunder' end) as team_org
       from scenic_registrations r join scenic_programs p on p.id = r.program_id join scenic_teams t on t.id = r.team_id
       left join org_teams ot on ot.id = t.org_team_id
      where p.org = $1 and p.ends_on >= $2::date and r.removed_by is null and t.name not like '%(DEV)'`,
    [org, today],
  );
  const staff = await leagueStaff(q, t.rows.map((x) => x.id));
  const coaches = new Map<string, string>();
  for (const list of Object.values(staff))
    for (const s of list) if ((s.role === "HeadCoach" || s.role === "AsstCoach") && isEmail(s.email)) coaches.set(s.email.trim().toLowerCase(), s.email.trim());
  // Organizations playing (their teams) or hosting (their gyms, or a partner's gyms, in its current games).
  const hosts = await q.query<{ org: string }>(
    `select distinct coalesce(g.org, pa.org_slug) as org
       from scenic_matchups m join scenic_programs p on p.id = m.program_id
       left join gyms g on m.court_key like 'o%' and g.id::text = split_part(substr(m.court_key, 2), '-', 1)
       left join partner_courts pc on m.court_key ~ '^[0-9]+$' and pc.id = m.court_key::bigint
       left join partner_gyms pg on pg.id = pc.gym_id left join partners pa on pa.id = pg.partner_id
      where p.org = $1 and p.ends_on >= $2::date and coalesce(g.org, pa.org_slug) is not null`,
    [org, today],
  );
  const orgs = [...new Set([...t.rows.flatMap((x) => (x.team_org ? [x.team_org] : [])), ...hosts.rows.map((x) => x.org)])];
  const people = orgs.length
    ? await q.query<{ email: string }>(
        `select distinct coalesce(u.verified_email, u.email) as email from org_roles r join users u on u.coach_id = r.coach_id
          where r.org = any($1::text[]) and r.role in ('Owner', 'Admin', 'Director') and u.active
            and coalesce(u.verified_email, u.email) is not null`,
        [orgs],
      )
    : { rows: [] };
  const cc = new Map<string, string>();
  for (const p of people.rows) if (isEmail(p.email)) cc.set(p.email.trim().toLowerCase(), p.email.trim());
  const mine = me?.trim().toLowerCase();
  if (mine) {
    cc.delete(mine);
    coaches.delete(mine);
  }
  for (const k of cc.keys()) coaches.delete(k); // a Director who also coaches: Cc'd once
  const sort = (m: Map<string, string>) => [...m.values()].sort((a, b) => a.localeCompare(b));
  // Where the coaches log in: each team's organization (Thunder's, an organization's), and the League itself for its
  // own teams (Solo, a club, FastBreak).
  const loginOrgs = [...new Set([...t.rows.map((x) => x.team_org ?? org)])];
  return { bcc: sort(coaches), cc: sort(cc), teams: t.rows.length, orgs: orgs.length, loginOrgs };
}

// The guide's parts: a title (bold) and its lines. Turned into plain text and a formatted (html, escaped) version.
type Part = { title?: string; lines: string[] };
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const link = (s: string) => esc(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
function render(parts: Part[]): { text: string; html: string } {
  const text = parts.map((p) => [...(p.title ? [p.title.toUpperCase()] : []), ...p.lines].join("\n")).join("\n\n");
  const html =
    `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;line-height:1.5;color:#18181b;max-width:640px">` +
    parts
      .map(
        (p) =>
          `<p style="margin:0 0 14px">${p.title ? `<strong style="font-size:16px">${esc(p.title)}</strong><br>` : ""}${p.lines.map(link).join("<br>")}</p>`,
      )
      .join("") +
    `</div>`;
  return { text, html };
}
const DAY = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

// The guide: key dates (each current League's Game Days, Brackets and request closes), then each part of CourtCaptain
// and how to use it; the League's own time blocks and close days.
async function guide(
  q: Pick<Queryable, "query">,
  org: string,
  base: string,
  today: string,
  sender: SessionUser & { email?: string | null },
  loginOrgs: string[],
) {
  const name = await orgName(q, org);
  // Each organization's login page, by name (the League first).
  const logins = (
    await q.query<{ slug: string; name: string }>("select slug, name from organizations where slug = any($1::text[])", [[org, ...loginOrgs]])
  ).rows.sort((a, b) => (a.slug === org ? -1 : b.slug === org ? 1 : a.name.localeCompare(b.name)));
  const site = base.replace(/\/+$/, "");
  const leagues = (
    await q.query<{ id: string; name: string; days: string[]; brackets: string[] }>(
      `select p.id::text, p.name,
              array(select to_char(g.day, 'YYYY-MM-DD') from program_game_days d join game_days g on g.id = d.game_day_id
                     where d.program_id = p.id and d.kind = 'game' order by g.day) as days,
              array(select to_char(g.day, 'YYYY-MM-DD') from program_game_days d join game_days g on g.id = d.game_day_id
                     where d.program_id = p.id and d.kind = 'bracket' order by g.day) as brackets
         from scenic_programs p where p.org = $1 and p.kind = 'League' and p.ends_on >= $2::date order by p.starts_on`,
      [org, today],
    )
  ).rows;
  const set = leagues[0] ? await requestSettings(q, leagues[0].id) : null;
  const chat = await hasFeature(q, org, "chat");
  const blocks = set ? set.blocks.map((b) => b.label).join(", ") : "the League's time blocks";
  const comp = set?.compDays == null ? "the Sunday before each Game Day" : `${set.compDays} day${set.compDays === 1 ? "" : "s"} before each Game Day`;
  const rec = `${set?.recDays ?? REC_DAYS_DEFAULT} days before the League's first Game Day (all dates at once)`;
  const keyDates: Part[] = leagues.map((l) => ({
    title: `Key dates: ${l.name}`,
    lines: [
      l.days.length ? `Game Days: ${l.days.map(DAY).join(", ")}` : "Game Days: to be announced",
      ...(l.brackets.length ? [`Brackets: ${l.brackets.map(DAY).join(", ")}`] : []),
      ...(l.days.length ? [`REC schedule requests close: ${DAY(closesOn("REC", l.days[0], l.days[0], set ?? {}))} night`] : []),
      ...(l.days.length ? [`COMP schedule requests close: ${comp} (first: ${DAY(closesOn("COMP", l.days[0], l.days[0], set ?? {}))} night)`] : []),
    ],
  }));
  let n = 0;
  const step = (title: string, ...lines: string[]): Part => ({ title: `${++n}. ${title}`, lines });
  const parts: Part[] = [
    { lines: ["Hi Coaches,"] },
    { lines: [`Welcome to the season with ${name}! Everything for your team is in CourtCaptain. Here's how to use it for a smooth season.`] },
    ...keyDates,
    { title: "What's available and how to use it", lines: [] },
    step(
      "Log in",
      "Use your organization's login page:",
      ...logins.map((o) => `• ${o.name}: ${site}/login/${o.slug}`),
      "Enter your cell number, then your PIN (or the code we email you).",
      "Not in your inbox? Check your Spam folder: our emails can land there at first.",
    ),
    step(
      "Put it on your phone (like an app)",
      "Open your login page above on your phone, then:",
      "• iPhone (Safari): tap the Share button (the square with the arrow), then Add to Home Screen, then Add.",
      "• Android (Chrome): tap the ⋮ menu at the top right, then Add to Home screen (or Install app), then Add.",
      "CourtCaptain is now an icon on your home screen: tap it to open your team, like any app.",
    ),
    step("Your team page", "Your Home is your team page: its registration (your dates, 1GG or 2GG, the Brackets, Paid or Unpaid), Next 10 days, Staff, Roster and Games."),
    step(
      "Roster and birthdates",
      "Roster → + Add player: first and last name, grade, jersey number and birthdate.",
      "Every player needs a birthdate; your team shows PLAYER BIRTHDATES MUST BE ENTERED until each one is in.",
    ),
    step("Staff", "Staff → + Add staff: your Assistant Coach, Team Manager or Team Parent (name, cell, email)."),
    step(
      "Schedule requests",
      `Current Registrations → Schedule requests: for each Game Day, check the times your team CAN'T play (up to ${set?.max ?? 2} of ${blocks}), or check Sit out if you won't play that week.`,
      `COMP teams: requests close ${comp}. REC teams: requests close ${rec}.`,
      "NO requests are taken after requests close. If your request can't be met, you won't be scheduled that day.",
    ),
    step(
      "Add dates or a 2nd Game",
      "COMP teams: on your team page, + Add dates or + Add a 2nd Game. Pick the dates and pay by card right there; they're added once it's paid.",
    ),
    step("Your games", "Once the schedule is published, Next 10 days and Games show each game's time, gym and opponent. Check it before every Game Day."),
    step("Invoices and payments", "Open invoices show on your Home with View invoice and Pay by card (card, Apple Pay or Google Pay)."),
    ...(chat ? [step("Chat", `Tap 💬 at the top to message ${name}'s Directors.`)] : []),
    step("Share with your parents", `${site}/login/${org}`, "Parents see the teams and games there without logging in, and tap ☆ to follow your team on their phone."),
    {
      title: "Questions?",
      lines: [`${sender.firstName} ${sender.lastName}${sender.email ? ` · ${sender.email}` : ""}, ${name}`],
    },
    { lines: ["Have a great season!", name] },
  ];
  return { subject: `${name}: your season guide to CourtCaptain`, ...render(parts) };
}

export type GuidePreview = {
  live: boolean; // the live site: it goes to everyone; else only to you
  to: string;
  cc: string[];
  bcc: string[];
  teams: number;
  orgs: number;
  subject: string;
  html: string;
  last: { by: string; at: Date; total: number; live: boolean } | null;
};

async function prepare(deps: Deps, viewer: SessionUser, org: unknown, base: string) {
  if (typeof org !== "string" || !(await hasFeature(deps.pool, org, "programs"))) return { ok: false as const, message: "This organization doesn't run events." };
  if (!(await mayGuide(deps.pool, viewer, org))) return { ok: false as const, message: "Only an Owner, Admin or Director of Teams can send this." };
  const me = (await deps.pool.query<{ email: string | null }>("select coalesce(verified_email, email) as email from users where coach_id = $1", [viewer.coachId])).rows[0]
    ?.email;
  if (!isEmail(me)) return { ok: false as const, message: "Add your email to your login first: the guide is sent To you." };
  const today = easternDate(deps.now());
  const a = await audience(deps.pool, org, today, me);
  if (!a.bcc.length) return { ok: false as const, message: "No coaches with an email on teams in your current events yet." };
  const g = await guide(deps.pool, org, base, today, { ...viewer, email: me }, a.loginOrgs);
  return { ok: true as const, org, me: me.trim(), ...a, ...g };
}

// What it would send, to whom (every address), and the last send. Nothing is sent.
export async function seasonGuidePreview(deps: Deps, viewer: SessionUser, org: unknown, base: string, live: boolean): Promise<Result<GuidePreview>> {
  const p = await prepare(deps, viewer, org, base);
  if (!p.ok) return p;
  const last = (
    await deps.pool.query<{ by: string; at: Date; total: number; live: boolean }>(
      `select started_by as by, started_at as at, total, subject not like '[TEST]%' as live from org_guide_sends where org = $1 order by started_at desc, id desc limit 1`,
      [p.org],
    )
  ).rows[0];
  return { ok: true, live, to: p.me, cc: p.cc, bcc: p.bcc, teams: p.teams, orgs: p.orgs, subject: p.subject, html: p.html, last: last ?? null };
}

// Send it. Live: To the sender, Cc the organizations' staff (first email), Bcc the coaches in groups. Test mode: one
// email to the sender only, listing every address it would have gone to. Recorded with each address.
export async function sendSeasonGuide(
  deps: Deps & { sendMail: (m: GuideMail) => Promise<void> },
  viewer: SessionUser,
  org: unknown,
  base: string,
  live: boolean,
): Promise<Result<{ live: boolean; to: string; cc: number; bcc: number; emails: number }>> {
  const p = await prepare(deps, viewer, org, base);
  if (!p.ok) return p;
  let emails = 0;
  if (live) {
    for (let i = 0; i < p.bcc.length; i += BCC_GROUP) {
      await deps.sendMail({ to: p.me, ...(i === 0 && p.cc.length ? { cc: p.cc } : {}), bcc: p.bcc.slice(i, i + BCC_GROUP), subject: p.subject, text: p.text, html: p.html });
      emails++;
    }
  } else {
    const list = (title: string, xs: string[]) => [`${title} (${xs.length}):`, ...(xs.length ? xs.map((x) => `  ${x}`) : ["  (none)"])];
    const head = [
      "TEST MODE: nothing went to coaches or staff. On the live site this email goes:",
      ...list("To", [p.me]),
      ...list("Cc: staff of the organizations playing or hosting", p.cc),
      ...list("Bcc: coaches", p.bcc),
      "",
      "────────────────────────",
      "",
    ];
    const htmlHead =
      `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:14px;background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:12px;margin-bottom:16px">` +
      `<strong>TEST MODE: nothing went to coaches or staff.</strong> On the live site this email goes:<br><br>` +
      `<strong>To (1):</strong> ${esc(p.me)}<br><br>` +
      `<strong>Cc: staff of the organizations playing or hosting (${p.cc.length}):</strong><br>${p.cc.map(esc).join("<br>") || "(none)"}<br><br>` +
      `<strong>Bcc: coaches (${p.bcc.length}):</strong><br>${p.bcc.map(esc).join("<br>")}</div>`;
    await deps.sendMail({ to: p.me, subject: `[TEST] ${p.subject}`, text: head.join("\n") + p.text, html: htmlHead + p.html });
    emails = 1;
  }
  await withTx(deps.pool, async (q) => {
    const id = (
      await q.query<{ id: string }>(
        "insert into org_guide_sends (org, subject, total, started_by, started_at) values ($1, $2, $3, $4, $5) returning id::text",
        [p.org, live ? p.subject : `[TEST] ${p.subject}`, p.cc.length + p.bcc.length, by(viewer), deps.now()],
      )
    ).rows[0].id;
    // Each address and how it got it (To, Cc, Bcc); in test mode none were sent (sent_at stays empty).
    const rows: [string, string][] = [[p.me, "To"], ...p.cc.map((e): [string, string] => [e, "Cc"]), ...p.bcc.map((e): [string, string] => [e, "Bcc"])];
    for (const [email, how] of rows)
      await q.query("insert into org_guide_recipients (send_id, email, body, sent_at) values ($1, $2, $3, $4) on conflict do nothing", [
        id,
        email,
        how,
        live || how === "To" ? deps.now() : null,
      ]);
  });
  return { ok: true, live, to: p.me, cc: p.cc.length, bcc: p.bcc.length, emails };
}

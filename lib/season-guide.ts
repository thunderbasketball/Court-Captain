// Standard emails (SPEC.md section 13): an organization that runs Leagues and events (CourtTeams) emails
// - the Season Guide to everyone associated with its Leagues: how to use CourtCaptain for a good season;
// - the Hosting Guide to its hosting sites' staff: gyms, game days, scoresheets and scores.
// Its Owners, Admins and Directors of Teams (or, for the Hosting Guide, of Facilities); they see the email and every
// address first, then confirm. Live site: one email To whoever sends it, Cc and Bcc as below; Bcc goes in groups (an
// email each), Cc on the first. Season: Cc the staff (Owners, Admins, Directors) of the League, of the organizations with
// teams in its current events, of those approved to host its games and of its officials groups; Bcc every team's staff,
// Solo owners and club contacts. Hosting: Bcc the hosting organizations' staff. Test mode (not the live site): only to
// whoever sends it, listing the addresses it would have gone to. Who sent it, when, and to whom are recorded.
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
export type GuideKind = "season" | "hosting";
export const guideKind = (v: unknown): GuideKind => (v === "hosting" ? "hosting" : "season");
export type GuideMail = { to: string; cc?: string[]; bcc?: string[]; subject: string; text: string; html: string };
const by = (v: SessionUser) => `${v.firstName} ${v.lastName}`;
const BCC_GROUP = 45; // staff per email (email services cap recipients per message)
const isEmail = (v: string | null | undefined): v is string => !!v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

// Its Owners, Admins (CourtCaptain staff too) and Directors of Teams (Hosting Guide: or of Facilities), read straight from the roles (actions run it).
async function mayGuide(q: Pick<Queryable, "query">, viewer: SessionUser, org: string, kind: GuideKind): Promise<boolean> {
  const r = await q.query<{ ok: boolean }>(
    `select acts_as($1, $2, 'Admin')
         or (has_role($1, $2, 'Director') and exists (select 1 from active_director_areas a where a.coach_id = $1 and a.org = $2 and a.area = any($3::text[]))) as ok`,
    [viewer.coachId, org, kind === "hosting" ? ["teams", "facilities"] : ["teams"]],
  );
  return r.rows[0]?.ok ?? false;
}

type Emails = Map<string, string>; // by the address in small letters
const put = (m: Emails, email: string | null | undefined) => {
  if (isEmail(email)) m.set(email.trim().toLowerCase(), email.trim());
};
const sorted = (m: Emails) => [...m.values()].sort((a, b) => a.localeCompare(b));

// The organizations approved to host its games.
async function hostsOf(q: Pick<Queryable, "query">, org: string): Promise<string[]> {
  const r = await q.query<{ org: string }>("select host_org as org from org_partnerships where for_org = $1 and status = 'approved' order by 1", [org]);
  return r.rows.map((x) => x.org);
}

// Those organizations' Owners, Admins and Directors, with an email.
async function staffEmails(q: Pick<Queryable, "query">, orgs: string[]): Promise<Emails> {
  const out: Emails = new Map();
  if (!orgs.length) return out;
  const r = await q.query<{ email: string | null }>(
    `select distinct coalesce(u.verified_email, u.email) as email from org_roles r join users u on u.coach_id = r.coach_id
      where r.org = any($1::text[]) and r.role in ('Owner', 'Admin', 'Director') and u.active`,
    [orgs],
  );
  for (const p of r.rows) put(out, p.email);
  return out;
}

type Audience = { cc: string[]; bcc: string[]; about: string; loginOrgs: string[]; ccLabel: string; bccLabel: string; none: string };

// The Season Guide: everyone associated with its current events. Emails only, each once (Cc first); the sender's own
// left out.
async function seasonAudience(q: Pick<Queryable, "query">, org: string, today: string, me: string): Promise<Audience> {
  const t = await q.query<{ id: string; team_org: string | null; owner: string | null }>(
    `select distinct t.id::text, coalesce(ot.org, case when t.thunder_team_id is not null then 'thunder' end) as team_org,
            (select coalesce(u.verified_email, u.email) from users u where u.coach_id = t.owner_coach_id and u.active) as owner
       from scenic_registrations r join scenic_programs p on p.id = r.program_id join scenic_teams t on t.id = r.team_id
       left join org_teams ot on ot.id = t.org_team_id
      where p.org = $1 and p.ends_on >= $2::date and r.removed_by is null and t.name not like '%(DEV)'`,
    [org, today],
  );
  const ids = t.rows.map((x) => x.id);
  const team: Emails = new Map();
  for (const list of Object.values(await leagueStaff(q, ids))) for (const s of list) put(team, s.email); // every staff role
  for (const x of t.rows) put(team, x.owner); // a Solo team's owner
  const contacts = await q.query<{ email: string | null }>(
    `select distinct coalesce(u.verified_email, u.email) as email from scenic_teams t join partner_contacts pc on pc.partner_id = t.partner_id
       join users u on u.coach_id = pc.coach_id and u.active where t.id = any($1::bigint[])`,
    [ids],
  );
  for (const c of contacts.rows) put(team, c.email); // its club's contacts
  const playing = [...new Set(t.rows.flatMap((x) => (x.team_org ? [x.team_org] : [])))];
  const hosts = await hostsOf(q, org);
  const officials = (
    await q.query<{ org: string }>("select officials_org as org from officiating_partnerships where for_org = $1 and status = 'approved'", [org])
  ).rows.map((x) => x.org);
  const orgs = [...new Set([org, ...playing, ...hosts, ...officials])];
  const cc = await staffEmails(q, orgs);
  cc.delete(me.toLowerCase());
  team.delete(me.toLowerCase());
  for (const k of cc.keys()) team.delete(k); // a Director who's also on a team's staff: Cc'd once
  return {
    cc: sorted(cc),
    bcc: sorted(team),
    about: `${ids.length} team${ids.length === 1 ? "" : "s"} in your current events · ${playing.length} organization${playing.length === 1 ? "" : "s"} playing · ${hosts.length} approved to host · ${officials.length} officials group${officials.length === 1 ? "" : "s"}.`,
    // Where the team staff log in: each team's organization, and the League itself for its own teams.
    loginOrgs: [...new Set(t.rows.map((x) => x.team_org ?? org))],
    ccLabel: "Cc: staff of the League, the organizations playing or hosting, and officials groups",
    bccLabel: "Bcc: all team staff (Head and Assistant Coaches, Managers, Team Parents), Solo owners and club contacts",
    none: "No team staff with an email on teams in your current events yet.",
  };
}

// The Hosting Guide: the staff of the organizations approved to host its games (each address hidden from the others).
async function hostingAudience(q: Pick<Queryable, "query">, org: string, me: string): Promise<Audience> {
  const hosts = await hostsOf(q, org);
  const bcc = await staffEmails(q, hosts);
  bcc.delete(me.toLowerCase());
  return {
    cc: [],
    bcc: sorted(bcc),
    about: `${hosts.length} organization${hosts.length === 1 ? "" : "s"} approved to host your games.`,
    loginOrgs: hosts,
    ccLabel: "Cc",
    bccLabel: "Bcc: hosting sites' staff (Owners, Admins and Directors)",
    none: "No hosting organization has staff with an email yet.",
  };
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

// What both guides say: the organization, each login page (the League's first) and its current Leagues' dates.
async function facts(q: Pick<Queryable, "query">, org: string, base: string, today: string, loginOrgs: string[]) {
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
  return { name, logins, site, leagues };
}

const FIRST_TIME = [
  "FIRST TIME:",
  "• Type your cell number (the one your Director has for you).",
  "• Type your email if it asks, then tap Email me a code.",
  "• Type the 6-digit code from that email and choose a 4-digit PIN. You're in.",
  "AFTER THAT: type your cell number, then your 4-digit PIN. (It may ask once to confirm your email with a code.)",
  "Forgot your PIN? Type your cell number, tap Forgot PIN? and we'll email you a code.",
  "No code in your inbox? Check your Spam folder: our emails can land there at first.",
];
const ON_YOUR_PHONE = [
  "Open your login page above on your phone, then:",
  "• iPhone (Safari): tap the Share button (the square with the arrow), then Add to Home Screen, then Add.",
  "• Android (Chrome): tap the ⋮ menu at the top right, then Add to Home screen (or Install app), then Add.",
];

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
  const { name, logins, site, leagues } = await facts(q, org, base, today, loginOrgs);
  const set = leagues[0] ? await requestSettings(q, leagues[0].id) : null;
  const season = leagues.map((l) => l.name).join(" and ") || "season";
  const chat = await hasFeature(q, org, "chat");
  const blocks = set ? set.blocks.map((b) => b.label).join(", ") : "the League's time blocks";
  const comp = set?.compDays == null ? "the Sunday before each Game Day" : `${set.compDays} day${set.compDays === 1 ? "" : "s"} before each Game Day`;
  const rec = `${set?.recDays ?? REC_DAYS_DEFAULT} days before the League's first Game Day (all dates at once)`;
  const keyDates: Part[] = leagues.map((l) => ({
    title: `Key dates: ${l.name}`,
    lines: [
      l.days.length ? `Game Days: ${l.days.map(DAY).join(", ")}` : "Game Days: to be announced",
      "ROSTERS ARE LOCKED after your team's 1st game, for the rest of the season",
      ...(l.brackets.length ? [`Brackets: ${l.brackets.map(DAY).join(", ")}`] : []),
      ...(l.days.length ? [`REC schedule requests close: ${DAY(closesOn("REC", l.days[0], l.days[0], set ?? {}))} night`] : []),
      ...(l.days.length ? [`COMP schedule requests close: ${comp} (first: ${DAY(closesOn("COMP", l.days[0], l.days[0], set ?? {}))} night)`] : []),
    ],
  }));
  let n = 0;
  const step = (title: string, ...lines: string[]): Part => ({ title: `${++n}. ${title}`, lines });
  const parts: Part[] = [
    { lines: ["Hi Coaches and Team Staff,"] },
    {
      title: `WE ARE USING COURTCAPTAIN FOR OUR ${season.toUpperCase()} SCHEDULE`,
      lines: [
        `Welcome to the season with ${name}! Your team's schedule, game times, gyms, schedule requests, roster and payments are all in CourtCaptain.`,
        "Please log in with your cell phone number now, so your team is ready before its 1st game. Here's how.",
      ],
    },
    ...keyDates,
    { title: "What's available and how to use it", lines: [] },
    step(
      "Log in",
      "Your cell phone number is your login. Open your organization's login page on your phone or computer:",
      ...logins.map((o) => `• ${o.name}: ${site}/login/${o.slug}`),
      ...FIRST_TIME,
      "It says Not set up yet? Your Director hasn't added you with that cell number: ask them to, then log in again.",
    ),
    step(
      "Put it on your phone (like an app)",
      ...ON_YOUR_PHONE,
      "CourtCaptain is now an icon on your home screen: tap it to open your team, like any app.",
    ),
    step(
      "Manage your team",
      "Once you log in, your Home is your team page: its registration (your dates, 1GG or 2GG, the Brackets, Paid or Unpaid), Next 10 days, Staff, Roster and Games.",
      "More than one team or organization? Switch between them at the top of the screen.",
      "Tap any card to open it. A card flashing red needs something from you.",
    ),
    step(
      "Roster: Name, Number, Date of Birth and Grade",
      "REQUIRED FOR EVERY PLAYER: Player Name, Uniform Number (##), Date of Birth and Grade.",
      "Head and Assistant Coaches: open Roster and tap + Add player. No + there? Your Director sets your roster.",
      "Your team page shows PLAYER NUMBERS or PLAYER BIRTHDATES MUST BE ENTERED until each one is in; open Roster to fill them in.",
      ...leagues.map(
        (l) => `${l.name} ROSTERS ARE LOCKED after your team's 1st game, for the rest of the season. Have every player on your roster before your 1st game.`,
      ),
    ),
    step("Staff", "Staff → + Add staff: your Assistant Coach, Team Manager or Team Parent (name, cell, email). No + there? Ask your Director to add them."),
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
  return { subject: `${name}: we are using CourtCaptain for our ${season} schedule (season guide)`, ...render(parts) };
}

// The Hosting Guide: what a hosting site's staff do in CourtCaptain.
async function hostingGuide(q: Pick<Queryable, "query">, org: string, base: string, today: string, sender: SessionUser & { email?: string | null }, hosts: string[]) {
  const { name, logins, site, leagues } = await facts(q, org, base, today, hosts);
  const season = leagues.map((l) => l.name).join(" and ") || "season";
  let n = 0;
  const step = (title: string, ...lines: string[]): Part => ({ title: `${++n}. ${title}`, lines });
  const parts: Part[] = [
    { lines: ["Hi Hosting Sites,"] },
    {
      title: `WE ARE USING COURTCAPTAIN FOR OUR ${season.toUpperCase()} SCHEDULE`,
      lines: [
        `Thank you for hosting games for ${name}! Your gyms, game days, scoresheets and scores are all in CourtCaptain.`,
        "Please log in with your cell phone number now, so your site is ready before its first Game Day. Here's how.",
      ],
    },
    ...leagues.map((l) => ({
      title: `Key dates: ${l.name}`,
      lines: [
        l.days.length ? `Game Days: ${l.days.map(DAY).join(", ")}` : "Game Days: to be announced",
        ...(l.brackets.length ? [`Brackets: ${l.brackets.map(DAY).join(", ")}`] : []),
      ],
    })),
    { title: "What to do and how to do it", lines: [] },
    step(
      "Log in",
      "Your cell phone number is your login. Open your organization's login page on your phone or computer:",
      ...logins.filter((o) => hosts.includes(o.slug)).map((o) => `• ${o.name}: ${site}/login/${o.slug}`),
      ...FIRST_TIME,
      "It doesn't know your number? Ask your organization's Owner or Admin to add you to its staff.",
    ),
    step("Put it on your phone (like an app)", ...ON_YOUR_PHONE),
    step(
      "Set your gyms' availability",
      "Owners, Admins and Directors of Facilities: on your Home, open Facilities, then your gym.",
      "Tap each Game Day on its calendar, choose the League's games, set the hours your gym is open, and save.",
      "Do this for every Game Day you can host. The League schedules games from the hours you set.",
    ),
    step(
      "Rules and scoresheets",
      "Facilities → CourtSync → Documents: the League's rules, a blank scoresheet, and the scoresheets for each Game Day's games at your gyms.",
      "Print them before each Game Day. Team rosters print on them.",
    ),
    step(
      "Enter scores",
      "Give your scorekeeper or site director the Director of Scores role (Home → Members → Staff).",
      "On Game Day, open Scores on your Home: type each game's final score (or who forfeited) and tap Save. Standings update right away.",
    ),
    step("Share the schedule", `${site}/login/${org}`, "Anyone can see the teams, standings and games there without logging in, once the schedule is posted."),
    { title: "Questions?", lines: [`${sender.firstName} ${sender.lastName}${sender.email ? ` · ${sender.email}` : ""}, ${name}`] },
    { lines: ["Thank you for hosting!", name] },
  ];
  return { subject: `${name}: your hosting guide to CourtCaptain for ${season}`, ...render(parts) };
}

export type GuidePreview = {
  live: boolean; // the live site: it goes to everyone; else only to you
  to: string;
  cc: string[];
  bcc: string[];
  about: string; // "90 teams in your current events · …"
  ccLabel: string;
  bccLabel: string;
  subject: string;
  html: string;
  last: { by: string; at: Date; total: number; live: boolean } | null;
};

async function prepare(deps: Deps, viewer: SessionUser, org: unknown, base: string, kind: GuideKind) {
  if (typeof org !== "string" || !(await hasFeature(deps.pool, org, "programs"))) return { ok: false as const, message: "This organization doesn't run events." };
  if (!(await mayGuide(deps.pool, viewer, org, kind)))
    return { ok: false as const, message: "Only an Owner, Admin or Director of Teams can send this." };
  const me = (await deps.pool.query<{ email: string | null }>("select coalesce(verified_email, email) as email from users where coach_id = $1", [viewer.coachId])).rows[0]
    ?.email;
  if (!isEmail(me)) return { ok: false as const, message: "Add your email to your login first: the guide is sent To you." };
  const today = easternDate(deps.now());
  const a = kind === "hosting" ? await hostingAudience(deps.pool, org, me.trim()) : await seasonAudience(deps.pool, org, today, me.trim());
  if (!a.bcc.length) return { ok: false as const, message: a.none };
  const write = kind === "hosting" ? hostingGuide : guide;
  const g = await write(deps.pool, org, base, today, { ...viewer, email: me }, a.loginOrgs);
  return { ok: true as const, org, me: me.trim(), ...a, ...g };
}

// What it would send, to whom (every address), and the last send. Nothing is sent.
export async function seasonGuidePreview(deps: Deps, viewer: SessionUser, org: unknown, base: string, live: boolean, kind: GuideKind = "season"): Promise<Result<GuidePreview>> {
  const p = await prepare(deps, viewer, org, base, kind);
  if (!p.ok) return p;
  const last = (
    await deps.pool.query<{ by: string; at: Date; total: number; live: boolean }>(
      `select started_by as by, started_at as at, total, subject not like '[TEST]%' as live from org_guide_sends
        where org = $1 and kind = $2 order by started_at desc, id desc limit 1`,
      [p.org, kind],
    )
  ).rows[0];
  return { ok: true, live, to: p.me, cc: p.cc, bcc: p.bcc, about: p.about, ccLabel: p.ccLabel, bccLabel: p.bccLabel, subject: p.subject, html: p.html, last: last ?? null };
}

// Send it. Live: To the sender, Cc the organizations' staff (first email), Bcc the team staff in groups. Test mode: one
// email to the sender only, listing every address it would have gone to. Recorded with each address.
export async function sendSeasonGuide(
  deps: Deps & { sendMail: (m: GuideMail) => Promise<void> },
  viewer: SessionUser,
  org: unknown,
  base: string,
  live: boolean,
  kind: GuideKind = "season",
): Promise<Result<{ live: boolean; to: string; cc: number; bcc: number; emails: number }>> {
  const p = await prepare(deps, viewer, org, base, kind);
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
      "TEST MODE: nothing went to anyone else. On the live site this email goes:",
      ...list("To", [p.me]),
      ...(kind === "season" ? list(p.ccLabel, p.cc) : []),
      ...list(p.bccLabel, p.bcc),
      "",
      "────────────────────────",
      "",
    ];
    const htmlHead =
      `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:14px;background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:12px;margin-bottom:16px">` +
      `<strong>TEST MODE: nothing went to anyone else.</strong> On the live site this email goes:<br><br>` +
      `<strong>To (1):</strong> ${esc(p.me)}<br><br>` +
      (kind === "season" ? `<strong>${esc(p.ccLabel)} (${p.cc.length}):</strong><br>${p.cc.map(esc).join("<br>") || "(none)"}<br><br>` : "") +
      `<strong>${esc(p.bccLabel)} (${p.bcc.length}):</strong><br>${p.bcc.map(esc).join("<br>")}</div>`;
    await deps.sendMail({ to: p.me, subject: `[TEST] ${p.subject}`, text: head.join("\n") + p.text, html: htmlHead + p.html });
    emails = 1;
  }
  await withTx(deps.pool, async (q) => {
    const id = (
      await q.query<{ id: string }>(
        "insert into org_guide_sends (org, subject, total, started_by, started_at, kind) values ($1, $2, $3, $4, $5, $6) returning id::text",
        [p.org, live ? p.subject : `[TEST] ${p.subject}`, p.cc.length + p.bcc.length, by(viewer), deps.now(), kind],
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

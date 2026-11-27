// Standard emails (SPEC.md section 13): an organization that runs Leagues and events (CourtEvents) emails
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
import { closesOn } from "./schedule-request-blocks";
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

// The guide's parts: a title (bold) and its lines ("• " starts a bulleted line, "☐ " a checklist line). `tone`: a tinted box
// (dates, policies, the checklist); `banner`: the colored title at the top; `buttons`: big tappable links. Turned into plain
// text and an email-safe formatted version (inline styles only; everything escaped).
type Tone = "blue" | "red" | "amber" | "green";
type Part = { title?: string; lines: string[]; tone?: Tone; banner?: boolean; buttons?: { label: string; url: string }[] };
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const link = (s: string) => esc(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#1d4ed8">$1</a>');
const NAVY = "#14213d";
const TONES: Record<Tone, [string, string]> = {
  blue: ["#eff6ff", "#2563eb"],
  red: ["#fef2f2", "#dc2626"],
  amber: ["#fffbeb", "#d97706"],
  green: ["#f0fdf4", "#16a34a"],
};
function lineHtml(lines: string[]): string {
  let out = "";
  let list: string[] = [];
  const flush = () => {
    if (list.length) out += `<ul style="margin:4px 0 10px;padding-left:20px">${list.map((x) => `<li style="margin:2px 0">${x}</li>`).join("")}</ul>`;
    list = [];
  };
  for (const l of lines) {
    if (l.startsWith("• ")) list.push(link(l.slice(2)));
    else {
      flush();
      out += l.startsWith("☐ ")
        ? `<p style="margin:4px 0">&#9744;&nbsp; ${link(l.slice(2))}</p>`
        : `<p style="margin:0 0 8px">${link(l)}</p>`;
    }
  }
  flush();
  return out;
}
function render(parts: Part[]): { text: string; html: string } {
  const text = parts
    .map((p) =>
      [
        ...(p.title ? [p.title.toUpperCase()] : []),
        ...p.lines,
        ...(p.buttons ?? []).map((b) => `${b.label}: ${b.url}`),
      ].join("\n"),
    )
    .join("\n\n");
  const banner = (p: Part) =>
    `<div style="background:${NAVY};color:#ffffff;padding:22px 24px;border-radius:12px 12px 0 0">${p.lines
      .map((l, i) => `<div style="${i === 0 ? "font-size:13px;letter-spacing:1px;text-transform:uppercase;opacity:.8" : "font-size:24px;font-weight:700;margin-top:4px"}">${esc(l)}</div>`)
      .join("")}</div>`;
  const block = (p: Part) => {
    const title = p.title ? `<div style="font-size:17px;font-weight:700;margin:0 0 8px;color:${p.tone ? TONES[p.tone][1] : NAVY}">${esc(p.title)}</div>` : "";
    const buttons = p.buttons?.length
      ? `<div style="margin:4px 0 6px">${p.buttons
          .map(
            (b) =>
              `<a href="${esc(b.url)}" style="display:inline-block;background:${NAVY};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 16px;border-radius:8px;margin:0 6px 8px 0">${esc(b.label)}</a>`,
          )
          .join("")}</div>`
      : "";
    const inner = title + lineHtml(p.lines) + buttons;
    return p.tone
      ? `<div style="background:${TONES[p.tone][0]};border-left:4px solid ${TONES[p.tone][1]};border-radius:8px;padding:14px 16px;margin:0 0 18px">${inner}</div>`
      : `<div style="margin:0 0 18px">${inner}</div>`;
  };
  const html =
    `<div style="background:#f4f4f5;padding:16px 8px"><div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;line-height:1.5;color:#18181b;max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px">` +
    parts.filter((p) => p.banner).map(banner).join("") +
    `<div style="padding:20px 24px 8px">${parts.filter((p) => !p.banner).map(block).join("")}</div>` +
    `</div></div>`;
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

// Game Days by month: "December 5, 12, 19".
const byMonth = (days: string[]) => {
  const m = new Map<string, number[]>();
  for (const d of days) {
    const month = new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
    m.set(month, [...(m.get(month) ?? []), Number(d.slice(8))]);
  }
  return [...m].map(([month, ns]) => `${month} ${ns.join(", ")}`);
};
const LONG = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });

// The Season Guide (Earl's layout, Nov 27): a banner, why CourtCaptain, the login buttons, the checklist before the 1st game,
// each current League's dates and deadlines, then each part of CourtCaptain and how to use it, with the League's policies
// in boxes. Dates, request deadlines and time blocks come from the League's own settings.
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
  const max = set?.max ?? 2;
  const first = leagues.find((l) => l.days.length);
  // "the Sunday before each Game Day (6 days ahead)": the weekday its first close falls on.
  const compWeekday = first
    ? new Date(`${closesOn("COMP", first.days[0], first.days[0], set ?? {})}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })
    : null;
  const compWhen =
    set?.compDays == null
      ? "the Sunday night before each Game Day"
      : `${compWeekday ? `the ${compWeekday} before each Game Day, ` : ""}${set.compDays} day${set.compDays === 1 ? "" : "s"} ahead`;
  const recClose = first ? LONG(closesOn("REC", first.days[0], first.days[0], set ?? {})) : null;
  const compFirst = first ? LONG(closesOn("COMP", first.days[0], first.days[0], set ?? {})) : null;
  const families = `${site}/login/${org}`;
  let n = 0;
  const step = (title: string, ...lines: string[]): Part => ({ title: `${++n}. ${title}`, lines });
  const parts: Part[] = [
    { banner: true, lines: [name, `${season} Season Guide`] },
    { lines: ["Hi Coaches and Team Staff,", `Welcome to the ${name} ${season} season!`] },
    {
      tone: "blue",
      title: "WE ARE USING COURTCAPTAIN THIS SEASON!",
      lines: [
        `CourtCaptain is your central location for managing your team's participation in ${name}.`,
        "Your schedule, game times, gym locations, schedule requests, team staff, player rosters, registrations and payments are all available in CourtCaptain.",
        "Please log in and complete your team information before your first game. Keep this email as a reference guide throughout the season.",
      ],
    },
    {
      title: "Log in: pick your organization",
      lines: ["Your cell phone number is your login."],
      buttons: logins.map((o) => ({ label: o.name, url: `${site}/login/${o.slug}` })),
    },
    {
      tone: "green",
      title: "Before your first game",
      lines: [
        "☐ Log in and add CourtCaptain to your phone's home screen",
        "☐ Check your team registration and Game Days",
        "☐ Complete your roster: every player's name, uniform number, birthdate and grade",
        "☐ Add your Assistant Coach and team staff",
        "☐ Send your schedule requests before the deadline",
        "☐ Pay any outstanding invoices",
        "☐ Arrange your Game Day table worker",
        "☐ Share the families' link with your parents",
      ],
    },
    ...leagues.map(
      (l): Part => ({
        tone: "red",
        title: `Important dates: ${l.name}`,
        lines: [
          "Regular Season Game Days",
          ...(l.days.length ? byMonth(l.days).map((x) => `• ${x}`) : ["• To be announced"]),
          ...(l.brackets.length ? ["Postseason Brackets", ...byMonth(l.brackets).map((x) => `• ${x}`)] : []),
          "Deadlines",
          ...(l.days.length
            ? [
                `• Recreational (REC) schedule requests: ${LONG(closesOn("REC", l.days[0], l.days[0], set ?? {}))}`,
                `• Competitive (COMP) schedule requests: ${compWhen} (first: ${LONG(closesOn("COMP", l.days[0], l.days[0], set ?? {}))})`,
              ]
            : []),
          "• Roster lock: immediately following your team's first game",
        ],
      }),
    ),
    step(
      "Logging into CourtCaptain",
      "Your cell phone number is your login. Use your organization's button above.",
      "First-time users",
      "• Enter the cell phone number you gave your Organization Director.",
      "• Enter your email address if asked, then tap Email me a code.",
      "• Enter the six-digit code sent to your email.",
      "• Create your four-digit PIN.",
      "Returning users: enter your cell phone number and four-digit PIN. You might be asked once to verify your email address.",
      "Need help?",
      "• Forgot your PIN? Tap Forgot PIN and follow the steps.",
      "• No code? Check your Spam or Junk folder.",
      "• It says Not set up yet? Ask your Organization Director to check your cell phone number.",
    ),
    step(
      "Add CourtCaptain to your phone",
      "Open your organization's login page on your phone, then:",
      "• iPhone (Safari): tap the Share button, then Add to Home Screen, then Add.",
      "• Android (Chrome): tap the three-dot menu, then Add to Home screen (or Install app), then Add.",
      "CourtCaptain now sits with your other apps.",
    ),
    step(
      "Your team dashboard",
      "Once you log in, your Home is your team dashboard:",
      "• Current registrations: your Game Days, one or two-game guarantee (1GG or 2GG), the postseason brackets and payment status",
      "• Next 10 days, Staff, Roster and Games",
      "Coach more than one team, or in more than one organization? Switch between them at the top of the screen.",
      "A flashing red card needs your attention.",
    ),
    step(
      "Player rosters",
      "Every player needs: Player Name, Uniform Number, Date of Birth and Grade.",
      "Head and Assistant Coaches: open Roster and tap + Add player. No + Add player? Your Organization Director manages your roster.",
      "Your dashboard warns you while any player information is missing.",
    ),
    {
      tone: "amber",
      title: "ROSTER LOCK POLICY",
      lines: [
        `${season} rosters lock immediately following your team's first game and stay locked through the regular season and postseason.`,
        "It is your responsibility to have every player listed, with all required information, before your first game.",
      ],
    },
    step(
      "Team staff and coach check-in",
      "Open Staff and tap + Add staff for your Assistant Coach, Team Manager or Team Parent: name, cell phone number and email address.",
      "No + Add staff? Contact your Organization Director.",
      "Each team gets free admission for two coaches. Coaches must be on the coach check-in list to get in free; coaches not listed pay admission.",
      "Pick up your coach armband at check-in.",
    ),
    step(
      "Schedule requests",
      `Go to Current Registrations and tap Schedule Requests. For each Game Day, pick up to ${max} time block${max === 1 ? "" : "s"} when your team can't play:`,
      ...(set ? set.blocks.map((b) => `• ${b.label}`) : []),
      "Can't play at all that day? Pick Sit Out.",
      ...(recClose ? [`Recreational teams: all season requests are due ${recClose}.`] : []),
      ...(compFirst ? [`Competitive teams: requests are due ${compWhen}. The first deadline is ${compFirst}.`] : []),
    ),
    {
      tone: "amber",
      title: "SCHEDULE REQUEST POLICY",
      lines: [
        "• Schedule requests are not guaranteed.",
        "• No requests are accepted after the deadline.",
        "• If your request can't be met, your team won't be scheduled that Game Day.",
        "• No schedule changes are made after the schedule is published: play as scheduled or sit out.",
        "• Sending schedule requests before the deadline is the coach's responsibility.",
      ],
    },
    step(
      "Adding Game Days or a second game",
      "Competitive teams can add Game Days or a second game. On your team dashboard tap + Add dates or + Add a 2nd Game, pick your dates and pay.",
      "They're added to your registration once paid.",
    ),
    step(
      "Your game schedule",
      "Once the schedule is published, your games show under Next 10 days and Games: date, time, gym and opponent.",
      "Please check your schedule before every Game Day.",
    ),
    {
      tone: "amber",
      title: "GAME DAY TABLE RESPONSIBILITIES",
      lines: ["Each team provides one table worker:", "• Home team: scorebook", "• Visiting team: scoreboard and clock", "Please arrange your table worker before you arrive."],
    },
    step(
      "Invoices and payments",
      "Outstanding invoices and your cart show on your Home. Tap View invoice to see the charges, or Pay by card.",
      "Pay with a credit or debit card, Apple Pay or Google Pay.",
    ),
    ...(chat ? [step(`Talk with ${name}'s Directors`, `Tap 💬 at the top of your screen to message ${name}'s Directors: league questions, registration help and team concerns.`)] : []),
    {
      title: `${++n}. Share CourtCaptain with your parents`,
      lines: [
        "Please share this link with all your team's families. They don't need an account or to log in to see teams and schedules.",
        "They tap the ☆ beside your team to follow it all season.",
        families,
      ],
      buttons: [{ label: `Follow ${name} teams and schedules`, url: families }],
    },
    {
      lines: [
        `Thank you for playing in ${name}. We appreciate the time and effort you give your players and look forward to a great season!`,
      ],
    },
    {
      title: "Questions or help?",
      lines: [`${sender.firstName} ${sender.lastName}, ${name}`, ...(sender.email ? [sender.email] : [])],
    },
    { tone: "blue", title: "HAVE A GREAT SEASON!", lines: [name] },
  ];
  return { subject: `${name}: ${season} Season Guide (we are using CourtCaptain)`, ...render(parts) };
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

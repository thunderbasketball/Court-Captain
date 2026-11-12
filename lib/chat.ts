// Chat (SPEC.md section 11), by the organization's features: CourtPlayers has every chat below; CourtTeams has the
// Directors chat and private chats (Directors); other organizations have none (Support chat is apart, lib/support.ts). Conversations are fixed keys
// whose members follow the current roles in that organization:
//   directors        Directors
//   everyone         Directors + all coaches
//   coaches          coaches (Directors can read and post, but aren't counted as members: no unread, no email)
//   team-<id>        that team's staff (Directors can read and post, hidden: not members, no unread, no email)
//   teamcoaches-<id> that team's Head and Assistant Coaches + Directors
//   parents-<id>     that team's staff + its players' parents with a login (cell is parent 1 or 2 on the registration;
//                    Thunder only). Directors can read and post, but aren't counted as members.
//   coach-<id>       one coach + the Directors
//   event-<id>       the event's check-in people + Directors (started from the event; Thunder only)
// Started by one person; Directors can still open them, but only members get unread counts and emails:
//   dm-<a>-<b>       two people (lower id first), one of them a Director
//   staff-<by>-<id>  Director <by> + that team's whole staff
//   heads-<by>       Director <by> + every Head Coach
// CourtTeams (an organization's team programs: Leagues, Circuits, Tournaments):
//   program-<id>     the organization's Directors + the coaches of the teams registered in that program
//   (and coach-<id> / dm with a registered team's coach: they count as the organization's coaches while its program runs)
// CourtSync (stored under the Scheduler's organization, whatever its other chats):
//   host-<slug>      Scheduler ↔ Host: the Scheduler's Admins and Directors of Scheduling or Facilities + the host
//                    organization's Admins and Directors of Facilities, while the hosting is approved and both have CourtSync
// A "coach" has the Coach role or is a Head or Assistant Coach on a team. Directors can open every chat.
// Thunder's keys are as above ("coaches"); another organization's carry its slug: "east-ridge~coaches" (its teams are
// org_teams, their coaches org_team_coaches). A person's chat list and unread count cover every organization.
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { orgFeatures } from "./features";
import { withTx } from "./sql";
import { TZ } from "./time";

type Q = Pick<Pool, "query">;
type Deps = { pool: Pool; now: () => Date };
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

export const EMAIL_AFTER_HOURS = 8;
const HOUR = 3_600_000;
const MAX_BODY = 2000;
const THUNDER = "thunder";
const SLUG = /^[a-z0-9-]{1,80}$/;

// The tables behind one organization's chats. The slug only ever comes from SLUG-checked text (no quotes possible).
type Scope = { org: string; staff: string; teams: string };
function scopeOf(org: string): Scope {
  if (!SLUG.test(org)) throw new Error("Bad organization");
  return org === THUNDER
    ? { org, staff: "team_staff", teams: "teams" }
    : {
        org,
        staff: `(select c.team_id, c.coach_id, c.role from org_team_coaches c join org_teams ot on ot.id = c.team_id where ot.org = '${org}')`,
        teams: `(select id, name, grade as grade_sort, level, gender from org_teams where org = '${org}')`,
      };
}
const role = (S: Scope, col: string, r: "Director" | "Coach") => `has_role(${col}, '${S.org}', '${r}')`;

type Ctx = {
  org: string;
  coachId: string;
  director: boolean;
  coach: boolean;
  teams: { id: string; name: string; coach: boolean; head: boolean }[];
  events: string[];
  parentOf: string[]; // Thunder teams with this person's children on the roster
  programs: string[]; // this organization's running team programs where this person coaches a registered team
  syncer: boolean; // CourtSync Scheduler side: an Admin or Director of Scheduling or Facilities here
  hostFor: string[]; // approved hosts of this organization where this person is an Admin or Director of Facilities
};

// An Admin, or a Director with one of these areas, in an organization (roles only; CourtCaptain staff aren't counted).
const areaSql = (who: string, org: string, areas: string) =>
  `(has_role(${who}, ${org}, 'Admin') or (has_role(${who}, ${org}, 'Director') and exists (
     select 1 from director_areas a where a.coach_id = ${who} and a.org = ${org} and a.area = any(${areas}))))`;
const SCHEDULER_AREAS = "array['scheduling', 'facilities']";
// A coach of a team registered in one of the organization's running team programs (until the program ends; removed
// registrations don't count): the team's listed coach, or a Head or Assistant Coach of the club team it comes from.
const COACHES_TEAM_SQL = (who: string) =>
  `(t.coach_id = ${who}
    or exists (select 1 from org_team_coaches c where c.team_id = t.org_team_id and c.coach_id = ${who} and c.role in ('HeadCoach', 'AsstCoach'))
    or exists (select 1 from team_staff s where s.team_id = t.thunder_team_id and s.coach_id = ${who} and s.role in ('HeadCoach', 'AsstCoach')))`;
const REGISTERED_SQL = (who: string, org: string, program = "") =>
  `select p.id from scenic_registrations r join scenic_teams t on t.id = r.team_id join scenic_programs p on p.id = r.program_id
    where r.removed_by is null and p.org = ${org} and p.ends_on >= current_date and ${COACHES_TEAM_SQL(who)}${program ? ` and p.id = ${program}` : ""}`;
const HOST_AREAS = "array['facilities']";

// Roles in one organization, fresh from the database (for the viewer, or anyone when working out who gets an email).
async function contextFor(q: Q, coachId: string, org: string = THUNDER): Promise<Ctx | null> {
  const S = scopeOf(org);
  const u = await q.query<{ director: boolean; coach: boolean }>(
    `select ${role(S, "coach_id", "Director")} as director, ${role(S, "coach_id", "Coach")} as coach from users where coach_id = $1 and active`,
    [coachId],
  );
  if (!u.rows[0]) return null;
  const t = await q.query<{ id: string; name: string; coach: boolean; head: boolean }>(
    `select t.id::text, t.name, bool_or(s.role in ('HeadCoach', 'AsstCoach')) as coach, bool_or(s.role = 'HeadCoach') as head
     from ${S.staff} s join ${S.teams} t on t.id = s.team_id where s.coach_id = $1
     group by t.id, t.name, t.grade_sort order by t.grade_sort, lower(t.name)`,
    [coachId],
  );
  const e =
    org === THUNDER
      ? await q.query<{ id: string }>("select event_id::text as id from event_staff where coach_id = $1", [coachId])
      : { rows: [] };
  const kids =
    org === THUNDER
      ? await q.query<{ id: string }>(
          `select distinct p.team_id::text as id from team_players p join registrations g on g.registrant_id = p.registrant_id
             join users u on u.coach_id = $1 where u.cell in (g.parent1_cell, g.parent2_cell)`,
          [coachId],
        )
      : { rows: [] };
  // CourtSync: this organization's approved hosts, and which side of each chat this person is on.
  const sync = await q.query<{ host: string; syncer: boolean; host_ok: boolean }>(
    `select p.host_org as host, ${areaSql("$1", "$2", SCHEDULER_AREAS)} as syncer, ${areaSql("$1", "p.host_org", HOST_AREAS)} as host_ok
       from org_partnerships p where p.for_org = $2 and p.status = 'approved'`,
    [coachId, org],
  );
  const reg = await q.query<{ id: string }>(`select distinct x.id::text from (${REGISTERED_SQL("$1", "$2")}) x`, [coachId, org]);
  return {
    org,
    coachId,
    programs: reg.rows.map((x) => x.id),
    syncer: sync.rows.some((x) => x.syncer),
    hostFor: sync.rows.filter((x) => x.host_ok).map((x) => x.host),
    director: u.rows[0].director,
    coach: u.rows[0].coach || t.rows.some((x) => x.coach) || reg.rows.length > 0,
    teams: t.rows,
    events: e.rows.map((x) => x.id),
    parentOf: kids.rows.map((x) => x.id),
  };
}

type Key =
  | { kind: "directors" | "everyone" | "coaches" }
  | { kind: "team" | "teamcoaches" | "event" | "parents"; id: string }
  | { kind: "coach"; id: string }
  | { kind: "dm"; a: string; b: string }
  | { kind: "staff"; by: string; id: string }
  | { kind: "heads"; by: string }
  | { kind: "host"; host: string }
  | { kind: "program"; id: string };

// The private chat between two people (the same key whoever opens it); `org` for another organization's.
export const dmKey = (x: string, y: string, org: string = THUNDER) => orgKey(org, x < y ? `dm-${x}-${y}` : `dm-${y}-${x}`);

// A chat key in an organization: Thunder's as is, another's with its slug ("east-ridge~coaches").
export const orgKey = (org: string, key: string) => (org === THUNDER ? key : `${org}~${key}`);

// The organization a chat key belongs to (for the Chat feature check), or null when it isn't a chat key.
export function chatOrg(key: unknown): string | null {
  return parseFull(key)?.org ?? null;
}

export function parseKey(key: unknown): Key | null {
  if (typeof key !== "string") return null;
  if (key === "directors" || key === "everyone" || key === "coaches") return { kind: key };
  const m = key.match(/^(team|teamcoaches|event|parents)-(\d{1,18})$/);
  if (m) return { kind: m[1] as "team" | "teamcoaches" | "event" | "parents", id: m[2] };
  const c = key.match(/^coach-(\d{7})$/);
  if (c) return { kind: "coach", id: c[1] };
  const d = key.match(/^dm-(\d{7})-(\d{7})$/);
  if (d) return d[1] < d[2] ? { kind: "dm", a: d[1], b: d[2] } : null;
  const s = key.match(/^staff-(\d{7})-(\d{1,18})$/);
  if (s) return { kind: "staff", by: s[1], id: s[2] };
  const h = key.match(/^heads-(\d{7})$/);
  if (h) return { kind: "heads", by: h[1] };
  const pr = key.match(/^program-(\d{1,18})$/);
  if (pr) return { kind: "program", id: pr[1] };
  const ho = key.match(/^host-([a-z0-9-]{1,80})$/);
  return ho ? { kind: "host", host: ho[1] } : null;
}

// A full key: the organization and the chat. Events are Thunder's only.
function parseFull(key: unknown): { org: string; k: Key } | null {
  if (typeof key !== "string") return null;
  const i = key.indexOf("~");
  const org = i < 0 ? THUNDER : key.slice(0, i);
  if (!SLUG.test(org) || (i >= 0 && org === THUNDER)) return null;
  const k = parseKey(i < 0 ? key : key.slice(i + 1));
  if (!k || ((k.kind === "event" || k.kind === "parents") && org !== THUNDER)) return null;
  if (k.kind === "host" && k.host === org) return null;
  return { org, k };
}

// Which chats an organization has (its features): all (CourtPlayers), Directors' (CourtTeams: the Directors chat, its
// programs' coaches chats, a Director's chat with one registered coach, and private chats), or none.
export type ChatLevel = "all" | "directors" | "none";
export async function chatLevel(q: Q, org: string): Promise<ChatLevel> {
  if (!SLUG.test(org)) return "none";
  const has = await orgFeatures(q, org);
  return has.has("team-chat") ? "all" : has.has("chat") ? "directors" : "none";
}
const TEAMS_KINDS = new Set<Key["kind"]>(["directors", "dm", "program", "coach"]);
const kindOn = (level: ChatLevel, k: Key) => level === "all" || (level === "directors" && TEAMS_KINDS.has(k.kind));

// A Scheduler ↔ Host chat is on while the hosting is approved and both still have CourtSync (their side of it).
async function hostChatOn(q: Q, org: string, host: string): Promise<boolean> {
  const p = await q.query("select 1 from org_partnerships where for_org = $1 and host_org = $2 and status = 'approved'", [org, host]);
  if (!p.rowCount) return false;
  const [mine, theirs] = await Promise.all([orgFeatures(q, org), orgFeatures(q, host)]);
  return mine.has("hosting-partners") && theirs.has("hosting-available");
}

// Is this chat on in its organization (its features)?
async function chatOn(q: Q, org: string, k: Key, level?: ChatLevel): Promise<boolean> {
  return k.kind === "host" ? hostChatOn(q, org, k.host) : kindOn(level ?? (await chatLevel(q, org)), k);
}

// member: in the chat (unread counts, emails). seen: can read and post (members, plus Directors everywhere).
function access(ctx: Ctx, key: Key): { member: boolean; seen: boolean } {
  const member = (() => {
    switch (key.kind) {
      case "directors":
        return ctx.director;
      case "everyone":
        return ctx.director || ctx.coach;
      case "coaches":
        return ctx.coach;
      case "team": // Directors not on the team can open it, hidden (not listed or counted, no unread or email)
        return ctx.teams.some((t) => t.id === key.id);
      case "teamcoaches":
        return ctx.director || ctx.teams.some((t) => t.id === key.id && t.coach);
      case "parents":
        return ctx.teams.some((t) => t.id === key.id) || ctx.parentOf.includes(key.id);
      case "coach":
        return ctx.director || (ctx.coach && key.id === ctx.coachId);
      case "event":
        return ctx.director || ctx.events.includes(key.id);
      case "dm":
        return key.a === ctx.coachId || key.b === ctx.coachId;
      case "staff":
        return key.by === ctx.coachId || ctx.teams.some((t) => t.id === key.id);
      case "heads":
        return key.by === ctx.coachId || ctx.teams.some((t) => t.head);
      case "host":
        return ctx.syncer || ctx.hostFor.includes(key.host);
      case "program":
        return ctx.director || ctx.programs.includes(key.id);
    }
  })();
  return { member, seen: member || ctx.director };
}

function keyText(k: Key): string {
  switch (k.kind) {
    case "dm":
      return `dm-${k.a}-${k.b}`;
    case "staff":
      return `staff-${k.by}-${k.id}`;
    case "heads":
      return `heads-${k.by}`;
    case "host":
      return `host-${k.host}`;
    case "program":
      return `program-${k.id}`;
    default:
      return "id" in k ? `${k.kind}-${k.id}` : k.kind;
  }
}

const nameOf = async (q: Q, coachId: string) =>
  (await q.query<{ name: string }>("select first_name || ' ' || last_name as name from users where coach_id = $1", [coachId])).rows[0]
    ?.name ?? null;

// The chat's name as this person sees it, or null when the team or coach no longer exists.
async function titleOf(q: Q, ctx: Ctx, k: Key): Promise<string | null> {
  const S = scopeOf(ctx.org);
  switch (k.kind) {
    case "directors":
      return "Directors";
    case "everyone":
      return "Directors & all coaches";
    case "coaches":
      return "Coaches";
    case "team":
    case "teamcoaches":
    case "parents": {
      const t = await q.query<{ name: string }>(`select name from ${S.teams} t where t.id = $1`, [k.id]);
      return t.rows[0] ? `${t.rows[0].name} · ${k.kind === "team" ? "Team" : k.kind === "parents" ? "Parents" : "Coaches"}` : null;
    }
    case "event": {
      const e = await q.query<{ name: string }>("select name from events where id = $1", [k.id]);
      return e.rows[0] ? `${e.rows[0].name} · Event` : null;
    }
    case "coach": {
      if (!ctx.director) return "Directors";
      const u = await q.query<{ name: string }>("select first_name || ' ' || last_name as name from users where coach_id = $1", [k.id]);
      return u.rows[0] ? `${u.rows[0].name} · Directors` : null;
    }
    case "dm": {
      const [a, b] = await Promise.all([nameOf(q, k.a), nameOf(q, k.b)]);
      if (!a || !b) return null;
      if (k.a === ctx.coachId) return b;
      if (k.b === ctx.coachId) return a;
      return `${a} & ${b}`;
    }
    case "staff": {
      const t = await q.query<{ name: string }>(`select name from ${S.teams} t where t.id = $1`, [k.id]);
      const by = await nameOf(q, k.by);
      if (!t.rows[0] || !by) return null;
      return k.by === ctx.coachId ? `${t.rows[0].name} · Staff` : `${t.rows[0].name} · Staff + ${by}`;
    }
    case "heads": {
      const by = await nameOf(q, k.by);
      if (!by) return null;
      return k.by === ctx.coachId ? "All Head Coaches" : `Head Coaches + ${by}`;
    }
    case "program": {
      const p = await q.query<{ name: string }>("select name from scenic_programs where id = $1 and org = $2", [k.id, ctx.org]);
      return p.rows[0] ? `${p.rows[0].name} · Coaches` : null;
    }
    case "host": {
      // Named for the other side: the host for the Scheduler's people, the Scheduler for the host's.
      const other = ctx.hostFor.includes(k.host) && !ctx.syncer ? ctx.org : k.host;
      const o = await q.query<{ name: string }>("select name from organizations where slug = $1", [other]);
      return o.rows[0] ? `${o.rows[0].name} · CourtSync` : null;
    }
  }
}

const isCoachSql = (S: Scope) =>
  `(${role(S, "u.coach_id", "Coach")} or exists (select 1 from ${S.staff} s where s.coach_id = u.coach_id and s.role in ('HeadCoach', 'AsstCoach'))
    or exists (${REGISTERED_SQL("u.coach_id", `'${S.org}'`)}))`;

// Chats started by one person must have been started by a Director (with a real coach, for a private chat).
async function startable(q: Q, k: Key, S: Scope): Promise<boolean> {
  const isDirector = async (id: string) =>
    !!(await q.query(`select 1 from users where coach_id = $1 and active and ${role(S, "coach_id", "Director")}`, [id])).rows[0];
  switch (k.kind) {
    case "dm": {
      const r = await q.query<{ director: boolean }>(
        `select ${role(S, "u.coach_id", "Director")} as director from users u
         where u.coach_id in ($1, $2) and u.active and (${role(S, "u.coach_id", "Director")} or ${isCoachSql(S)})`,
        [k.a, k.b],
      );
      return r.rows.length === 2 && r.rows.some((x) => x.director);
    }
    case "staff":
    case "heads":
      return isDirector(k.by);
    default:
      return true;
  }
}

// ---- Starting a chat ----

export type ChatOption = { key: string; title: string; group: string };

// The chats this person can start in one organization (or open, if they already have messages), then its CourtSync chats.
export async function newChatOptions(deps: Deps, viewer: SessionUser, org: string = THUNDER): Promise<ChatOption[]> {
  if (!SLUG.test(org)) return [];
  return [...(await orgChatOptions(deps, viewer, org)), ...(await syncChatOptions(deps.pool, viewer.coachId, org))];
}

// CourtSync chats from this organization's side: as the Scheduler (each approved host) and as a host (each Scheduler it
// hosts for), where this person handles that side.
async function syncChatOptions(q: Q, coachId: string, org: string): Promise<ChatOption[]> {
  const r = await q.query<{ sched: string; host: string; name: string }>(
    `select p.for_org as sched, p.host_org as host, o.name from org_partnerships p
       join organizations o on o.slug = case when p.for_org = $2 then p.host_org else p.for_org end
      where p.status = 'approved' and (
            (p.for_org = $2 and ${areaSql("$1", "$2", SCHEDULER_AREAS)})
         or (p.host_org = $2 and ${areaSql("$1", "$2", HOST_AREAS)}))
      order by lower(o.name)`,
    [coachId, org],
  );
  const out: ChatOption[] = [];
  for (const x of r.rows)
    if (await hostChatOn(q, x.sched, x.host))
      out.push({ key: orgKey(x.sched, `host-${x.host}`), title: `${x.name} · CourtSync`, group: "CourtSync" });
  return out;
}

async function orgChatOptions(deps: Deps, viewer: SessionUser, org: string): Promise<ChatOption[]> {
  const S = scopeOf(org);
  const level = await chatLevel(deps.pool, org);
  const ctx = level === "none" ? null : await contextFor(deps.pool, viewer.coachId, org);
  if (!ctx) return [];
  const key = (k: string) => orgKey(org, k);
  const out: ChatOption[] = [];
  if (level === "directors") {
    // CourtTeams: the Directors chat, each running program's coaches, and one registered coach; a coach: theirs.
    const progs = await deps.pool.query<{ id: string; name: string }>(
      `select id::text, name from scenic_programs where org = $1 and ends_on >= current_date
        ${ctx.director ? "" : "and id = any($2::bigint[])"} order by starts_on, lower(name)`,
      ctx.director ? [org] : [org, ctx.programs],
    );
    const programs = progs.rows.map((p) => ({ key: key(`program-${p.id}`), title: `${p.name} · Coaches`, group: "Groups" }));
    if (!ctx.director) return ctx.coach ? [{ key: key(`coach-${ctx.coachId}`), title: "Directors", group: "Groups" }, ...programs] : [];
    const coaches = await deps.pool.query<{ id: string; name: string }>(
      `select u.coach_id as id, u.first_name || ' ' || u.last_name as name from users u
        where u.active and u.coach_id <> $1 and exists (${REGISTERED_SQL("u.coach_id", "$2")})
        order by lower(u.last_name), lower(u.first_name)`,
      [ctx.coachId, org],
    );
    return [
      { key: key("directors"), title: "Directors", group: "Groups" },
      ...programs,
      ...coaches.rows.map((c) => ({ key: key(`coach-${c.id}`), title: c.name, group: "A single coach" })),
    ];
  }
  if (ctx.director) {
    out.push({ key: key("directors"), title: "Directors", group: "Groups" });
    out.push({ key: key("everyone"), title: "Directors & all coaches", group: "Groups" });
    out.push({ key: key("coaches"), title: "Coaches (coaches' own chat)", group: "Groups" });
    out.push({ key: key(`heads-${ctx.coachId}`), title: "All Head Coaches (you + them)", group: "Groups" });
    const coaches = await deps.pool.query<{ id: string; name: string }>(
      `select u.coach_id as id, u.first_name || ' ' || u.last_name as name from users u
       where u.active and u.coach_id <> $1 and ${isCoachSql(S)}
       order by lower(u.last_name), lower(u.first_name)`,
      [ctx.coachId],
    );
    out.push(...coaches.rows.map((c) => ({ key: key(`coach-${c.id}`), title: c.name, group: "A single coach" })));
    const teams = await deps.pool.query<{ id: string; name: string }>(
      `select t.id::text, t.name from ${S.teams} t order by t.level = 'COMP' desc, t.gender, t.grade_sort, lower(t.name)`,
    );
    out.push(...teams.rows.map((t) => ({ key: key(`teamcoaches-${t.id}`), title: `${t.name} coaches`, group: "One team's coaches" })));
    out.push(...teams.rows.map((t) => ({ key: key(`team-${t.id}`), title: `${t.name} team chat`, group: "Team chats" })));
    return out;
  }
  if (ctx.coach) {
    out.push({ key: key(`coach-${ctx.coachId}`), title: "Directors", group: "Groups" });
    out.push({ key: key("everyone"), title: "Directors & all coaches", group: "Groups" });
    out.push({ key: key("coaches"), title: "Coaches", group: "Groups" });
  }
  out.push(...ctx.teams.map((t) => ({ key: key(`team-${t.id}`), title: `${t.name} team chat`, group: "Team chats" })));
  out.push(
    ...ctx.teams
      .filter((t) => t.coach)
      .map((t) => ({ key: key(`teamcoaches-${t.id}`), title: `${t.name} coaches + Directors`, group: "Team chats" })),
  );
  return out;
}

// ---- The chat list ----

export type ChatSummary = { key: string; title: string; last: { body: string; sender: string; at: Date } | null; unread: number };

// Every chat with messages that its organization's features still have (chatLevel).
async function allConvs(q: Q): Promise<{ conv: string; org: string }[]> {
  const r = await q.query<{ conv: string; org: string }>("select distinct conv, org from chat_messages");
  const level = new Map<string, ChatLevel>();
  const out: { conv: string; org: string }[] = [];
  for (const x of r.rows) {
    if (!level.has(x.org)) level.set(x.org, await chatLevel(q, x.org));
    const f = parseFull(x.conv);
    if (f && (await chatOn(q, x.org, f.k, level.get(x.org)))) out.push(x);
  }
  return out;
}

// The viewer's roles in each organization, looked up once.
function contexts(q: Q, coachId: string) {
  const seen = new Map<string, Promise<Ctx | null>>();
  return (org: string) => {
    if (!seen.has(org)) seen.set(org, contextFor(q, coachId, org));
    return seen.get(org)!;
  };
}

// The short name shown after another organization's chats ("Coaches · East Ridge").
async function orgShorts(q: Q): Promise<Map<string, string>> {
  const r = await q.query<{ slug: string; short: string }>("select slug, coalesce(short_name, name) as short from organizations");
  return new Map(r.rows.map((x) => [x.slug, x.short]));
}

// Chats with messages the viewer can see, in every organization, newest activity first.
export async function listChats(deps: Deps, viewer: SessionUser): Promise<ChatSummary[]> {
  const ctxOf = contexts(deps.pool, viewer.coachId);
  const visible: { key: string; org: string; k: Key; member: boolean }[] = [];
  for (const { conv, org } of await allConvs(deps.pool)) {
    const f = parseFull(conv);
    const ctx = f && f.org === org ? await ctxOf(org) : null;
    if (!f || !ctx) continue;
    const a = access(ctx, f.k);
    if (a.seen) visible.push({ key: conv, org, k: f.k, member: a.member });
  }
  if (!visible.length) return [];
  const r = await deps.pool.query<{ conv: string; body: string; sender: string; at: Date; unread: number }>(
    `select distinct on (m.conv) m.conv, m.body, m.sender_name as sender, m.created_at as at,
            (select count(*)::int from chat_messages x where x.conv = m.conv and x.sender_id <> $2
               and x.created_at > coalesce((select last_read_at from chat_reads r where r.conv = m.conv and r.coach_id = $2), '-infinity')) as unread
     from chat_messages m where m.conv = any($1) order by m.conv, m.id desc`,
    [visible.map((v) => v.key), viewer.coachId],
  );
  const shorts = visible.some((v) => v.org !== THUNDER) ? await orgShorts(deps.pool) : new Map<string, string>();
  const out: ChatSummary[] = [];
  for (const row of r.rows) {
    const v = visible.find((x) => x.key === row.conv)!;
    const title = await titleOf(deps.pool, (await ctxOf(v.org))!, v.k);
    if (!title) continue;
    out.push({
      key: row.conv,
      title: v.org === THUNDER || v.k.kind === "host" ? title : `${title} · ${shorts.get(v.org) ?? v.org}`,
      last: { body: row.body, sender: row.sender, at: row.at },
      unread: v.member ? row.unread : 0,
    });
  }
  return out.sort((a, b) => b.last!.at.getTime() - a.last!.at.getTime());
}

// ---- Chat's setting (the organization gear → Feature Settings → Chat) ----

export type ChatEmailSetting = { on: boolean; hours: number };

export async function chatEmailSetting(q: Q, org: string): Promise<ChatEmailSetting> {
  const r = await q.query<{ on: boolean; hours: number | null }>(
    "select chat_emails_on as on, chat_email_hours as hours from organizations where slug = $1",
    [org],
  );
  return { on: r.rows[0]?.on ?? true, hours: r.rows[0]?.hours ?? EMAIL_AFTER_HOURS };
}

// The organization's Admins: email unseen chat messages after 1–72 hours, or not at all.
export async function setChatEmailSetting(deps: { pool: Q }, viewer: SessionUser, org: string, input: unknown): Promise<Result> {
  const v = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const hours = v.hours;
  if (!Number.isInteger(hours) || (hours as number) < 1 || (hours as number) > 72) return { ok: false, message: "Hours must be 1–72." };
  if (!SLUG.test(org)) return { ok: false, message: "That organization doesn't exist." };
  const admin = await deps.pool.query<{ ok: boolean }>("select acts_as($1, $2, 'Admin') as ok", [viewer.coachId, org]);
  if (!admin.rows[0]?.ok) return { ok: false, message: "Only an Admin of this organization can change its Chat settings." };
  if ((await chatLevel(deps.pool, org)) === "none") return { ok: false, message: "This organization doesn't have Chat." };
  await deps.pool.query("update organizations set chat_emails_on = $2, chat_email_hours = $3 where slug = $1", [org, v.on === true, hours]);
  return { ok: true };
}

// ---- The Chat box (the header's chat icon) ----

export type BoxChat = { key: string; title: string; last: ChatSummary["last"]; unread: number };
export type BoxGroup = { name: string; chats: BoxChat[]; teams?: { name: string; chats: BoxChat[] }[] };

const TEAM_PART: Record<string, string> = { team: "Team chat", teamcoaches: "Coaches", parents: "Parents", staff: "Director + staff" };

// Every chat this person can open, grouped: Groups (the organization-wide ones), Teams (each team's chats together),
// Coaches (a Director's chat with one coach), Direct messages, Events, then chats in their other organizations.
// `org` is the organization in use; its startable chats are listed even before they have messages.
export async function chatBox(deps: Deps, viewer: SessionUser, org: string): Promise<BoxGroup[]> {
  if (!SLUG.test(org)) return [];
  const level = await chatLevel(deps.pool, org);
  const chatHere = level !== "none";
  const [options, chats, ctx] = await Promise.all([
    newChatOptions(deps, viewer, org), // with no chats here, still its CourtSync chats
    listChats(deps, viewer),
    chatHere ? contextFor(deps.pool, viewer.coachId, org) : Promise.resolve(null),
  ]);
  const S = scopeOf(org);
  // Each team's Parents chat (Thunder): its staff and parents, and Directors.
  const teams = (
    await deps.pool.query<{ id: string; name: string }>(
      `select t.id::text, t.name from ${S.teams} t order by t.level = 'COMP' desc, t.gender, t.grade_sort, lower(t.name)`,
    )
  ).rows;
  const keys = new Set(options.map((o) => o.key));
  if (ctx && org === THUNDER && level === "all")
    for (const t of teams)
      if (ctx.director || ctx.teams.some((x) => x.id === t.id) || ctx.parentOf.includes(t.id))
        if (!keys.has(`parents-${t.id}`)) {
          keys.add(`parents-${t.id}`);
          options.push({ key: `parents-${t.id}`, title: `${t.name} · Parents`, group: "Team chats" });
        }

  const summary = new Map(chats.map((c) => [c.key, c]));
  const all: { key: string; title: string }[] = [
    ...options.map((o) => ({ key: o.key, title: summary.get(o.key)?.title ?? o.title })),
    ...chats.filter((c) => !keys.has(c.key)).map((c) => ({ key: c.key, title: c.title })),
  ];
  const shorts = chats.some((c) => chatOrg(c.key) !== org) ? await orgShorts(deps.pool) : new Map<string, string>();
  const order = ["Groups", "Teams", "Coaches", "Direct messages", "Events", "CourtSync"];
  const groups = new Map<string, BoxGroup>();
  const teamChats = new Map<string, BoxChat[]>();
  const add = (name: string, c: BoxChat) => {
    if (!groups.has(name)) groups.set(name, { name, chats: [] });
    groups.get(name)!.chats.push(c);
  };
  for (const { key, title } of all) {
    const f = parseFull(key);
    if (!f) continue;
    const s = summary.get(key);
    const c: BoxChat = { key, title, last: s?.last ?? null, unread: s?.unread ?? 0 };
    if (f.k.kind === "host") {
      add("CourtSync", c);
      continue;
    }
    if (f.org !== org) {
      add(shorts.get(f.org) ?? f.org, c);
      continue;
    }
    const k = f.k;
    if ("id" in k && TEAM_PART[k.kind] && teams.some((t) => t.id === k.id)) {
      c.title = TEAM_PART[k.kind];
      teamChats.set(k.id, [...(teamChats.get(k.id) ?? []), c]);
    } else if (k.kind === "coach" && ctx?.director) add("Coaches", { ...c, title: title.replace(/ · Directors$/, "") });
    else if (k.kind === "dm") add("Direct messages", c);
    else if (k.kind === "event") add("Events", c);
    else add("Groups", c);
  }
  if (teamChats.size) {
    const partOrder = Object.values(TEAM_PART);
    groups.set("Teams", {
      name: "Teams",
      chats: [],
      teams: teams
        .filter((t) => teamChats.has(t.id))
        .map((t) => ({
          name: t.name,
          chats: teamChats.get(t.id)!.sort((a, b) => partOrder.indexOf(a.title) - partOrder.indexOf(b.title)),
        })),
    });
  }
  // Within a group: chats with news first (newest), then the rest as listed.
  const recent = (a: BoxChat, b: BoxChat) => (b.last?.at.getTime() ?? 0) - (a.last?.at.getTime() ?? 0);
  for (const g of groups.values()) if (g.name !== "Groups") g.chats.sort(recent);
  const rank = (n: string) => (order.includes(n) ? order.indexOf(n) : order.length);
  return [...groups.values()].sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
}

// Unread messages across the chats the viewer is a member of, in every organization (the header badge).
export async function chatUnreadCount(deps: Deps, viewer: SessionUser): Promise<number> {
  const ctxOf = contexts(deps.pool, viewer.coachId);
  const keys: string[] = [];
  for (const { conv, org } of await allConvs(deps.pool)) {
    const f = parseFull(conv);
    const ctx = f && f.org === org ? await ctxOf(org) : null;
    if (f && ctx && access(ctx, f.k).member) keys.push(conv);
  }
  if (!keys.length) return 0;
  const r = await deps.pool.query<{ n: number }>(
    `select count(*)::int as n from chat_messages m
     where m.conv = any($1) and m.sender_id <> $2
       and m.created_at > coalesce((select last_read_at from chat_reads r where r.conv = m.conv and r.coach_id = $2), '-infinity')`,
    [keys, viewer.coachId],
  );
  return r.rows[0].n;
}

// ---- One chat ----

export type ChatMessage = { id: string; senderId: string; sender: string; body: string; at: Date };
export type ChatThread = { key: string; title: string; members: string[]; messages: ChatMessage[] };

function membersWhere(k: Key, S: Scope): [string, string[]] {
  const dir = role(S, "u.coach_id", "Director");
  const onTeam = (roles = "") =>
    `exists (select 1 from ${S.staff} s where s.coach_id = u.coach_id and s.team_id = $1${roles ? ` and s.role in (${roles})` : ""})`;
  switch (k.kind) {
    case "directors":
      return [dir, []];
    case "everyone":
      return [`${dir} or ${isCoachSql(S)}`, []];
    case "coaches":
      return [isCoachSql(S), []];
    case "team":
      return [onTeam(), [k.id]];
    case "teamcoaches":
      return [`${dir} or ${onTeam("'HeadCoach', 'AsstCoach'")}`, [k.id]];
    case "parents":
      return [
        `${onTeam()} or exists (select 1 from team_players p join registrations g on g.registrant_id = p.registrant_id
                                where p.team_id = $1 and u.cell in (g.parent1_cell, g.parent2_cell))`,
        [k.id],
      ];
    case "coach":
      return [`${dir} or u.coach_id = $1`, [k.id]];
    case "event":
      return [`${dir} or exists (select 1 from event_staff s where s.coach_id = u.coach_id and s.event_id = $1)`, [k.id]];
    case "dm":
      return ["u.coach_id in ($1, $2)", [k.a, k.b]];
    case "staff":
      return [`u.coach_id = $1 or exists (select 1 from ${S.staff} s where s.coach_id = u.coach_id and s.team_id = $2)`, [k.by, k.id]];
    case "heads":
      return [`u.coach_id = $1 or exists (select 1 from ${S.staff} s where s.coach_id = u.coach_id and s.role = 'HeadCoach')`, [k.by]];
    case "program":
      return [`${dir} or exists (${REGISTERED_SQL("u.coach_id", `'${S.org}'`, "$1")})`, [k.id]];
    case "host":
      return [`${areaSql("u.coach_id", `'${S.org}'`, SCHEDULER_AREAS)} or ${areaSql("u.coach_id", "$1", HOST_AREAS)}`, [k.host]];
  }
}

async function memberNames(q: Q, k: Key, S: Scope): Promise<string[]> {
  const [where, params] = membersWhere(k, S);
  const r = await q.query<{ name: string }>(
    `select u.first_name || ' ' || u.last_name as name from users u where u.active and (${where}) order by lower(u.last_name), lower(u.first_name)`,
    params,
  );
  return r.rows.map((x) => x.name);
}

// Who may open a chat: the key, the viewer's roles in its organization, and (for chats started by one person) that a
// Director started it. Null when they can't.
async function opened(q: Q, viewer: SessionUser, key: unknown, activeOnly = false) {
  const f = parseFull(key);
  if (!f || !(await chatOn(q, f.org, f.k))) return null;
  const S = scopeOf(f.org);
  const ctx = await contextFor(q, viewer.coachId, f.org);
  if (!ctx || !access(ctx, f.k).seen) return null;
  if (f.k.kind === "coach" && ctx.director) {
    const c = await q.query(`select 1 from users u where u.coach_id = $1${activeOnly ? " and u.active" : ""} and ${isCoachSql(S)}`, [
      f.k.id,
    ]);
    if (!c.rows[0]) return null;
  }
  if (!(await startable(q, f.k, S))) return null;
  return { ...f, S, ctx, text: orgKey(f.org, keyText(f.k)) };
}

// Null when the viewer can't see this chat. Newest 200 messages, oldest first.
export async function getChat(deps: Deps, viewer: SessionUser, key: string): Promise<ChatThread | null> {
  const o = await opened(deps.pool, viewer, key);
  if (!o) return null;
  const title = await titleOf(deps.pool, o.ctx, o.k);
  if (!title) return null;
  const m = await deps.pool.query<ChatMessage>(
    `select * from (select id::text, sender_id as "senderId", sender_name as sender, body, created_at as at
                    from chat_messages where conv = $1 order by id desc limit 200) x order by x.id::bigint`,
    [o.text],
  );
  return { key: o.text, title, members: await memberNames(deps.pool, o.k, o.S), messages: m.rows };
}

export async function postMessage(deps: Deps, viewer: SessionUser, key: unknown, bodyInput: unknown): Promise<Result<{ id: string }>> {
  const body = typeof bodyInput === "string" ? bodyInput.replace(/\r\n/g, "\n").trim() : "";
  if (!body) return { ok: false, message: "Type a message." };
  if (body.length > MAX_BODY) return { ok: false, message: `Keep it to ${MAX_BODY.toLocaleString()} characters.` };
  const o = await opened(deps.pool, viewer, key, true);
  if (!o) {
    const f = parseFull(key);
    if (f?.k.kind === "coach") {
      const ctx = await contextFor(deps.pool, viewer.coachId, f.org);
      if (ctx && access(ctx, f.k).seen && ctx.director) return { ok: false, message: "That person isn't an active coach." };
    }
    return { ok: false, message: "You can't post in this chat." };
  }
  const now = deps.now();
  return withTx(deps.pool, async (q) => {
    const r = await q.query<{ id: string }>(
      "insert into chat_messages (conv, org, sender_id, sender_name, body, created_at) values ($1, $2, $3, $4, $5, $6) returning id::text",
      [o.text, o.org, viewer.coachId, `${viewer.firstName} ${viewer.lastName}`, body, now],
    );
    await setRead(q, o.text, o.org, viewer.coachId, now);
    return { ok: true as const, id: r.rows[0].id };
  });
}

async function setRead(q: Q, conv: string, org: string, coachId: string, at: Date) {
  await q.query(
    `insert into chat_reads (conv, org, coach_id, last_read_at) values ($1, $2, $3, $4)
     on conflict (conv, coach_id) do update set last_read_at = greatest(chat_reads.last_read_at, excluded.last_read_at)`,
    [conv, org, coachId, at],
  );
}

// Opening a chat marks it read.
export async function markChatRead(deps: Deps, viewer: SessionUser, key: string): Promise<void> {
  const f = parseFull(key);
  const ctx = f && (await contextFor(deps.pool, viewer.coachId, f.org));
  if (!f || !ctx || !access(ctx, f.k).seen) return;
  await setRead(deps.pool, orgKey(f.org, keyText(f.k)), f.org, viewer.coachId, deps.now());
}

// ---- Unread summary emails ----

type DigestDeps = Deps & { sendEmail: (to: string, subject: string, text: string) => Promise<void>; appUrl: string };

const when = (d: Date) => d.toLocaleString("en-US", { timeZone: TZ, weekday: "short", hour: "numeric", minute: "2-digit" });

// Chat messages unread for 8+ hours go out in one email per person (each message once), at most every 8 hours. It's
// from the organization's name, or CourtCaptain when it covers several (each chat then names its organization).
export async function sendUnreadChatEmails(deps: DigestDeps): Promise<number> {
  const now = deps.now();
  // Each organization's setting: emails on or off, and after how many hours (its gear → Feature Settings → Chat).
  const orgRows = (
    await deps.pool.query<{ slug: string; name: string; hours: number | null; on: boolean }>(
      "select slug, name, chat_email_hours as hours, chat_emails_on as on from organizations",
    )
  ).rows;
  const names = new Map(orgRows.map((x) => [x.slug, x.name]));
  const hoursOf = new Map(orgRows.filter((x) => x.on).map((x) => [x.slug, x.hours ?? EMAIL_AFTER_HOURS]));
  const cutoffOf = (org: string) => new Date(now.getTime() - (hoursOf.get(org) ?? EMAIL_AFTER_HOURS) * HOUR);
  const convs = (await allConvs(deps.pool)).filter((c) => hoursOf.has(c.org) || (c.org === THUNDER && !names.has(THUNDER)));
  if (!convs.length) return 0;
  // A person gets at most one email per the shortest wait among these organizations.
  const shortest = Math.min(...convs.map((c) => hoursOf.get(c.org) ?? EMAIL_AFTER_HOURS));
  const cutoff = new Date(now.getTime() - shortest * HOUR);
  const recent = new Set(
    (await deps.pool.query<{ conv: string }>("select distinct conv from chat_messages where created_at <= $1", [cutoff])).rows.map(
      (x) => x.conv,
    ),
  );
  const due = convs.filter((c) => recent.has(c.conv));
  if (!due.length) return 0;
  const people = await deps.pool.query<{ coach_id: string; email: string; first_name: string }>(
    `select u.coach_id, u.email, u.first_name from users u left join notify_state n on n.coach_id = u.coach_id
     where u.active and u.email is not null and (n.last_chat_email_at is null or n.last_chat_email_at <= $1)`,
    [cutoff],
  );
  let sent = 0;
  for (const p of people.rows) {
    const done = await withTx(deps.pool, async (q) => {
      await q.query("select pg_advisory_xact_lock(hashtext('chatnotify:' || $1))", [p.coach_id]);
      const st = await q.query<{ last_chat_email_at: Date | null }>("select last_chat_email_at from notify_state where coach_id = $1", [
        p.coach_id,
      ]);
      if (st.rows[0]?.last_chat_email_at && st.rows[0].last_chat_email_at > cutoff) return false;
      const ctxOf = contexts(q, p.coach_id);
      const sections: { org: string; text: string }[] = [];
      const covered: { conv: string; org: string }[] = [];
      let total = 0;
      for (const { conv, org } of due) {
        const f = parseFull(conv);
        const ctx = f && f.org === org ? await ctxOf(org) : null;
        if (!f || !ctx || !access(ctx, f.k).member) continue;
        const m = await q.query<{ sender_name: string; body: string; created_at: Date }>(
          `select m.sender_name, m.body, m.created_at from chat_messages m
           left join chat_reads r on r.conv = m.conv and r.coach_id = $2
           where m.conv = $1 and m.sender_id <> $2 and m.created_at <= $3
             and m.created_at > greatest(coalesce(r.last_read_at, '-infinity'), coalesce(r.emailed_until, '-infinity'))
           order by m.id`,
          [conv, p.coach_id, cutoffOf(org)],
        );
        if (!m.rows.length) continue;
        const title = await titleOf(q, ctx, f.k);
        if (!title) continue;
        total += m.rows.length;
        covered.push({ conv, org });
        const shown = m.rows.slice(-5);
        sections.push({
          org,
          text: [
            "",
            `■ ${title}{org} (${m.rows.length} unread)`,
            ...(m.rows.length > shown.length ? ["  …"] : []),
            ...shown.map((x) => `  ${x.sender_name}, ${when(x.created_at)}: ${x.body.replace(/\n/g, " ")}`),
          ].join("\n"),
        });
      }
      if (!total) return false;
      const orgs = [...new Set(sections.map((s) => s.org))];
      const from = orgs.length === 1 ? (names.get(orgs[0]) ?? "CourtCaptain") : "CourtCaptain";
      const text = [
        `Hi ${p.first_name},`,
        "",
        `You have ${total} unread chat message${total === 1 ? "" : "s"} in the ${from} app:`,
        ...sections.map((s) => s.text.replace("{org}", orgs.length > 1 ? ` · ${names.get(s.org) ?? s.org}` : "")),
        "",
        `Open the app: ${deps.appUrl}/chat`,
        "",
        "This is an automatic email. Replies aren't read; answer in the app.",
      ].join("\n");
      await deps.sendEmail(p.email, `${from}: ${total} unread chat message${total === 1 ? "" : "s"}`, text);
      for (const c of covered) {
        await q.query(
          `insert into chat_reads (conv, org, coach_id, emailed_until) values ($1, $2, $3, $4)
           on conflict (conv, coach_id) do update set emailed_until = excluded.emailed_until`,
          [c.conv, c.org, p.coach_id, cutoff],
        );
      }
      await q.query(
        `insert into notify_state (coach_id, last_chat_email_at) values ($1, $2)
         on conflict (coach_id) do update set last_chat_email_at = excluded.last_chat_email_at`,
        [p.coach_id, now],
      );
      return true;
    });
    if (done) sent++;
  }
  return sent;
}

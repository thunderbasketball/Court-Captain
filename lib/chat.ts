// Chat (SPEC.md section 11), for Thunder and every organization with the Chat feature. Conversations are fixed keys
// whose members follow the current roles in that organization:
//   directors        Directors
//   everyone         Directors + all coaches
//   coaches          coaches (Directors can read and post, but aren't counted as members: no unread, no email)
//   team-<id>        that team's staff + Directors
//   teamcoaches-<id> that team's Head and Assistant Coaches + Directors
//   parents-<id>     that team's staff + its players' parents with a login (cell is parent 1 or 2 on the registration;
//                    Thunder only). Directors can read and post, but aren't counted as members.
//   coach-<id>       one coach + the Directors
//   event-<id>       the event's check-in people + Directors (started from the event; Thunder only)
// Started by one person; Directors can still open them, but only members get unread counts and emails:
//   dm-<a>-<b>       two people (lower id first), one of them a Director
//   staff-<by>-<id>  Director <by> + that team's whole staff
//   heads-<by>       Director <by> + every Head Coach
// A "coach" has the Coach role or is a Head or Assistant Coach on a team. Directors can open every chat.
// Thunder's keys are as above ("coaches"); another organization's carry its slug: "east-ridge~coaches" (its teams are
// org_teams, their coaches org_team_coaches). A person's chat list and unread count cover every organization.
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { hasFeature } from "./features";
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
};

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
  return {
    org,
    coachId,
    director: u.rows[0].director,
    coach: u.rows[0].coach || t.rows.some((x) => x.coach),
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
  | { kind: "heads"; by: string };

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
  return h ? { kind: "heads", by: h[1] } : null;
}

// A full key: the organization and the chat. Events are Thunder's only.
function parseFull(key: unknown): { org: string; k: Key } | null {
  if (typeof key !== "string") return null;
  const i = key.indexOf("~");
  const org = i < 0 ? THUNDER : key.slice(0, i);
  if (!SLUG.test(org) || (i >= 0 && org === THUNDER)) return null;
  const k = parseKey(i < 0 ? key : key.slice(i + 1));
  if (!k || ((k.kind === "event" || k.kind === "parents") && org !== THUNDER)) return null;
  return { org, k };
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
      case "team":
        return ctx.director || ctx.teams.some((t) => t.id === key.id);
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
  }
}

const isCoachSql = (S: Scope) =>
  `(${role(S, "u.coach_id", "Coach")} or exists (select 1 from ${S.staff} s where s.coach_id = u.coach_id and s.role in ('HeadCoach', 'AsstCoach')))`;

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

// The chats this person can start in one organization (or open, if they already have messages).
export async function newChatOptions(deps: Deps, viewer: SessionUser, org: string = THUNDER): Promise<ChatOption[]> {
  if (!SLUG.test(org)) return [];
  const S = scopeOf(org);
  const ctx = await contextFor(deps.pool, viewer.coachId, org);
  if (!ctx) return [];
  const key = (k: string) => orgKey(org, k);
  const out: ChatOption[] = [];
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

// Every chat with messages, in organizations that still have Chat (Thunder: as before).
async function allConvs(q: Q): Promise<{ conv: string; org: string }[]> {
  const r = await q.query<{ conv: string; org: string }>("select distinct conv, org from chat_messages");
  const on = new Map<string, boolean>();
  const out: { conv: string; org: string }[] = [];
  for (const x of r.rows) {
    if (!on.has(x.org)) on.set(x.org, x.org === THUNDER || (await hasFeature(q, x.org, "chat")));
    if (on.get(x.org)) out.push(x);
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
      title: v.org === THUNDER ? title : `${title} · ${shorts.get(v.org) ?? v.org}`,
      last: { body: row.body, sender: row.sender, at: row.at },
      unread: v.member ? row.unread : 0,
    });
  }
  return out.sort((a, b) => b.last!.at.getTime() - a.last!.at.getTime());
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
      return [`${dir} or ${onTeam()}`, [k.id]];
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
  if (!f) return null;
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
  const cutoff = new Date(now.getTime() - EMAIL_AFTER_HOURS * HOUR);
  const convs = await allConvs(deps.pool);
  const recent = new Set(
    (await deps.pool.query<{ conv: string }>("select distinct conv from chat_messages where created_at <= $1", [cutoff])).rows.map(
      (x) => x.conv,
    ),
  );
  const due = convs.filter((c) => recent.has(c.conv));
  if (!due.length) return 0;
  const names = new Map(
    (await deps.pool.query<{ slug: string; name: string }>("select slug, name from organizations")).rows.map((x) => [x.slug, x.name]),
  );
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
          [conv, p.coach_id, cutoff],
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

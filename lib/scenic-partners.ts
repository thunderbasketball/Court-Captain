// Scenic City partners, their gyms and courts, and the game days (SPEC.md section 13, step 5).
// Scenic City Directors manage partners, contacts and game days; a partner's contacts manage its gyms and courts and are the
// only ones who enter its gym availability (hours). `asDirector: false` shows a Director the partner's view (only narrows).
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { cleanPartnerName, isScenicFacilities, type PartnerKind } from "./scenic";
import { withTx, type Queryable } from "./sql";

type Deps = { pool: Pool; now: () => Date };
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };
class PartnerError extends Error {}

const by = (v: SessionUser) => `${v.firstName} ${v.lastName}`;
const isId = (v: unknown): v is string => typeof v === "string" && /^\d{1,18}$/.test(v);
const directorOnly = "Only a Scenic City Director of Facilities can do that.";

async function run<T extends object>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, ...(await fn()) };
  } catch (e) {
    if (e instanceof PartnerError) return { ok: false, message: e.message };
    if ((e as { code?: string }).code === "23505") return { ok: false, message: "That name is already used here." };
    throw e;
  }
}

// A gym or court name: letters, numbers, spaces and . ' & - , ( ) # /, starting with a letter or number (never = + - @).
export function cleanPlaceName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/\s+/g, " ");
  return /^[A-Za-z0-9][A-Za-z0-9 .'&\-,()#/]{0,59}$/.test(s) ? s : null;
}

// An address is optional; when given, 5–200 characters that don't start like a formula.
function cleanAddress(v: unknown): string | null | undefined {
  if (typeof v !== "string" || !v.trim()) return null;
  const s = v.trim().replace(/\s+/g, " ");
  return s.length >= 5 && s.length <= 200 && !/^[=+\-@]/.test(s) ? s : undefined;
}

// Scenic City Director, or one of this partner's contacts.
async function canManage(q: Queryable, viewer: SessionUser, partnerId: string): Promise<boolean> {
  const r = await q.query<{ ok: boolean }>(
    `select has_role($1, 'scenic-city', 'Director')
            or (has_role($1, 'scenic-city', 'Partner') and exists (select 1 from partner_contacts where partner_id = $2 and coach_id = $1)) as ok`,
    [viewer.coachId, partnerId],
  );
  return r.rows[0].ok;
}

// One of this partner's contacts (who also still holds the Partner role).
async function isContact(q: Queryable, viewer: SessionUser, partnerId: string): Promise<boolean> {
  const r = await q.query<{ ok: boolean }>(
    `select has_role($1, 'scenic-city', 'Partner') and exists (select 1 from partner_contacts where partner_id = $2 and coach_id = $1) as ok`,
    [viewer.coachId, partnerId],
  );
  return r.rows[0].ok;
}

// ---- Partners ----

export type PartnerSummary = {
  id: string;
  name: string;
  kind: PartnerKind;
  hostsGames: boolean;
  registersTeams: boolean;
  approved: boolean;
  org: string | null; // set when the partner is an organization on CourtCaptain (e.g. Thunder), approved through a hosting request
  contacts: { id: string; name: string }[]; // by last name
  gyms: number;
  courts: number;
};

// Directors: every partner. Partner contacts: their own. Sorted by name.
export async function listPartners(
  deps: Deps,
  viewer: SessionUser,
  asDirector = true,
): Promise<{ partners: PartnerSummary[]; isDirector: boolean }> {
  const isDirector = asDirector && (await isScenicFacilities(deps.pool, viewer.coachId));
  const r = await deps.pool.query<PartnerSummary>(
    `select p.id::text, p.name, p.kind, p.hosts_games as "hostsGames", p.registers_teams as "registersTeams", p.approved, p.org_slug as org,
            coalesce((select json_agg(json_build_object('id', u.coach_id, 'name', u.first_name || ' ' || u.last_name)
                                order by lower(u.last_name), lower(u.first_name))
                      from partner_contacts c join users u on u.coach_id = c.coach_id where c.partner_id = p.id), '[]') as contacts,
            -- An organization partner's gyms are its own (Thunder's Facilities); each hosts a game as a whole gym.
            case when p.org_slug = 'thunder' then (select count(*)::int from gyms where active)
                 else (select count(*)::int from partner_gyms g where g.partner_id = p.id) end as gyms,
            case when p.org_slug = 'thunder' then (select count(*)::int from gyms where active)
                 else (select count(*)::int from partner_courts c join partner_gyms g on g.id = c.gym_id where g.partner_id = p.id) end as courts
     from partners p
     where $2 or (has_role($1, 'scenic-city', 'Partner') and exists (select 1 from partner_contacts c where c.partner_id = p.id and c.coach_id = $1))
     order by lower(p.name)`,
    [viewer.coachId, isDirector],
  );
  return { partners: r.rows, isDirector };
}

export type Court = { id: string; name: string };
export type Gym = { id: string; name: string; address: string | null; courts: Court[] };
export type PartnerDetail = PartnerSummary & {
  gymList: Gym[];
  canEditPartner: boolean; // Director: name, type, approval, contacts
  canEditGyms: boolean; // Director or contact: gyms and courts
  canEnterHours: boolean; // contact only: gym availability
  managedBy: string | null; // an organization partner's gyms and availability come from its own Facilities (e.g. "Thunder Basketball")
  createdBy: string;
};

// One partner with its gyms and courts (gyms by name, courts in number order). Null if the viewer can't see it.
export async function getPartner(deps: Deps, viewer: SessionUser, id: unknown, asDirector = true): Promise<PartnerDetail | null> {
  if (!isId(id) || !(await canManage(deps.pool, viewer, id))) return null;
  const { partners, isDirector } = await listPartners(deps, viewer, asDirector);
  const p = partners.find((x) => x.id === id);
  if (!p) return null;
  const org = p.org === "thunder";
  const g = await deps.pool.query<Gym>(
    org
      ? `select g.id::text, g.name, null as address, '[]'::json as courts from gyms g where g.active and $1::bigint is not null order by lower(g.name)`
      : `select g.id::text, g.name, g.address,
            coalesce((select json_agg(json_build_object('id', c.id::text, 'name', c.name)
                        order by length(c.name), lower(c.name)) from partner_courts c where c.gym_id = g.id), '[]') as courts
     from partner_gyms g where g.partner_id = $1 order by lower(g.name)`,
    [id],
  );
  const extra = await deps.pool.query<{ created_by: string }>("select created_by from partners where id = $1", [id]);
  const contact = await isContact(deps.pool, viewer, id);
  return {
    ...p,
    gymList: g.rows,
    canEditPartner: isDirector,
    canEditGyms: !org && (isDirector || contact),
    canEnterHours: !org && contact,
    managedBy: org ? "Thunder Basketball" : null,
    createdBy: extra.rows[0].created_by,
  };
}

export type PartnerInput = { name: unknown; kind: unknown; hostsGames: unknown; registersTeams: unknown; approved: unknown };

// Directors: add a partner (id null) or edit one.
export async function savePartner(
  deps: Deps,
  viewer: SessionUser,
  id: unknown,
  input: PartnerInput,
): Promise<Result<{ id: string }>> {
  const name = cleanPartnerName(input.name);
  if (!name) return { ok: false, message: "Enter a name (letters, numbers, spaces)." };
  if (input.kind !== "School" && input.kind !== "Organization") return { ok: false, message: "Choose School or Organization." };
  const hosts = input.hostsGames === true;
  const registers = input.registersTeams === true;
  if (!hosts && !registers) return { ok: false, message: "Choose Hosting games, Registering teams, or both." };
  if (id !== null && !isId(id)) return { ok: false, message: "That partner no longer exists." };
  return run(() =>
    withTx(deps.pool, async (q) => {
      if (!(await isScenicFacilities(q, viewer.coachId))) throw new PartnerError(directorOnly);
      const clash = await q.query("select 1 from partners where lower(name) = lower($1) and id is distinct from $2::bigint", [
        name,
        id,
      ]);
      if (clash.rows[0]) throw new PartnerError(`There's already a partner named ${name}.`);
      if (id === null) {
        const r = await q.query<{ id: string }>(
          `insert into partners (name, kind, hosts_games, registers_teams, approved, created_by) values ($1, $2, $3, $4, $5, $6) returning id::text`,
          [name, input.kind, hosts, registers, input.approved !== false, by(viewer)],
        );
        return { id: r.rows[0].id };
      }
      const r = await q.query(
        "update partners set name = $2, kind = $3, hosts_games = $4, registers_teams = $5, approved = $6 where id = $1",
        [id, name, input.kind, hosts, registers, input.approved === true],
      );
      if (!r.rowCount) throw new PartnerError("That partner no longer exists.");
      return { id };
    }),
  );
}

// ---- Contacts (Directors) ----

// Active users who could be added as this partner's contact (not already one), by last name.
export async function contactOptions(
  deps: Deps,
  viewer: SessionUser,
  partnerId: unknown,
): Promise<{ id: string; name: string }[]> {
  if (!isId(partnerId) || !(await isScenicFacilities(deps.pool, viewer.coachId))) return [];
  const r = await deps.pool.query<{ id: string; name: string }>(
    `select u.coach_id as id, u.first_name || ' ' || u.last_name as name from users u
     where u.active and not exists (select 1 from partner_contacts c where c.partner_id = $1 and c.coach_id = u.coach_id)
     order by lower(u.last_name), lower(u.first_name)`,
    [partnerId],
  );
  return r.rows;
}

// Directors: make someone a contact for this partner (they get the Partner role), or take them off.
export async function setContact(
  deps: Deps,
  viewer: SessionUser,
  partnerId: unknown,
  coachId: unknown,
  on: boolean,
): Promise<Result> {
  if (!isId(partnerId) || typeof coachId !== "string" || !/^\d{7}$/.test(coachId))
    return { ok: false, message: "Pick a person." };
  return run(() =>
    withTx(deps.pool, async (q) => {
      if (!(await isScenicFacilities(q, viewer.coachId))) throw new PartnerError(directorOnly);
      if (!(await q.query("select 1 from partners where id = $1", [partnerId])).rows[0])
        throw new PartnerError("That partner no longer exists.");
      if (!on) {
        await q.query("delete from partner_contacts where partner_id = $1 and coach_id = $2", [partnerId, coachId]);
        return {};
      }
      if (!(await q.query("select 1 from users where coach_id = $1 and active", [coachId])).rows[0])
        throw new PartnerError("Pick an active user.");
      await q.query("insert into partner_contacts (partner_id, coach_id, added_by) values ($1, $2, $3) on conflict do nothing", [
        partnerId,
        coachId,
        by(viewer),
      ]);
      await q.query("select set_role($1, 'scenic-city', 'Partner', true, $2)", [coachId, by(viewer)]);
      return {};
    }),
  );
}

// ---- Gyms and courts (the partner's contacts or a Director) ----

async function gymPartner(q: Queryable, gymId: string): Promise<string | null> {
  return (
    (await q.query<{ p: string }>("select partner_id::text as p from partner_gyms where id = $1", [gymId])).rows[0]?.p ?? null
  );
}

export async function saveGym(
  deps: Deps,
  viewer: SessionUser,
  partnerId: unknown,
  gymId: unknown,
  input: { name: unknown; address: unknown },
): Promise<Result<{ id: string }>> {
  const name = cleanPlaceName(input.name);
  if (!name) return { ok: false, message: "Enter the gym's name (letters, numbers, spaces)." };
  const address = cleanAddress(input.address);
  if (address === undefined) return { ok: false, message: "That address doesn't look right." };
  if (!isId(partnerId) || (gymId !== null && !isId(gymId))) return { ok: false, message: "That gym no longer exists." };
  return run(() =>
    withTx(deps.pool, async (q) => {
      if (!(await canManage(q, viewer, partnerId))) throw new PartnerError("You can't change this partner's gyms.");
      if (gymId === null) {
        const r = await q.query<{ id: string }>(
          "insert into partner_gyms (partner_id, name, address, created_by) values ($1, $2, $3, $4) returning id::text",
          [partnerId, name, address, by(viewer)],
        );
        return { id: r.rows[0].id };
      }
      const r = await q.query("update partner_gyms set name = $3, address = $4 where id = $1 and partner_id = $2", [
        gymId,
        partnerId,
        name,
        address,
      ]);
      if (!r.rowCount) throw new PartnerError("That gym no longer exists.");
      return { id: gymId };
    }),
  );
}

export async function deleteGym(deps: Deps, viewer: SessionUser, gymId: unknown): Promise<Result> {
  if (!isId(gymId)) return { ok: false, message: "That gym no longer exists." };
  return run(() =>
    withTx(deps.pool, async (q) => {
      const p = await gymPartner(q, gymId);
      if (!p) throw new PartnerError("That gym no longer exists.");
      if (!(await canManage(q, viewer, p))) throw new PartnerError("You can't change this partner's gyms.");
      await q.query("delete from partner_gyms where id = $1", [gymId]);
      return {};
    }),
  );
}

export async function addCourt(deps: Deps, viewer: SessionUser, gymId: unknown, name: unknown): Promise<Result> {
  const n = cleanPlaceName(name);
  if (!n) return { ok: false, message: "Enter the court's name, e.g. Court 1." };
  if (!isId(gymId)) return { ok: false, message: "That gym no longer exists." };
  return run(() =>
    withTx(deps.pool, async (q) => {
      const p = await gymPartner(q, gymId);
      if (!p) throw new PartnerError("That gym no longer exists.");
      if (!(await canManage(q, viewer, p))) throw new PartnerError("You can't change this partner's gyms.");
      await q.query("insert into partner_courts (gym_id, name, created_by) values ($1, $2, $3)", [gymId, n, by(viewer)]);
      return {};
    }),
  );
}

export async function deleteCourt(deps: Deps, viewer: SessionUser, courtId: unknown): Promise<Result> {
  if (!isId(courtId)) return { ok: false, message: "That court no longer exists." };
  return run(() =>
    withTx(deps.pool, async (q) => {
      const r = await q.query<{ p: string }>(
        "select g.partner_id::text as p from partner_courts c join partner_gyms g on g.id = c.gym_id where c.id = $1",
        [courtId],
      );
      if (!r.rows[0]) throw new PartnerError("That court no longer exists.");
      if (!(await canManage(q, viewer, r.rows[0].p))) throw new PartnerError("You can't change this partner's gyms.");
      await q.query("delete from partner_courts where id = $1", [courtId]);
      return {};
    }),
  );
}

// ---- Game days ----

export type GameDay = { id: string; day: string; createdBy: string; programs: string[] }; // day as YYYY-MM-DD; programs playing that day

const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v));

// Anyone with a Scenic City role. From `from` (YYYY-MM-DD, Eastern today by default) on, by date.
export async function listGameDays(deps: Deps, viewer: SessionUser, from?: string): Promise<GameDay[] | null> {
  const member = await deps.pool.query<{ ok: boolean }>(
    "select exists (select 1 from org_roles where coach_id = $1 and org = 'scenic-city' and role <> 'Request') as ok",
    [viewer.coachId],
  );
  if (!member.rows[0].ok) return null;
  const r = await deps.pool.query<GameDay>(
    `select id::text, to_char(day, 'YYYY-MM-DD') as day, created_by as "createdBy",
            array(select p.name from program_game_days pg join scenic_programs p on p.id = pg.program_id
                  where pg.game_day_id = game_days.id order by lower(p.name)) as programs
     from game_days
     where day >= coalesce($1::date, ($2::timestamptz at time zone 'America/New_York')::date) order by day`,
    [isDate(from) ? from : null, deps.now()],
  );
  return r.rows;
}

// Directors: the calendar's changes in one go. Adds future dates (existing ones stay); removes dates (and their court hours).
export async function saveGameDays(
  deps: Deps,
  viewer: SessionUser,
  input: { add: unknown; remove: unknown },
): Promise<Result<{ added: number; removed: number }>> {
  const list = (v: unknown) => (Array.isArray(v) ? [...new Set(v)] : null);
  const add = list(input.add);
  const remove = list(input.remove);
  if (!add || !remove || !add.every(isDate) || !remove.every(isDate))
    return { ok: false, message: "Those dates don't look right." };
  if (add.length + remove.length > 400) return { ok: false, message: "Too many dates at once." };
  if (!add.length && !remove.length) return { ok: false, message: "Tap the dates to add or remove first." };
  return run(() =>
    withTx(deps.pool, async (q) => {
      if (!(await isScenicFacilities(q, viewer.coachId))) throw new PartnerError(directorOnly);
      const today = (
        await q.query<{ d: string }>(
          "select to_char(($1::timestamptz at time zone 'America/New_York')::date, 'YYYY-MM-DD') as d",
          [deps.now()],
        )
      ).rows[0].d;
      if (add.some((d) => d < today)) throw new PartnerError("Game days can't be in the past.");
      const r1 = await q.query("delete from game_days where day = any($1::date[])", [remove]);
      const r2 = await q.query(
        "insert into game_days (day, created_by) select d, $2 from unnest($1::date[]) d on conflict (day) do nothing",
        [add, by(viewer)],
      );
      return { added: r2.rowCount ?? 0, removed: r1.rowCount ?? 0 };
    }),
  );
}

// ---- Open hours on game days (5b) ----

export type HoursWindow = { starts: string; ends: string; setBy: string }; // "HH:MM", Eastern
export type PartnerHours = {
  days: GameDay[]; // upcoming game days
  courts: { id: string; gym: string; name: string }[]; // by gym, then court number
  hours: Record<string, HoursWindow>; // key `${courtId}:${dayId}`
};

// The partner's courts and their hours on every upcoming game day. Null if the viewer can't manage this partner.
export async function partnerHours(deps: Deps, viewer: SessionUser, partnerId: unknown): Promise<PartnerHours | null> {
  if (!isId(partnerId) || !(await canManage(deps.pool, viewer, partnerId))) return null;
  const days = (await listGameDays(deps, viewer)) ?? [];
  // An organization partner (Thunder): its gyms marked Partner Games in its Facilities, each a whole gym.
  const org = await deps.pool.query("select 1 from partners where id = $1 and org_slug = 'thunder'", [partnerId]);
  if (org.rowCount) {
    const gyms = await deps.pool.query<{ id: string; gym: string; name: string }>(
      "select id::text, name as gym, 'Whole gym' as name from gyms where active order by lower(name)",
    );
    const a = await deps.pool.query<HoursWindow & { key: string }>(
      `select a.gym_id || ':' || d.id as key, to_char(a.starts, 'HH24:MI') as starts, to_char(a.ends, 'HH24:MI') as ends, a.set_by as "setBy"
       from gym_availability a join game_days d on d.day = a.day where a.use = 'partner' and d.id = any($1::bigint[])`,
      [days.map((d) => d.id)],
    );
    return { days, courts: gyms.rows, hours: Object.fromEntries(a.rows.map(({ key, ...w }) => [key, w])) };
  }
  const courts = await deps.pool.query<{ id: string; gym: string; name: string }>(
    `select c.id::text, g.name as gym, c.name from partner_courts c join partner_gyms g on g.id = c.gym_id
     where g.partner_id = $1 order by lower(g.name), length(c.name), lower(c.name)`,
    [partnerId],
  );
  const h = await deps.pool.query<HoursWindow & { key: string }>(
    `select h.court_id || ':' || h.game_day_id as key, to_char(h.starts, 'HH24:MI') as starts, to_char(h.ends, 'HH24:MI') as ends,
            h.set_by as "setBy"
     from court_hours h join partner_courts c on c.id = h.court_id join partner_gyms g on g.id = c.gym_id
     where g.partner_id = $1 and h.game_day_id = any($2::bigint[])`,
    [partnerId, days.map((d) => d.id)],
  );
  return { days, courts: courts.rows, hours: Object.fromEntries(h.rows.map(({ key, ...w }) => [key, w])) };
}

const isTime = (v: unknown): v is string => typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

// Courts can be open for Scenic City games between these times (Eastern).
export const EARLIEST = "09:00";
export const LATEST = "22:00";

export type HoursInput = {
  courtIds: unknown; // this partner's courts
  dayIds?: unknown; // game days picked on the calendar, or
  dayId?: unknown; // one game day, or
  repeat?: { from: unknown; to: unknown; weekdays: unknown }; // every matching upcoming game day
  starts: unknown; // "HH:MM", or null with ends null to clear (closed)
  ends: unknown;
};

// Set (or clear) the hours for these courts on one game day or every matching one. Returns how many court-days changed.
export async function setHours(
  deps: Deps,
  viewer: SessionUser,
  partnerId: unknown,
  input: HoursInput,
): Promise<Result<{ changed: number }>> {
  if (!isId(partnerId)) return { ok: false, message: "That partner no longer exists." };
  const courtIds = Array.isArray(input.courtIds) ? input.courtIds.filter(isId) : [];
  if (!courtIds.length) return { ok: false, message: "Pick at least one court." };
  const clear = input.starts === null && input.ends === null;
  if (!clear) {
    if (!isTime(input.starts) || !isTime(input.ends)) return { ok: false, message: "Enter a start and end time." };
    if (input.ends <= input.starts) return { ok: false, message: "The end time must be after the start time." };
    if (input.starts < EARLIEST || input.ends > LATEST)
      return { ok: false, message: "Times must be between 9:00 AM and 10:00 PM." };
  }
  // Which upcoming game days: [sql, params]; $1 is always today (Eastern).
  let days: [string, unknown[]];
  if (input.repeat) {
    const { from, to, weekdays } = input.repeat;
    if (!isDate(from) || !isDate(to)) return { ok: false, message: "Pick the dates." };
    if (to < from) return { ok: false, message: "The end date is before the start date." };
    const wd = Array.isArray(weekdays) ? weekdays.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6) : [];
    if (!wd.length) return { ok: false, message: "Pick the days of the week." };
    days = [
      "select id::text from game_days where day >= $1::date and day between $2::date and $3::date and extract(dow from day)::int = any($4::int[])",
      [from, to, wd],
    ];
  } else if (Array.isArray(input.dayIds)) {
    const ids = input.dayIds.filter(isId);
    if (!ids.length) return { ok: false, message: "Tap the game days first." };
    days = ["select id::text from game_days where day >= $1::date and id = any($2::bigint[])", [ids]];
  } else {
    if (!isId(input.dayId)) return { ok: false, message: "Pick a game day." };
    days = ["select id::text from game_days where day >= $1::date and id = $2::bigint", [input.dayId]];
  }
  return run(() =>
    withTx(deps.pool, async (q) => {
      if (!(await isContact(q, viewer, partnerId)))
        throw new PartnerError("Only this partner's contacts can enter its gym availability.");
      const owned = await q.query<{ id: string }>(
        `select c.id::text from partner_courts c join partner_gyms g on g.id = c.gym_id where g.partner_id = $1 and c.id = any($2::bigint[])`,
        [partnerId, courtIds],
      );
      if (owned.rows.length !== new Set(courtIds).size)
        throw new PartnerError("One of those courts no longer exists. Reload and try again.");
      const today = (
        await q.query<{ d: string }>(
          "select to_char(($1::timestamptz at time zone 'America/New_York')::date, 'YYYY-MM-DD') as d",
          [deps.now()],
        )
      ).rows[0].d;
      const dayIds = (await q.query<{ id: string }>(days[0], [today, ...days[1]])).rows.map((d) => d.id);
      if (!dayIds.length) throw new PartnerError("No upcoming game days match those dates.");
      const r = clear
        ? await q.query("delete from court_hours where court_id = any($1::bigint[]) and game_day_id = any($2::bigint[])", [
            courtIds,
            dayIds,
          ])
        : await q.query(
            `insert into court_hours (court_id, game_day_id, starts, ends, set_by, set_at)
             select c, d, $3::time, $4::time, $5, $6 from unnest($1::bigint[]) c, unnest($2::bigint[]) d
             on conflict (court_id, game_day_id) do update set starts = excluded.starts, ends = excluded.ends, set_by = excluded.set_by, set_at = excluded.set_at`,
            [courtIds, dayIds, input.starts, input.ends, by(viewer), deps.now()],
          );
      return { changed: r.rowCount ?? 0 };
    }),
  );
}

// Directors: how many courts are open on each upcoming game day (all partners), keyed by game day id.
export async function openCourtsByDay(deps: Deps, viewer: SessionUser): Promise<Record<string, number> | null> {
  if (!(await isScenicFacilities(deps.pool, viewer.coachId))) return null;
  const r = await deps.pool.query<{ id: string; n: number }>(
    `select id, sum(n)::int as n from (
       -- Partners' own courts (not organization partners, whose gyms come from their Facilities below)
       select h.game_day_id::text as id, count(*) as n from court_hours h join game_days d on d.id = h.game_day_id
         join partner_courts c on c.id = h.court_id join partner_gyms g on g.id = c.gym_id join partners p on p.id = g.partner_id
         where p.org_slug is null and d.day >= ($1::timestamptz at time zone 'America/New_York')::date group by 1
       union all
       -- Thunder, once approved as a hosting partner: each gym marked Partner Games that day
       select d.id::text, count(*) from gym_availability a join game_days d on d.day = a.day
         where a.use = 'partner' and exists (select 1 from partners p where p.org_slug = 'thunder' and p.approved and p.hosts_games)
           and d.day >= ($1::timestamptz at time zone 'America/New_York')::date group by 1
     ) x group by id`,
    [deps.now()],
  );
  return Object.fromEntries(r.rows.map((x) => [x.id, x.n]));
}

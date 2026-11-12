// Facilities (SPEC.md section 14): what each of an organization's gyms is available for on each date, and when (Eastern).
// A gym's courts are its practice goals (Goal #1, Goal #2): Practice availability covers them all; games use the gym.
// The choices follow the organization's features: Practice Slots (Thunder's Practice Management), League Games, shown
// under the league's name, e.g. "Scenic City" (Hosting Sites Available, once the league approves it as a hosting site),
// In-House Games (Programs or Event Management). Its Admins and
// Directors of Facilities set them, and (for registered organizations) add and remove its gyms and courts.
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { hasFeature } from "./features";
import { hasArea, orgHasArea } from "./org-admin";
import { orgShort } from "./org-registry";
import { isOrgSlug, type OrgSlug } from "./orgs";
import { managesGyms } from "./places";
import { syncPracticeSlots } from "./practice/admin";
import { withTx, type Queryable } from "./sql";
import { easternDate } from "./time";

type Deps = { pool: Pool; now: () => Date };
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

export const USES = [
  { key: "practice", name: "Practice Slots" },
  { key: "partner", name: "League Games" }, // shown as the league's name (e.g. "Scenic City") where known
  { key: "in-house", name: "In-House Games" },
] as const;
export type Use = (typeof USES)[number]["key"];

// Default hours by weekday (0 = Sunday): Mon–Fri 6–9 PM, Sat–Sun 9 AM–9 PM.
export const DEFAULT_HOURS: { starts: string; ends: string }[] = [0, 1, 2, 3, 4, 5, 6].map((d) =>
  d === 0 || d === 6 ? { starts: "09:00", ends: "21:00" } : { starts: "18:00", ends: "21:00" },
);
export const EARLIEST = "06:00";
export const LATEST = "23:00";
const weekday = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();
const isDate = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(`${v}T12:00:00Z`));
const isTime = (v: unknown): v is string => typeof v === "string" && /^([01]\d|2[0-3]):(00|30)$/.test(v);
const isId = (v: unknown): v is string => typeof v === "string" && /^\d{1,18}$/.test(v);
const by = (v: SessionUser) => `${v.firstName} ${v.lastName}`;

// Hosting other organizations' games: either feature lets an organization offer its gyms.
export const canHost = (q: Pick<Queryable, "query">, org: OrgSlug) => hasFeature(q, org, "hosting-available");

// The uses an organization can pick right now, and why League Games aren't there yet (if they aren't). None = nothing to
// mark yet, so Gym availability stays hidden. Practice Slots are Thunder's (its practice schedule); Event Management (not
// Thunder's) or Programs give In-House Games; League Games once a league approves the organization as a host.
// `leagues`: the approving leagues' short names ("Scenic City"), the name League Games shows under.
export async function availableUses(
  q: Queryable,
  org: OrgSlug = "thunder",
): Promise<{ uses: Use[]; partnerNote: string | null; leagues: string }> {
  const [practice, hosting, programs, events, approved, short] = await Promise.all([
    org === "thunder" ? hasFeature(q, org, "practice") : false,
    canHost(q, org),
    hasFeature(q, org, "programs"),
    hasFeature(q, org, "events"),
    q.query<{ name: string }>(
      `select coalesce(o.short_name, o.name) as name from org_partnerships p join organizations o on o.slug = p.for_org
       where p.host_org = $1 and p.status = 'approved' order by 1`,
      [org],
    ),
    orgShort(q, org),
  ]);
  const uses: Use[] = [];
  if (practice) uses.push("practice");
  if (hosting && approved.rowCount) uses.push("partner");
  if (programs || (events && org !== "thunder")) uses.push("in-house"); // Thunder's events use practice slots
  const partnerNote =
    hosting && !approved.rowCount ? `League game dates appear once a league approves ${short} as a hosting site.` : null;
  return { uses, partnerNote, leagues: approved.rows.map((r) => r.name).join(" & ") };
}

// Admins and Directors of Facilities of this organization (Thunder's from the session, others from the database).
const mayManage = async (q: Pick<Queryable, "query">, viewer: SessionUser, org: OrgSlug) =>
  org === "thunder" ? hasArea(viewer, "facilities") : orgHasArea(q, viewer.coachId, org, "facilities");

export type CourtDay = { use: Use; starts: string; ends: string; setBy: string };
export type FacilitiesView = {
  today: string;
  uses: { key: Use; name: string }[];
  partnerNote: string | null;
  gyms: {
    id: string;
    name: string;
    short: string | null;
    courts: string[]; // the gym's practice goals, by name
    address: string | null; // its real place (Google Places), when set
    lat: number | null;
    lng: number | null;
    placeId: string | null;
    pinLat: number | null; // its hand-set pin (Directions go there)
    pinLng: number | null;
    pinAddress: string | null;
  }[];
  days: Record<string, CourtDay>; // key `${gymId}:${YYYY-MM-DD}`, today on
  gameDays: Record<string, string>; // YYYY-MM-DD → who plays then ("Scenic City"): leagues that approved this host
};

export async function facilitiesView(deps: Deps, viewer: SessionUser, org: OrgSlug = "thunder"): Promise<FacilitiesView | null> {
  if (!(await mayManage(deps.pool, viewer, org))) return null;
  const today = easternDate(deps.now());
  const [{ uses, partnerNote, leagues }, gyms, days, gameDays] = await Promise.all([
    availableUses(deps.pool, org),
    deps.pool.query<FacilitiesView["gyms"][number]>(
      `select g.id::text, g.name, g.short_name as short, g.address, g.lat, g.lng, g.place_id as "placeId",
              g.pin_lat as "pinLat", g.pin_lng as "pinLng", g.pin_address as "pinAddress",
              array(select c.name from courts c where c.gym_id = g.id and c.active order by length(c.name), c.name) as courts
       from gyms g where g.active and g.org = $1 order by lower(g.name)`,
      [org],
    ),
    deps.pool.query<CourtDay & { key: string }>(
      `select a.gym_id || ':' || to_char(a.day, 'YYYY-MM-DD') as key, a.use, to_char(a.starts, 'HH24:MI') as starts,
              to_char(a.ends, 'HH24:MI') as ends, a.set_by as "setBy"
       from gym_availability a join gyms g on g.id = a.gym_id where a.day >= $1::date and g.org = $2`,
      [today, org],
    ),
    // Game days are Scenic City's (the only league so far), shown once it approves this organization as a host.
    deps.pool.query<{ day: string; league: string }>(
      `select to_char(g.day, 'YYYY-MM-DD') as day, coalesce(o.short_name, o.name) as league
       from game_days g
       join org_partnerships p on p.for_org = 'scenic-city' and p.host_org = $2 and p.status = 'approved'
       join organizations o on o.slug = p.for_org
       where g.day >= $1::date`,
      [today, org],
    ),
  ]);
  return {
    today,
    uses: USES.filter((u) => uses.includes(u.key)).map((u) => (u.key === "partner" && leagues ? { ...u, name: leagues } : u)),
    partnerNote,
    gyms: gyms.rows,
    days: Object.fromEntries(days.rows.map(({ key, ...d }) => [key, d])),
    gameDays: Object.fromEntries(gameDays.rows.map((g) => [g.day, g.league])),
  };
}

export type AvailabilityInput = {
  org?: unknown; // the organization (Thunder when left out)
  gymId: unknown;
  days: unknown;
  use: unknown; // a Use, or null to clear
  defaults?: unknown; // true: each day's default hours
  starts?: unknown; // "HH:MM" when not using defaults
  ends?: unknown;
};

// Set (or clear, with use null) a gym's use and hours on the selected dates. Today on only.
// Thrown inside the transaction so nothing is saved (e.g. a booked practice would be removed).
class Refusal extends Error {}

export async function setAvailability(
  deps: Deps,
  viewer: SessionUser,
  input: AvailabilityInput,
): Promise<Result<{ saved: number; slotsAdded: number; slotsRemoved: number }>> {
  const org = input.org === undefined ? "thunder" : isOrgSlug(input.org) ? input.org : null;
  if (!org) return { ok: false, message: "Pick an organization." };
  if (!(await mayManage(deps.pool, viewer, org)))
    return { ok: false, message: `Only a ${await orgShort(deps.pool, org)} Admin or Director of Facilities can do that.` };
  const gymId = input.gymId;
  const days = Array.isArray(input.days) ? [...new Set(input.days)] : [];
  if (!isId(gymId)) return { ok: false, message: "Pick a gym." };
  if (!days.length || !days.every(isDate)) return { ok: false, message: "Tap the dates first." };
  if (days.length > 370) return { ok: false, message: "Too many at once. Do fewer dates." };
  const today = easternDate(deps.now());
  if (days.some((d) => d < today)) return { ok: false, message: "Past dates can't change." };
  const use = input.use === null ? null : USES.find((u) => u.key === input.use)?.key;
  if (use === undefined) return { ok: false, message: "Pick what the courts are for." };
  let hours: (day: string) => { starts: string; ends: string };
  if (use === null || input.defaults === true) hours = (d) => DEFAULT_HOURS[weekday(d)];
  else {
    const { starts, ends } = input;
    if (!isTime(starts) || !isTime(ends)) return { ok: false, message: "Pick start and end times." };
    if (starts < EARLIEST || ends > LATEST) return { ok: false, message: "Times must be between 6:00 AM and 11:00 PM." };
    if (ends <= starts) return { ok: false, message: "The end time must be after the start." };
    hours = () => ({ starts, ends });
  }
  return withTx(deps.pool, async (q) => {
    if (use !== null && !(await availableUses(q, org)).uses.includes(use))
      return { ok: false as const, message: `${await orgShort(q, org)} can't use ${USES.find((u) => u.key === use)!.name} yet.` };
    if (!(await q.query("select 1 from gyms where id = $1 and org = $2 and active for update", [gymId, org])).rowCount)
      return { ok: false as const, message: "That gym no longer exists." };
    // Practice dates get their 60-minute slots for each goal; other uses (or clearing) remove that day's open slots.
    const slots = await syncPracticeSlots(q, gymId, days, (d) => (use === "practice" ? hours(d) : null), by(viewer), deps.now());
    if ("error" in slots) throw new Refusal(slots.error);
    if (use === null) {
      const r = await q.query("delete from gym_availability where gym_id = $1 and day = any($2::date[])", [gymId, days]);
      return { ok: true as const, saved: r.rowCount ?? 0, slotsAdded: slots.added, slotsRemoved: slots.removed };
    }
    const r = await q.query(
      `insert into gym_availability (gym_id, day, use, starts, ends, set_by, set_at)
       select $1, d, $3, s, e, $4, $5 from unnest($2::date[], $6::time[], $7::time[]) as x(d, s, e)
       on conflict (gym_id, day) do update set use = excluded.use, starts = excluded.starts, ends = excluded.ends,
         set_by = excluded.set_by, set_at = excluded.set_at`,
      [gymId, days, use, by(viewer), deps.now(), days.map((d) => hours(d).starts), days.map((d) => hours(d).ends)],
    );
    return { ok: true as const, saved: r.rowCount ?? 0, slotsAdded: slots.added, slotsRemoved: slots.removed };
  }).catch((e) => {
    if (e instanceof Refusal) return { ok: false as const, message: e.message };
    throw e;
  });
}

// ---- A registered organization's gyms and courts (Thunder's are under Facilities → Gyms) ----

// Gym and court names: letters, numbers, spaces and . ' & - , ( ) # /, starting with a letter or number (never a formula).
const cleanPlace = (v: unknown) => {
  if (typeof v !== "string") return null;
  const t = v.trim().replace(/\s+/g, " ");
  return /^[A-Za-z0-9][A-Za-z0-9 .'&\-,()#/]{0,59}$/.test(t) ? t : null;
};

export async function addOrgGym(
  deps: Deps,
  viewer: SessionUser,
  org: unknown,
  input: { name: unknown; short: unknown; courts: unknown },
): Promise<Result<{ id: string }>> {
  if (!isOrgSlug(org) || org === "thunder" || !(await mayManage(deps.pool, viewer, org)))
    return { ok: false, message: "Only an Admin or Director of Facilities can add gyms." };
  const name = cleanPlace(input.name);
  if (!name) return { ok: false, message: "Enter the gym's name." };
  const short = typeof input.short === "string" ? input.short.trim() : "";
  if (!/^[A-Za-z0-9][A-Za-z0-9 .&-]{0,7}$/.test(short))
    return { ok: false, message: "Enter a short name of up to 8 letters or numbers." };
  const list = Array.isArray(input.courts) ? input.courts.map(cleanPlace) : [];
  if (!list.length || list.length > 12 || list.some((c) => !c))
    return { ok: false, message: "A gym needs 1 to 12 courts, each with a name." };
  const courts = list as string[];
  if (new Set(courts.map((c) => c.toLowerCase())).size !== courts.length)
    return { ok: false, message: "Each court needs a different name." };
  return withTx(deps.pool, async (q) => {
    const taken = await q.query<{ name: string }>(
      "select name from gyms where org = $1 and (lower(name) = lower($2) or lower(short_name) = lower($3)) limit 1",
      [org, name, short],
    );
    if (taken.rows[0]) return { ok: false as const, message: `"${taken.rows[0].name}" already has that name or short name.` };
    const g = await q.query<{ id: string }>("insert into gyms (org, name, short_name) values ($1, $2, $3) returning id::text", [
      org,
      name,
      short,
    ]);
    await q.query("insert into courts (gym_id, name) select $1, unnest($2::text[])", [g.rows[0].id, courts]);
    return { ok: true as const, id: g.rows[0].id };
  });
}

// Rename a gym (its ⚙ menu): those who manage the organization's gyms. Its slots, courts, availability, bookings and
// games follow it (they point at the gym, not its name). `short` (another organization's gyms, required there) is left
// alone when undefined (Thunder's gyms have none).
export async function renameGym(
  deps: Deps,
  viewer: SessionUser,
  org: unknown,
  gymId: unknown,
  input: { name: unknown; short?: unknown },
): Promise<Result<{ name: string }>> {
  if (typeof org !== "string" || !(await managesGyms(deps.pool, viewer, org)))
    return { ok: false, message: "Only an Admin or Director of Facilities can rename gyms." };
  if (!isId(gymId)) return { ok: false, message: "That gym no longer exists." };
  const name = cleanPlace(input.name);
  if (!name) return { ok: false, message: "Enter the gym's name (letters and numbers, up to 60)." };
  const short = typeof input.short === "string" ? input.short.trim() : undefined;
  if (input.short !== undefined && !(short && /^[A-Za-z0-9][A-Za-z0-9 .&-]{0,7}$/.test(short)))
    return { ok: false, message: "Enter a short name of up to 8 letters or numbers." };
  return withTx(deps.pool, async (q) => {
    const taken = await q.query<{ name: string }>(
      `select name from gyms where org = $1 and id <> $2
          and (lower(name) = lower($3) or ($4::text is not null and lower(short_name) = lower($4))) limit 1`,
      [org, gymId, name, short ?? null],
    );
    if (taken.rows[0]) return { ok: false as const, message: `"${taken.rows[0].name}" already has that name or short name.` };
    const r = await q.query(
      "update gyms set name = $3, short_name = coalesce($4, short_name) where id = $1 and org = $2",
      [gymId, org, name, short ?? null],
    );
    return r.rowCount ? { ok: true as const, name } : { ok: false as const, message: "That gym no longer exists." };
  });
}

// A registered organization's gyms have no practice slots, so removing one removes it with its courts and availability.
export async function removeOrgGym(deps: Deps, viewer: SessionUser, org: unknown, gymId: unknown): Promise<Result> {
  if (!isOrgSlug(org) || org === "thunder" || !(await mayManage(deps.pool, viewer, org)))
    return { ok: false, message: "Only an Admin or Director of Facilities can remove gyms." };
  if (!isId(gymId)) return { ok: false, message: "That gym no longer exists." };
  const r = await deps.pool.query("delete from gyms where id = $1 and org = $2", [gymId, org]);
  return r.rowCount ? { ok: true } : { ok: false, message: "That gym no longer exists." };
}

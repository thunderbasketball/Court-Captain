// Thunder Facilities (SPEC.md section 14): what each gym is available for on each date, and when (Eastern).
// A gym's courts are its practice goals (Goal #1, Goal #2): Practice availability covers them all; games use the gym.
// The choices follow Thunder's features: Practice Slots (Practice Management), Partner Games (Hosting Sites Available and an
// approved hosting partnership), In-House Games (Programs). Admins and Directors of Facilities set them.
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { hasFeature } from "./features";
import { hasArea } from "./org-admin";
import { syncPracticeSlots } from "./practice/admin";
import { withTx, type Queryable } from "./sql";
import { easternDate } from "./time";

type Deps = { pool: Pool; now: () => Date };
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

export const USES = [
  { key: "practice", name: "Practice Slots" },
  { key: "partner", name: "Partner Games" },
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

// The uses Thunder can pick right now, and why Partner Games isn't there yet (if it isn't).
export async function availableUses(q: Queryable): Promise<{ uses: Use[]; partnerNote: string | null }> {
  const [practice, hostingAvail, programs, approved] = await Promise.all([
    hasFeature(q, "thunder", "practice"),
    hasFeature(q, "thunder", "hosting-available"),
    hasFeature(q, "thunder", "programs"),
    q.query("select 1 from org_partnerships where host_org = 'thunder' and status = 'approved' limit 1"),
  ]);
  const uses: Use[] = [];
  if (practice) uses.push("practice");
  if (hostingAvail && approved.rowCount) uses.push("partner");
  if (programs) uses.push("in-house");
  const partnerNote =
    hostingAvail && !approved.rowCount
      ? "Partner Games appears once an organization approves Thunder as a hosting partner."
      : null;
  return { uses, partnerNote };
}

export type CourtDay = { use: Use; starts: string; ends: string; setBy: string };
export type FacilitiesView = {
  today: string;
  uses: { key: Use; name: string }[];
  partnerNote: string | null;
  gyms: { id: string; name: string; courts: string[] }[]; // courts = the gym's practice goals, by name
  days: Record<string, CourtDay>; // key `${gymId}:${YYYY-MM-DD}`, today on
};

export async function facilitiesView(deps: Deps, viewer: SessionUser): Promise<FacilitiesView | null> {
  if (!hasArea(viewer, "facilities")) return null;
  const today = easternDate(deps.now());
  const [{ uses, partnerNote }, gyms, days] = await Promise.all([
    availableUses(deps.pool),
    deps.pool.query<{ id: string; name: string; courts: string[] }>(
      `select g.id::text, g.name,
              array(select c.name from courts c where c.gym_id = g.id and c.active order by length(c.name), c.name) as courts
       from gyms g where g.active order by lower(g.name)`,
    ),
    deps.pool.query<CourtDay & { key: string }>(
      `select a.gym_id || ':' || to_char(a.day, 'YYYY-MM-DD') as key, a.use, to_char(a.starts, 'HH24:MI') as starts,
              to_char(a.ends, 'HH24:MI') as ends, a.set_by as "setBy"
       from gym_availability a where a.day >= $1::date`,
      [today],
    ),
  ]);
  return {
    today,
    uses: USES.filter((u) => uses.includes(u.key)),
    partnerNote,
    gyms: gyms.rows,
    days: Object.fromEntries(days.rows.map(({ key, ...d }) => [key, d])),
  };
}

export type AvailabilityInput = {
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
  if (!hasArea(viewer, "facilities"))
    return { ok: false, message: "Only a Thunder Admin or Director of Facilities can do that." };
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
    if (use !== null && !(await availableUses(q)).uses.includes(use))
      return { ok: false as const, message: `Thunder can't use ${USES.find((u) => u.key === use)!.name} yet.` };
    if (!(await q.query("select 1 from gyms where id = $1 and active for update", [gymId])).rowCount)
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

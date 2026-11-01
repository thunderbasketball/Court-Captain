// Director tools for practices: add a gym, add slots, blackout dates (block / restore).
// Slots are matched by Gym + Court + Time, and times are Eastern.
import type { Pool, PoolClient } from "pg";
import type { SessionUser } from "../auth/service";
import { withTx } from "../sql";
import { zonedTime } from "../time";
import { describeRule, insertRule, materializeRules, removeRule, specFrom, yearsToFill, type RuleKind } from "./rules";
import { blockScope, reopenScope, type RemovedBooking } from "./scope";
import { hasArea } from "../org-admin";

export type { RemovedBooking } from "./scope";

type Deps = { pool: Pool; now: () => Date };
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };
class UserError extends Error {}

async function run<T extends object>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, ...(await fn()) };
  } catch (e) {
    if (e instanceof UserError) return { ok: false, message: e.message };
    throw e;
  }
}
const directorOnly = { ok: false as const, message: "Only a Director of Facilities can change gyms and practice slots." };
const by = (v: SessionUser) => `${v.firstName} ${v.lastName}`;

export const SLOT_HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]; // 8 AM – 9 PM starts
const MAX_DAYS = 400;

// Gym and court names: start with a letter or digit; letters, digits, spaces, . ' & - after.
function cleanPlaceName(v: unknown, what: string): string {
  const s = typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "";
  if (!/^[\p{L}\d][\p{L}\d .'&-]{0,59}$/u.test(s)) throw new UserError(`Enter a valid ${what} (letters and numbers).`);
  return s;
}

const isId = (v: unknown): v is string => typeof v === "string" && /^\d{1,18}$/.test(v);

function cleanRange(
  from: unknown,
  to: unknown,
): { from: string; to: string; days: { y: number; m: number; d: number; weekday: number; iso: string }[] } {
  const re = /^(\d{4})-(\d{2})-(\d{2})$/;
  const a = typeof from === "string" ? from.match(re) : null;
  const b = typeof to === "string" ? to.match(re) : null;
  if (!a || !b) throw new UserError("Pick a From and To date.");
  const start = Date.UTC(+a[1], +a[2] - 1, +a[3]);
  const end = Date.UTC(+b[1], +b[2] - 1, +b[3]);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start)
    throw new UserError("The To date must be on or after the From date.");
  if ((end - start) / 86_400_000 > MAX_DAYS) throw new UserError("Pick a range of about a year or less.");
  const days = [];
  for (let t = start; t <= end; t += 86_400_000) {
    const d = new Date(t);
    days.push({
      y: d.getUTCFullYear(),
      m: d.getUTCMonth() + 1,
      d: d.getUTCDate(),
      weekday: d.getUTCDay(),
      iso: d.toISOString().slice(0, 10),
    });
  }
  return { from: from as string, to: to as string, days };
}

// ---- Gyms ----

export async function addGym(
  deps: Deps,
  viewer: SessionUser,
  input: { name: unknown; courts: unknown },
): Promise<Result<{ id: string }>> {
  if (!hasArea(viewer, "facilities")) return directorOnly;
  return run(async () => {
    const name = cleanPlaceName(input.name, "gym name");
    const list = Array.isArray(input.courts) ? input.courts : [];
    if (list.length < 1 || list.length > 12) throw new UserError("A gym needs 1 to 12 courts.");
    const courts = list.map((c) => cleanPlaceName(c, "court name"));
    if (new Set(courts.map((c) => c.toLowerCase())).size !== courts.length)
      throw new UserError("Each court needs a different name.");
    return withTx(deps.pool, async (q) => {
      // A gym that was removed but kept for its past practices (any capitals) comes back with these courts.
      const old = await q.query<{ id: string }>("select id::text from gyms where org = 'thunder' and lower(name) = lower($1) and not active for update", [name]);
      if (old.rows[0]) {
        await q.query("update gyms set active = true where id = $1", [old.rows[0].id]);
        await q.query("update courts set active = (name = any($2::text[])) where gym_id = $1", [old.rows[0].id, courts]);
        await q.query("insert into courts (gym_id, name) select $1, unnest($2::text[]) on conflict (gym_id, name) do nothing", [
          old.rows[0].id,
          courts,
        ]);
        return { id: old.rows[0].id };
      }
      const g = await q.query<{ id: string }>("insert into gyms (name) values ($1) on conflict (org, name) do nothing returning id::text", [
        name,
      ]);
      if (!g.rows[0]) throw new UserError(`There's already a gym named "${name}".`);
      await q.query("insert into courts (gym_id, name) select $1, unnest($2::text[])", [g.rows[0].id, courts]);
      return { id: g.rows[0].id };
    });
  });
}

// Delete a gym. Refused while any of its courts has an upcoming booked practice. A gym with past practices is kept
// (inactive, hidden) so practice history and attendance stay; its upcoming open slots and availability go.
// A gym that never had a practice is deleted with its courts, slots, blackouts and availability.
export async function deleteGym(deps: Deps, viewer: SessionUser, gymId: unknown): Promise<Result<{ kept: boolean }>> {
  if (!hasArea(viewer, "facilities")) return directorOnly;
  if (typeof gymId !== "string" || !/^\d{1,18}$/.test(gymId)) return { ok: false, message: "That gym no longer exists." };
  return run(() =>
    withTx(deps.pool, async (q) => {
      const g = await q.query<{ name: string }>("select name from gyms where id = $1 and active for update", [gymId]);
      if (!g.rows[0]) throw new UserError("That gym no longer exists.");
      const n = await q.query<{ upcoming: number; past: number }>(
        `select count(*) filter (where s.starts_at > $2)::int as upcoming, count(*) filter (where s.starts_at <= $2)::int as past
         from slots s join courts c on c.id = s.court_id where c.gym_id = $1 and s.team_id is not null`,
        [gymId, deps.now()],
      );
      const { upcoming, past } = n.rows[0];
      if (upcoming)
        throw new UserError(
          `${g.rows[0].name} has ${upcoming} upcoming booked practice${upcoming === 1 ? "" : "s"}. Release or move ${upcoming === 1 ? "it" : "them"} first.`,
        );
      if (!past) {
        await q.query("delete from gyms where id = $1", [gymId]);
        return { kept: false };
      }
      await q.query("delete from slots s using courts c where c.id = s.court_id and c.gym_id = $1 and s.starts_at > $2", [
        gymId,
        deps.now(),
      ]);
      await q.query(
        "delete from gym_availability where gym_id = $1 and day >= ($2::timestamptz at time zone 'America/New_York')::date",
        [gymId, deps.now()],
      );
      await q.query("update courts set active = false where gym_id = $1", [gymId]);
      await q.query("update gyms set active = false where id = $1", [gymId]);
      return { kept: true };
    }),
  );
}

// ---- Slots ----

// Is this Eastern date/time blacked out for this gym? Returns the reason ("" if none given) or null.
async function blackoutFor(q: PoolClient, gymId: string, isoDay: string, minuteOfDay: number): Promise<string | null> {
  const r = await q.query<{ reason: string | null }>(
    `select reason from blackouts where day = $1 and (gym_id is null or gym_id = $2) and (minute_of_day is null or minute_of_day = $3)
     order by gym_id nulls last, minute_of_day nulls last limit 1`,
    [isoDay, gymId, minuteOfDay],
  );
  return r.rows[0] ? (r.rows[0].reason ?? "") : null;
}

export type AddSlotsInput = { gymId: unknown; courtId: unknown; from: unknown; to: unknown; days: unknown; hours: unknown };

// Creates a 60-minute slot for each court × chosen day × start time. Existing ones are skipped;
// slots on blacked-out dates come in blocked.
export async function addSlots(
  deps: Deps,
  viewer: SessionUser,
  input: AddSlotsInput,
): Promise<Result<{ added: number; skipped: number; blocked: number }>> {
  if (!hasArea(viewer, "facilities")) return directorOnly;
  return run(async () => {
    if (!isId(input.gymId)) throw new UserError("Pick a gym.");
    const range = cleanRange(input.from, input.to);
    const days = Array.isArray(input.days) ? input.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : [];
    if (!days.length) throw new UserError("Pick at least one day.");
    const hours = Array.isArray(input.hours) ? input.hours.filter((h) => SLOT_HOURS.includes(h as number)) : [];
    if (!hours.length) throw new UserError("Pick at least one start time.");
    const gymId = input.gymId;
    return withTx(deps.pool, async (q) => {
      // Yearly blackouts for these years, so new slots on those dates come in blocked.
      const years = [...new Set(range.days.map((d) => d.y))];
      await materializeRules(q, years, deps.now());
      const courts = await q.query<{ id: string }>(
        input.courtId === "all"
          ? "select id::text from courts where gym_id = $1 and active order by name"
          : "select id::text from courts where gym_id = $1 and id = $2",
        input.courtId === "all" ? [gymId] : [gymId, isId(input.courtId) ? input.courtId : "0"],
      );
      if (!courts.rows.length) throw new UserError("Pick a court at that gym.");
      let added = 0;
      let skipped = 0;
      let blocked = 0;
      for (const day of range.days.filter((d) => days.includes(d.weekday)))
        for (const hour of hours as number[]) {
          const reason = await blackoutFor(q, gymId, day.iso, hour * 60);
          const startsAt = zonedTime(day.y, day.m, day.d, hour);
          for (const c of courts.rows) {
            const r = await q.query(
              `insert into slots (court_id, starts_at, blackout, note, booked_by, booked_at, created_by)
               values ($1, $2, $3, $4, $5, $6, $5) on conflict (court_id, starts_at) do nothing`,
              [c.id, startsAt, reason !== null, reason || null, by(viewer), reason !== null ? deps.now() : null],
            );
            if (!r.rowCount) skipped++;
            else {
              added++;
              if (reason !== null) blocked++;
            }
          }
        }
      return { added, skipped, blocked };
    });
  });
}

// Facilities → Availability (lib/facilities.ts): make a gym's practice slots on these dates match its Practice hours.
// `window(day)` is the day's Practice hours ("HH:MM"), or null when the day isn't Practice any more. Each goal (active
// court) gets a 60-minute slot at every hour that fits (6–9 PM → 6, 7, 8); blacked-out times come in blocked. Open slots
// outside the hours go. Booked practices are never removed: if any would be, nothing changes and `error` says so.
export async function syncPracticeSlots(
  q: PoolClient,
  gymId: string,
  days: string[],
  window: (day: string) => { starts: string; ends: string } | null,
  who: string,
  now: Date,
): Promise<{ added: number; removed: number } | { error: string }> {
  const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const courts = (await q.query<{ id: string }>("select id::text from courts where gym_id = $1 and active order by name", [gymId])).rows;
  const existing = await q.query<{ id: string; court_id: string; day: string; minute: number; team_id: string | null }>(
    `select s.id::text, s.court_id::text, to_char((s.starts_at at time zone 'America/New_York')::date, 'YYYY-MM-DD') as day,
            (extract(hour from s.starts_at at time zone 'America/New_York') * 60
             + extract(minute from s.starts_at at time zone 'America/New_York'))::int as minute, s.team_id::text
     from slots s join courts c on c.id = s.court_id
     where c.gym_id = $1 and c.active and (s.starts_at at time zone 'America/New_York')::date = any($2::date[])`,
    [gymId, days],
  );
  const wanted = new Map(
    days.map((d) => {
      const w = window(d);
      const list: number[] = [];
      if (w) for (let m = mins(w.starts); m + 60 <= mins(w.ends); m += 60) list.push(m);
      return [d, list];
    }),
  );
  const drop = existing.rows.filter((s) => !wanted.get(s.day)!.includes(s.minute));
  const booked = drop.filter((s) => s.team_id).length;
  if (booked)
    return {
      error: `${booked} booked practice${booked === 1 ? " falls" : "s fall"} outside those hours. Release or move ${booked === 1 ? "it" : "them"} first.`,
    };
  if (drop.length) await q.query("delete from slots where id = any($1::bigint[])", [drop.map((s) => s.id)]);
  const have = new Set(existing.rows.map((s) => `${s.court_id}|${s.day}|${s.minute}`));
  await materializeRules(q, [...new Set(days.map((d) => Number(d.slice(0, 4))))], now);
  let added = 0;
  for (const [day, list] of wanted)
    for (const m of list) {
      const reason = await blackoutFor(q, gymId, day, m);
      const startsAt = zonedTime(Number(day.slice(0, 4)), Number(day.slice(5, 7)), Number(day.slice(8, 10)), Math.floor(m / 60), m % 60);
      for (const c of courts) {
        if (have.has(`${c.id}|${day}|${m}`)) continue;
        const r = await q.query(
          `insert into slots (court_id, starts_at, blackout, note, booked_by, booked_at, created_by)
           values ($1, $2, $3, $4, $5, $6, $5) on conflict (court_id, starts_at) do nothing`,
          [c.id, startsAt, reason !== null, reason || null, who, reason !== null ? now : null],
        );
        added += r.rowCount ?? 0;
      }
    }
  return { added, removed: drop.length };
}

// ---- Blackouts ----

export type BlackoutInput = {
  mode: unknown;
  gymId: unknown;
  from: unknown;
  to: unknown;
  hour: unknown;
  reason: unknown;
  repeat?: unknown;
};

function cleanReason(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "";
  if (s && !/^[\p{L}\d][\p{L}\d .,'&()/-]{0,79}$/u.test(s))
    throw new UserError("Keep the reason to letters, numbers and simple punctuation.");
  return s || null;
}

// Block or restore a range. With repeat = "date" | "nth" | "last", blocking also saves a yearly rule
// (anchored on the From date, same number of days) and fills it in for future years.
export async function blackoutDates(
  deps: Deps,
  viewer: SessionUser,
  input: BlackoutInput,
): Promise<Result<{ slots: number; removed: RemovedBooking[]; rule: string | null }>> {
  if (!hasArea(viewer, "facilities")) return directorOnly;
  return run(async () => {
    const mode = input.mode === "block" || input.mode === "restore" ? input.mode : null;
    if (!mode) throw new UserError("Choose Block or Restore.");
    const range = cleanRange(input.from, input.to);
    const gymId = input.gymId === "all" ? null : isId(input.gymId) ? input.gymId : undefined;
    if (gymId === undefined) throw new UserError("Pick a gym.");
    const minute =
      input.hour === "all" ? null : SLOT_HOURS.includes(input.hour as number) ? (input.hour as number) * 60 : undefined;
    if (minute === undefined) throw new UserError("Pick a time.");
    const reason = cleanReason(input.reason);
    const repeat =
      input.repeat === "date" || input.repeat === "nth" || input.repeat === "last" ? (input.repeat as RuleKind) : null;
    if (repeat && range.days.length > 14) throw new UserError("A yearly blackout can cover up to 14 days.");
    const now = deps.now();
    const scope = { from: range.from, to: range.to, gymId, minute, now };

    return withTx(deps.pool, async (q) => {
      if (gymId) {
        const g = await q.query("select 1 from gyms where id = $1", [gymId]);
        if (!g.rows[0]) throw new UserError("That gym no longer exists.");
      }
      if (mode === "block") {
        const res = await blockScope(q, scope, { reason, by: by(viewer) });
        if (!repeat) return { ...res, rule: null };
        const spec = specFrom(range.from, repeat, range.days.length);
        const ruleId = await insertRule(q, spec, { gymId, minute, reason, by: by(viewer) });
        await q.query(
          "update blackouts set rule_id = $1 where day between $2 and $3 and coalesce(gym_id, 0) = coalesce($4::bigint, 0) and coalesce(minute_of_day, -1) = coalesce($5::int, -1)",
          [ruleId, range.from, range.to, gymId, minute],
        );
        const more = await materializeRules(q, await yearsToFill(q, now), now, ruleId);
        return { slots: res.slots + more.slots, removed: [...res.removed, ...more.removed], rule: describeRule(spec) };
      }

      // Restore. Restoring part of a wider blackout (one gym of "All Gyms", one time of "All Day") first splits it,
      // so the rest stays blacked out. Then remove the entries in scope and reopen slots no blackout still covers.
      if (gymId)
        await q.query(
          `insert into blackouts (day, gym_id, minute_of_day, reason, created_by, rule_id)
           select b.day, g.id, b.minute_of_day, b.reason, b.created_by, b.rule_id from blackouts b cross join (select id from gyms where org = 'thunder') g
           where b.gym_id is null and g.id <> $3 and b.day between $1 and $2 and ($4::int is null or b.minute_of_day = $4 or b.minute_of_day is null)
           on conflict (day, coalesce(gym_id, 0), coalesce(minute_of_day, -1)) do nothing`,
          [range.from, range.to, gymId, minute],
        );
      if (minute !== null)
        await q.query(
          `insert into blackouts (day, gym_id, minute_of_day, reason, created_by, rule_id)
           select b.day, b.gym_id, h * 60, b.reason, b.created_by, b.rule_id from blackouts b cross join unnest($5::int[]) h
           where b.minute_of_day is null and h * 60 <> $4 and b.day between $1 and $2 and ($3::bigint is null or b.gym_id is null or b.gym_id = $3)
           on conflict (day, coalesce(gym_id, 0), coalesce(minute_of_day, -1)) do nothing`,
          [range.from, range.to, gymId, minute, SLOT_HOURS],
        );
      await q.query(
        `delete from blackouts where day between $1 and $2 and ($3::bigint is null or gym_id = $3 or gym_id is null)
           and ($4::int is null or minute_of_day = $4 or minute_of_day is null)`,
        [range.from, range.to, gymId, minute],
      );
      return { slots: await reopenScope(q, scope), removed: [], rule: null };
    });
  });
}

export async function deleteBlackoutRule(
  deps: Deps,
  viewer: SessionUser,
  ruleId: unknown,
): Promise<Result<{ reopened: number }>> {
  if (!hasArea(viewer, "facilities")) return directorOnly;
  if (!isId(ruleId)) return { ok: false, message: "That yearly blackout no longer exists." };
  return run(() => withTx(deps.pool, async (q) => ({ reopened: await removeRule(q, ruleId, deps.now()) })));
}

// The Director's Block / Unblock on a single slot (no date record; just that slot).
export async function setSlotBlocked(
  deps: Deps,
  viewer: SessionUser,
  input: { slotId: unknown; blocked: unknown; reason?: unknown },
): Promise<Result<{ removed: string | null }>> {
  if (!hasArea(viewer, "facilities")) return directorOnly;
  if (!isId(input.slotId)) return { ok: false, message: "That practice slot no longer exists." };
  const slotId = input.slotId;
  return run(async () => {
    const reason = cleanReason(input.reason);
    return withTx(deps.pool, async (q) => {
      const s = await q.query<{ team: string | null; starts_at: Date }>(
        "select t.name as team, s.starts_at from slots s left join teams t on t.id = s.team_id where s.id = $1 for update of s",
        [slotId],
      );
      if (!s.rows[0]) throw new UserError("That practice slot no longer exists.");
      if (s.rows[0].starts_at <= deps.now()) throw new UserError("That practice time has already passed.");
      if (input.blocked === true) {
        await q.query(
          "update slots set blackout = true, team_id = null, note = $2, booked_by = $3, booked_at = $4 where id = $1",
          [slotId, reason, by(viewer), deps.now()],
        );
        return { removed: s.rows[0].team };
      }
      await q.query(
        "update slots set blackout = false, note = null, booked_by = null, booked_at = null where id = $1 and blackout",
        [slotId],
      );
      return { removed: null };
    });
  });
}

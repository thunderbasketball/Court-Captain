// A team's own practices (SPEC.md section 4, "Own gym practices"): a place the team found itself, not one of the
// organization's gyms, so any day and time, any length (15 minutes to 4 hours) and no booking limits. Optionally weekly
// (same weekday and time) until a date the coach picks; those weeks share a series so they can be removed together.
// Thunder's teams (teams) and every organization's teams (org_teams). Who adds or removes them: Thunder's Directors of
// Practices or Teams and the team's Head Coach, Assistant Coaches and Manager; another organization's Admins and
// Directors of Teams and the team's coaches. Checked here, on the server.
import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import type { SessionUser } from "./auth/service";
import { hasArea, orgHasArea } from "./org-admin";
import { withTx } from "./sql";
import { localParts, zonedTime } from "./time";

type Deps = { pool: Pool; now: () => Date };
type Q = Pick<PoolClient, "query">;
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

export type OwnPractice = {
  id: string;
  startsAt: Date;
  minutes: number;
  location: string;
  series: string | null; // weekly: the weeks it belongs to
  addedBy: string;
};

// The team: Thunder's ("thunder" + its teams id) or another organization's (its slug + its org_teams id).
export type TeamRef = { org: string; teamId: string };

const SLUG = /^[a-z0-9][a-z0-9-]{0,40}$/;
const ID = /^\d{1,18}$/;
const THUNDER_ROLES = ["HeadCoach", "AsstCoach", "Manager"];
export const MAX_WEEKS = 52;

function teamCol(ref: TeamRef): "thunder_team_id" | "org_team_id" {
  return ref.org === "thunder" ? "thunder_team_id" : "org_team_id";
}

function validRef(ref: TeamRef): boolean {
  return SLUG.test(String(ref.org)) && ID.test(String(ref.teamId));
}

// May this person add and remove the team's own practices?
export async function canChangeOwnPractices(q: Q, viewer: SessionUser, ref: TeamRef): Promise<boolean> {
  if (!validRef(ref)) return false;
  if (ref.org === "thunder") {
    const t = await q.query("select 1 from teams where id = $1", [ref.teamId]);
    if (!t.rows[0]) return false;
    if (hasArea(viewer, "practices", "teams")) return true;
    const r = await q.query("select 1 from team_staff where team_id = $1 and coach_id = $2 and role = any($3)", [
      ref.teamId,
      viewer.coachId,
      THUNDER_ROLES,
    ]);
    return !!r.rows[0];
  }
  const t = await q.query("select 1 from org_teams where id = $1 and org = $2", [ref.teamId, ref.org]);
  if (!t.rows[0]) return false;
  if (await orgHasArea(q, viewer.coachId, ref.org, "teams")) return true;
  const r = await q.query("select 1 from org_team_coaches where team_id = $1 and coach_id = $2", [ref.teamId, viewer.coachId]);
  return !!r.rows[0];
}

// The team's own practices that haven't ended yet, soonest first. The page shows them only after checking the person
// may see the team.
export async function upcomingOwnPractices(deps: Deps, ref: TeamRef, limit = 60): Promise<OwnPractice[]> {
  if (!validRef(ref)) return [];
  const r = await deps.pool.query<OwnPractice>(
    `select id::text, starts_at as "startsAt", minutes, location, series::text, added_by as "addedBy"
       from team_practices
      where org = $1 and ${teamCol(ref)} = $2 and starts_at + make_interval(mins => minutes) > $3
      order by starts_at limit $4`,
    [ref.org, ref.teamId, deps.now(), limit],
  );
  return r.rows;
}

// Places the team has used before, most used first (the Location field suggests them).
export async function ownPracticeLocations(deps: Pick<Deps, "pool">, ref: TeamRef): Promise<string[]> {
  if (!validRef(ref)) return [];
  const r = await deps.pool.query<{ location: string }>(
    `select location from team_practices where org = $1 and ${teamCol(ref)} = $2
      group by location order by count(*) desc, max(starts_at) desc limit 10`,
    [ref.org, ref.teamId],
  );
  return r.rows.map((x) => x.location);
}

export type OwnPracticeInput = {
  location: unknown;
  date: unknown; // "2026-11-16"
  time: unknown; // "18:00"
  minutes: unknown;
  weeklyUntil?: unknown; // "2027-02-28", or blank for just this one
};

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^(\d{2}):(\d{2})$/;

function parseDate(v: unknown): { y: number; m: number; d: number } | null {
  const x = DATE.exec(String(v ?? ""));
  if (!x) return null;
  const [y, m, d] = [Number(x[1]), Number(x[2]), Number(x[3])];
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? { y, m, d } : null;
}

// A place name: letters, numbers and simple punctuation, never starting like a formula.
export function cleanLocation(v: unknown): string | null {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  if (!s || s.length > 80 || /^[=+\-@]/.test(s) || !/^[\p{L}\p{N} .,'&#()/:-]+$/u.test(s)) return null;
  return s;
}

const by = (v: SessionUser) => `${v.firstName} ${v.lastName}`;

// Add one practice, or one every week until the chosen date. Weeks already holding a practice at that time are skipped.
export async function addOwnPractice(
  deps: Deps,
  viewer: SessionUser,
  ref: TeamRef,
  input: OwnPracticeInput,
): Promise<Result<{ added: Date[]; skipped: Date[] }>> {
  const location = cleanLocation(input.location);
  if (!location) return { ok: false, message: "Enter the place (letters and numbers, up to 80 characters)." };
  const day = parseDate(input.date);
  if (!day) return { ok: false, message: "Pick the date." };
  const tm = TIME.exec(String(input.time ?? ""));
  const hour = tm ? Number(tm[1]) : -1;
  const minute = tm ? Number(tm[2]) : -1;
  if (!tm || hour > 23 || minute > 59) return { ok: false, message: "Pick the start time." };
  const minutes = Number(input.minutes);
  if (!Number.isInteger(minutes) || minutes < 15 || minutes > 240)
    return { ok: false, message: "The length must be between 15 minutes and 4 hours." };
  const first = zonedTime(day.y, day.m, day.d, hour, minute);
  if (first.getTime() + minutes * 60_000 <= deps.now().getTime()) return { ok: false, message: "That time has already passed." };

  // Its weeks: the same weekday and Eastern time each week, through the last date.
  const starts = [first];
  const untilRaw = String(input.weeklyUntil ?? "").trim();
  if (untilRaw) {
    const until = parseDate(untilRaw);
    if (!until) return { ok: false, message: "Pick the last date for the weekly practice." };
    const end = Date.UTC(until.y, until.m - 1, until.d);
    if (end < Date.UTC(day.y, day.m - 1, day.d)) return { ok: false, message: "The last date must be on or after the first." };
    for (let w = 1; ; w++) {
      const d = new Date(Date.UTC(day.y, day.m - 1, day.d + 7 * w));
      if (d.getTime() > end) break;
      if (w >= MAX_WEEKS) return { ok: false, message: `A weekly practice can run up to ${MAX_WEEKS} weeks.` };
      starts.push(zonedTime(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), hour, minute));
    }
  }
  const series = starts.length > 1 ? randomUUID() : null;

  return withTx(deps.pool, async (q) => {
    if (!(await canChangeOwnPractices(q, viewer, ref)))
      return { ok: false as const, message: "Only the team's coaches and the Directors can add its practices." };
    const added: Date[] = [];
    const skipped: Date[] = [];
    for (const s of starts) {
      const r = await q.query(
        `insert into team_practices (org, ${teamCol(ref)}, location, starts_at, minutes, series, added_by)
         values ($1, $2, $3, $4, $5, $6, $7) on conflict do nothing`,
        [ref.org, ref.teamId, location, s, minutes, series, by(viewer)],
      );
      (r.rowCount ? added : skipped).push(s);
    }
    return { ok: true as const, added, skipped };
  });
}

// Remove one practice, or it and the later weeks of its weekly practice. Practices already over stay (their history).
export async function removeOwnPractice(
  deps: Deps,
  viewer: SessionUser,
  ref: TeamRef,
  id: unknown,
  laterWeeks: boolean,
): Promise<Result<{ removed: number }>> {
  if (!ID.test(String(id ?? ""))) return { ok: false, message: "That practice wasn't found." };
  if (!validRef(ref)) return { ok: false, message: "That practice wasn't found." };
  return withTx(deps.pool, async (q) => {
    if (!(await canChangeOwnPractices(q, viewer, ref)))
      return { ok: false as const, message: "Only the team's coaches and the Directors can remove its practices." };
    const p = (
      await q.query<{ starts_at: Date; minutes: number; series: string | null }>(
        `select starts_at, minutes, series::text from team_practices where id = $1 and org = $2 and ${teamCol(ref)} = $3 for update`,
        [id, ref.org, ref.teamId],
      )
    ).rows[0];
    if (!p) return { ok: false as const, message: "That practice wasn't found." };
    if (p.starts_at.getTime() + p.minutes * 60_000 <= deps.now().getTime())
      return { ok: false as const, message: "That practice is over; it stays on the team's history." };
    const r =
      laterWeeks && p.series
        ? await q.query("delete from team_practices where series = $1 and starts_at >= $2", [p.series, p.starts_at])
        : await q.query("delete from team_practices where id = $1", [id]);
    return { ok: true as const, removed: r.rowCount ?? 0 };
  });
}

// "Mondays": the weekday a weekly practice repeats on, Eastern.
export function weekdayOf(d: Date): string {
  return ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"][localParts(d).weekday];
}

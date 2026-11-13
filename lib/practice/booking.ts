// Booking and releasing practice slots, with the team limits.
//
// Limit (per team, per Mon–Fri week; N = the team's upcoming practices that week):
//   N = 0 → allowed.
//   N = 1 → allowed only if the new slot starts within 72 hours from now (the "extra").
//   N ≥ 2 → refused.
// The Director is exempt (but not when booking from a team's view). Blackouts never count. Everything runs in one transaction per request,
// with the team locked, so two people booking at once can't push a team over.
import type { Pool, PoolClient } from "pg";
import type { SessionUser } from "../auth/service";
import { withTx } from "../sql";
import { localParts, weekOf } from "../time";
import { hasArea } from "../org-admin";

export const PRACTICE_MINUTES = 60;
export const EXTRA_HOURS = 72;
const BOOKING_ROLES = ["HeadCoach", "AsstCoach", "Manager"];

type Deps = { pool: Pool; now: () => Date };
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };
class UserError extends Error {}

// The rule on its own, so the screen can show the same message before anyone taps Book.
export function limitCheck(upcomingThatWeek: number, startsAt: Date, now: Date): { ok: true } | { ok: false; reason: string } {
  if (upcomingThatWeek === 0) return { ok: true };
  if (upcomingThatWeek >= 2) return { ok: false, reason: "The team already has 2 practices that week." };
  if (startsAt.getTime() - now.getTime() <= EXTRA_HOURS * 3_600_000) return { ok: true };
  return { ok: false, reason: "The team already has a practice that week. A second one can only be booked within 72 hours of the start." };
}

// Practices that haven't finished yet (start + 60 minutes is still ahead).
export async function upcomingInWeek(q: Pick<PoolClient, "query">, teamId: string, startsAt: Date, now: Date): Promise<number> {
  const w = weekOf(startsAt);
  const r = await q.query<{ n: number }>(
    `select count(*)::int as n from slots
     where team_id = $1 and starts_at >= $2 and starts_at < $3 and starts_at + make_interval(mins => $5) > $4`,
    [teamId, w.start, w.end, now, PRACTICE_MINUTES],
  );
  return r.rows[0].n;
}

async function canBookFor(q: PoolClient, viewer: SessionUser, teamId: string): Promise<boolean> {
  if (hasArea(viewer, "practices")) return true;
  const r = await q.query("select 1 from team_staff where team_id = $1 and coach_id = $2 and role = any($3)", [
    teamId,
    viewer.coachId,
    BOOKING_ROLES,
  ]);
  return !!r.rows[0];
}

type SlotRow = { id: string; court_id: string; starts_at: Date; team_id: string | null; blackout: boolean };

async function lockSlot(q: PoolClient, id: string): Promise<SlotRow | null> {
  const r = await q.query<SlotRow>(
    "select id::text, court_id::text, starts_at, team_id::text, blackout from slots where id = $1 for update",
    [id],
  );
  return r.rows[0] ?? null;
}

// Later slots on the same court, same weekday and wall-clock time ("every future week").
async function sameSlotLaterWeeks(q: PoolClient, s: SlotRow): Promise<string[]> {
  const p = localParts(s.starts_at);
  const r = await q.query<{ id: string; starts_at: Date }>(
    "select id::text, starts_at from slots where court_id = $1 and starts_at > $2 order by starts_at",
    [s.court_id, s.starts_at],
  );
  return r.rows
    .filter((x) => {
      const o = localParts(x.starts_at);
      return o.weekday === p.weekday && o.hour === p.hour && o.minute === p.minute;
    })
    .map((x) => x.id);
}

export type WeekOutcome = { slotId: string; startsAt: Date; reason?: string };
export type BookResult = Result<{ booked: WeekOutcome[]; skipped: WeekOutcome[]; warnings: string[] }>;

const by = (v: SessionUser) => `${v.firstName} ${v.lastName}`;

export async function bookSlot(
  deps: Deps,
  viewer: SessionUser,
  input: { slotId: unknown; teamId: unknown; everyWeek?: unknown; asTeam?: unknown },
): Promise<BookResult> {
  const slotId = String(input.slotId ?? "");
  const teamId = String(input.teamId ?? "");
  if (!/^\d{1,18}$/.test(slotId) || !/^\d{1,18}$/.test(teamId)) return { ok: false, message: "Pick a practice slot and a team." };
  const now = deps.now();
  // The Director is exempt, except when booking from a team's view (they see and book it as a coach would).
  const exempt = hasArea(viewer, "practices") && input.asTeam !== true;
  try {
    return await withTx(deps.pool, async (q) => {
      const team = await q.query<{ locations: string[]; set: boolean }>(
        "select practice_locations as locations, practice_gyms_set or practice_locations <> '{}' as set from teams where id = $1",
        [teamId],
      );
      if (!team.rows[0]) throw new UserError("That team no longer exists.");
      // One booking request per team at a time, so counts can't race.
      await q.query("select pg_advisory_xact_lock(hashtext('team-book:' || $1))", [teamId]);
      if (!(await canBookFor(q, viewer, teamId)))
        throw new UserError("Only a Director of Facilities or this team's coaches and manager can book its practices.");

      const first = await lockSlot(q, slotId);
      if (!first) throw new UserError("That practice slot no longer exists.");
      // The team's practice facilities (Facilities → Team Practice Facilities; never set = every gym; set with none = own gym only). The Director's
      // own grid may book a team anywhere.
      const gyms = team.rows[0].locations.map((l) => l.toLowerCase());
      const atTeamGym = async (courtId: string) => {
        if (exempt || !team.rows[0].set) return true;
        const g = await q.query<{ name: string }>("select g.name from courts c join gyms g on g.id = c.gym_id where c.id = $1", [courtId]);
        return !!g.rows[0] && gyms.includes(g.rows[0].name.toLowerCase());
      };
      const targets = [first.id, ...(input.everyWeek === true ? await sameSlotLaterWeeks(q, first) : [])];

      const booked: WeekOutcome[] = [];
      const skipped: WeekOutcome[] = [];
      const warnings: string[] = [];
      for (const id of targets) {
        const s = id === first.id ? first : await lockSlot(q, id);
        if (!s) continue;
        const skip = (reason: string) => {
          if (id === first.id) throw new UserError(reason);
          skipped.push({ slotId: id, startsAt: s.starts_at, reason });
        };
        if (s.starts_at <= now) {
          skip("That practice time has already started.");
          continue;
        }
        if (s.blackout) {
          skip("That time is blacked out.");
          continue;
        }
        if (!(await atTeamGym(s.court_id))) {
          skip("That gym isn't one of this team's practice facilities.");
          continue;
        }
        if (s.team_id === teamId) {
          skip("The team already has this practice.");
          continue;
        }
        if (s.team_id) {
          skip("Another team already booked it.");
          continue;
        }
        const check = limitCheck(await upcomingInWeek(q, teamId, s.starts_at, now), s.starts_at, now);
        if (!check.ok) {
          if (!exempt) {
            skip(check.reason);
            continue;
          }
          warnings.push(`${s.starts_at.toISOString()}: over the team limit (${check.reason})`);
        }
        await q.query("update slots set team_id = $2, booked_by = $3, booked_at = $4 where id = $1", [id, teamId, by(viewer), now]);
        booked.push({ slotId: id, startsAt: s.starts_at });
      }
      return { ok: true as const, booked, skipped, warnings };
    });
  } catch (e) {
    if (e instanceof UserError) return { ok: false, message: e.message };
    throw e;
  }
}

export async function releaseSlot(
  deps: Deps,
  viewer: SessionUser,
  input: { slotId: unknown; everyWeek?: unknown },
): Promise<Result<{ released: number }>> {
  const slotId = String(input.slotId ?? "");
  if (!/^\d{1,18}$/.test(slotId)) return { ok: false, message: "Pick a practice slot." };
  const now = deps.now();
  try {
    return await withTx(deps.pool, async (q) => {
      const first = await lockSlot(q, slotId);
      if (!first) throw new UserError("That practice slot no longer exists.");
      if (!first.team_id) throw new UserError("That slot isn't booked.");
      const teamId = first.team_id;
      await q.query("select pg_advisory_xact_lock(hashtext('team-book:' || $1))", [teamId]);
      if (!(await canBookFor(q, viewer, teamId)))
        throw new UserError("Only a Director of Facilities or this team's coaches and manager can release its practices.");
      if (first.starts_at <= now) throw new UserError("That practice has already started.");

      const ids = [first.id, ...(input.everyWeek === true ? await sameSlotLaterWeeks(q, first) : [])];
      const r = await q.query(
        "update slots set team_id = null, booked_by = null, booked_at = null where id = any($1) and team_id = $2 and starts_at > $3",
        [ids, teamId, now],
      );
      return { ok: true as const, released: r.rowCount ?? 0 };
    });
  } catch (e) {
    if (e instanceof UserError) return { ok: false, message: e.message };
    throw e;
  }
}

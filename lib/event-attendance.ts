// Attendance on a team's events (SPEC.md section 12, "Team events attendance"): its booked practices (slots), own-gym
// practices, League games and scrimmages, for Thunder's teams and every organization's.
//   Attendance (✓ here / ✗ absent): only the team's staff and the Directors who manage its teams, from 15 minutes before
//     the start until 24 hours after it.
//   Intention (✓ coming / ✗ not coming): only the player's parent (their cell is parent 1 or 2 on the registration),
//     until the event starts. Thunder's teams (other organizations' rosters have no parents).
// A game without a time yet counts as its whole day. Booked practices keep their staff marks in practice_attendance
// (the Events check-in uses the same ones and the same hours).
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { hasArea, orgHasArea } from "./org-admin";
import { zonedTime } from "./time";

type Deps = { pool: Pool; now: () => Date };
type Q = Pick<Pool, "query">;
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

export type EventKind = "slot" | "own" | "game" | "scrimmage";
export const EVENT_KINDS: readonly EventKind[] = ["slot", "own", "game", "scrimmage"];
export type TeamRef = { org: string; teamId: string };
export type Mark = "unknown" | "here" | "absent";
export type Rsvp = "yes" | "no";
export type EventPlayer = {
  player: string;
  firstName: string;
  lastName: string;
  status: Mark;
  statusBy: string | null;
  rsvp: Rsvp | null;
  rsvpBy: string | null;
};

export const OPENS_BEFORE_MINUTES = 15;
export const CLOSES_AFTER_HOURS = 24;
const MIN = 60_000;
const DAY = 86_400_000;

// When an event starts; "timed" is false for a game whose time isn't set yet (then it counts as its whole day, from
// midnight Eastern).
export type When = { start: Date; timed: boolean };

// Parents answer until the start; staff mark from 15 minutes before it until 24 hours after.
export function eventHours(w: When) {
  const dayEnd = new Date(w.start.getTime() + DAY);
  return {
    rsvpCloses: w.timed ? w.start : dayEnd,
    markOpens: w.timed ? new Date(w.start.getTime() - OPENS_BEFORE_MINUTES * MIN) : w.start,
    markCloses: new Date((w.timed ? w.start : dayEnd).getTime() + CLOSES_AFTER_HOURS * 3_600_000),
  };
}

// Why attendance can't be marked right now, or null when it can.
export function markClosed(w: When, now: Date): string | null {
  const h = eventHours(w);
  if (now < h.markOpens) return `Attendance opens ${w.timed ? `${OPENS_BEFORE_MINUTES} minutes before the start` : "on the day"}.`;
  if (now > h.markCloses) return `Attendance closed ${CLOSES_AFTER_HOURS} hours after the event.`;
  return null;
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,40}$/;
const ID = /^\d{1,18}$/;
const PLAYER = /^[A-Za-z0-9_-]{1,40}$/;
const thunder = (ref: TeamRef) => ref.org === "thunder";
const teamKey = (ref: TeamRef) => `${thunder(ref) ? "t" : "o"}${ref.teamId}`;
const valid = (ref: TeamRef, kind: unknown, eventId: unknown) =>
  SLUG.test(String(ref.org)) &&
  ID.test(String(ref.teamId)) &&
  EVENT_KINDS.includes(kind as EventKind) &&
  ID.test(String(eventId)) &&
  (kind !== "slot" || thunder(ref)); // booked practices are Thunder's gyms

// The team's staff (any role) and the Directors who manage its teams take attendance.
export async function takesAttendance(q: Q, viewer: SessionUser, ref: TeamRef): Promise<boolean> {
  if (!SLUG.test(String(ref.org)) || !ID.test(String(ref.teamId))) return false;
  if (thunder(ref)) {
    const r = await q.query<{ staff: boolean }>(
      `select exists (select 1 from team_staff s where s.team_id = t.id and s.coach_id = $2) as staff from teams t where t.id = $1`,
      [ref.teamId, viewer.coachId],
    );
    return !!r.rows[0] && (r.rows[0].staff || hasArea(viewer, "teams", "practices"));
  }
  const r = await q.query<{ coach: boolean }>(
    `select exists (select 1 from org_team_coaches c where c.team_id = t.id and c.coach_id = $3) as coach
       from org_teams t where t.id = $1 and t.org = $2`,
    [ref.teamId, ref.org, viewer.coachId],
  );
  return !!r.rows[0] && (r.rows[0].coach || (await orgHasArea(q, viewer.coachId, ref.org, "teams")));
}

// When the team's event starts; null when it isn't the team's.
export async function eventWhen(q: Q, ref: TeamRef, kind: EventKind, eventId: string): Promise<When | null> {
  const col = thunder(ref) ? "thunder_team_id" : "org_team_id";
  if (kind === "game") {
    const r = await q.query<{ day: string; starts: string | null }>(
      `select m.day::text as day, to_char(m.starts, 'HH24:MI') as starts
         from scenic_matchups m join scenic_teams s on s.id in (m.team_a, m.team_b) where m.id = $1 and s.${col} = $2`,
      [eventId, ref.teamId],
    );
    const g = r.rows[0];
    if (!g) return null;
    const [y, mo, d] = g.day.split("-").map(Number);
    const [hh, mm] = (g.starts ?? "00:00").split(":").map(Number);
    return { start: zonedTime(y, mo, d, hh, mm), timed: !!g.starts };
  }
  if (kind === "scrimmage") {
    const r = await q.query<{ starts_at: Date }>(
      `select starts_at from scrimmages where id = $1 and org = $2 and $3::bigint in (home_${col}, away_${col})`,
      [eventId, ref.org, ref.teamId],
    );
    return r.rows[0] ? { start: r.rows[0].starts_at, timed: true } : null;
  }
  const r =
    kind === "slot"
      ? await q.query<{ starts_at: Date }>("select starts_at from slots where id = $1 and team_id = $2", [eventId, ref.teamId])
      : await q.query<{ starts_at: Date }>(`select starts_at from team_practices where id = $1 and org = $2 and ${col} = $3`, [
          eventId,
          ref.org,
          ref.teamId,
        ]);
  return r.rows[0] ? { start: r.rows[0].starts_at, timed: true } : null;
}

// The team's roster for one event, by last name: each player's mark and their parent's answer. Null when this person
// doesn't take the team's attendance or the event isn't the team's.
export async function eventRoster(
  deps: Deps,
  viewer: SessionUser,
  ref: TeamRef,
  kind: unknown,
  eventId: unknown,
): Promise<{ players: EventPlayer[]; closed: string | null } | null> {
  if (!valid(ref, kind, eventId)) return null;
  const k = kind as EventKind;
  const id = String(eventId);
  if (!(await takesAttendance(deps.pool, viewer, ref))) return null;
  const when = await eventWhen(deps.pool, ref, k, id);
  if (!when) return null;
  const roster = thunder(ref)
    ? `select registrant_id as player, first_name, last_name from team_players where team_id = $1`
    : `select id::text as player, first_name, last_name from org_team_players where team_id = $1`;
  const marks =
    k === "slot"
      ? `select registrant_id as player, status, updated_by as by from practice_attendance where slot_id = $2 and team_id = $1`
      : `select player, status, status_by as by from event_attendance where kind = $3 and event_id = $2 and team = $4`;
  const r = await deps.pool.query<EventPlayer>(
    `select p.player, p.first_name as "firstName", p.last_name as "lastName",
            coalesce(m.status, 'unknown') as status, m.by as "statusBy", e.rsvp, e.rsvp_by as "rsvpBy"
       from (${roster}) p
       left join (${marks}) m on m.player = p.player
       left join event_attendance e on e.kind = $3 and e.event_id = $2 and e.team = $4 and e.player = p.player
      order by lower(p.last_name), lower(p.first_name)`,
    [ref.teamId, id, k, teamKey(ref)],
  );
  return { players: r.rows, closed: markClosed(when, deps.now()) };
}

// Mark one player ✓ here, ✗ absent, or clear it ("unknown"). Who marked it is recorded.
export async function setEventMark(
  deps: Deps,
  viewer: SessionUser,
  ref: TeamRef,
  input: { kind: unknown; eventId: unknown; player: unknown; status: unknown },
): Promise<Result> {
  const { kind, eventId, player, status } = input;
  if (!valid(ref, kind, eventId) || typeof player !== "string" || !PLAYER.test(player))
    return { ok: false, message: "That player isn't on this team." };
  if (status !== "unknown" && status !== "here" && status !== "absent") return { ok: false, message: "Unknown status." };
  const k = kind as EventKind;
  const id = String(eventId);
  if (!(await takesAttendance(deps.pool, viewer, ref))) return { ok: false, message: "Only the team's staff can mark attendance." };
  const when = await eventWhen(deps.pool, ref, k, id);
  if (!when) return { ok: false, message: "That event isn't this team's." };
  const closed = markClosed(when, deps.now());
  if (closed) return { ok: false, message: closed };
  const onTeam = thunder(ref)
    ? await deps.pool.query("select 1 from team_players where team_id = $1 and registrant_id = $2", [ref.teamId, player])
    : await deps.pool.query("select 1 from org_team_players where team_id = $1 and id::text = $2", [ref.teamId, player]);
  if (!onTeam.rows[0]) return { ok: false, message: "That player isn't on this team." };
  const clear = status === "unknown";
  const by = clear ? null : `${viewer.firstName} ${viewer.lastName}`;
  const at = clear ? null : deps.now();
  if (k === "slot")
    await deps.pool.query(
      `insert into practice_attendance (slot_id, team_id, registrant_id, status, updated_by, updated_at) values ($1, $2, $3, $4, $5, $6)
       on conflict (slot_id, team_id, registrant_id) do update
         set status = excluded.status, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      [id, ref.teamId, player, status, by, at],
    );
  else
    await deps.pool.query(
      `insert into event_attendance (kind, event_id, team, player, status, status_by, status_at) values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (kind, event_id, team, player) do update
         set status = excluded.status, status_by = excluded.status_by, status_at = excluded.status_at`,
      [k, id, teamKey(ref), player, status, by, at],
    );
  return { ok: true };
}

// ---- Parents: whether their player plans to come ----

// The viewer's own children on this team's roster (Thunder: their cell is parent 1 or 2 on the registration).
export async function myPlayers(q: Q, viewer: SessionUser, ref: TeamRef): Promise<{ player: string; firstName: string }[]> {
  if (!thunder(ref) || !ID.test(String(ref.teamId))) return [];
  const r = await q.query<{ player: string; firstName: string }>(
    `select p.registrant_id as player, p.first_name as "firstName"
       from team_players p join registrations g on g.registrant_id = p.registrant_id join users u on u.coach_id = $2
      where p.team_id = $1 and u.cell in (g.parent1_cell, g.parent2_cell)
      order by lower(p.first_name)`,
    [ref.teamId, viewer.coachId],
  );
  return r.rows;
}

// Each listed event's answers for these players: { "<kind><id>": { "<player>": "yes" | "no" } }.
export async function rsvpsFor(
  q: Q,
  ref: TeamRef,
  events: { kind: EventKind; id: string }[],
  players: string[],
): Promise<Record<string, Record<string, Rsvp>>> {
  if (!events.length || !players.length) return {};
  const r = await q.query<{ kind: string; event_id: string; player: string; rsvp: Rsvp }>(
    `select kind, event_id::text, player, rsvp from event_attendance
      where team = $1 and player = any($2) and rsvp is not null and (kind || event_id::text) = any($3)`,
    [teamKey(ref), players, events.map((e) => `${e.kind}${e.id}`)],
  );
  const out: Record<string, Record<string, Rsvp>> = {};
  for (const x of r.rows) (out[`${x.kind}${x.event_id}`] ??= {})[x.player] = x.rsvp;
  return out;
}

// A parent answers for their player (yes, no, or null to clear), until the event starts.
export async function setRsvp(
  deps: Deps,
  viewer: SessionUser,
  ref: TeamRef,
  input: { kind: unknown; eventId: unknown; player: unknown; rsvp: unknown },
): Promise<Result> {
  const { kind, eventId, player, rsvp } = input;
  if (!valid(ref, kind, eventId) || typeof player !== "string" || !PLAYER.test(player))
    return { ok: false, message: "That player isn't on this team." };
  if (rsvp !== "yes" && rsvp !== "no" && rsvp !== null) return { ok: false, message: "Pick ✓ or ✗." };
  const k = kind as EventKind;
  const id = String(eventId);
  if (!(await myPlayers(deps.pool, viewer, ref)).some((p) => p.player === player))
    return { ok: false, message: "Only the player's parent can answer." };
  const when = await eventWhen(deps.pool, ref, k, id);
  if (!when) return { ok: false, message: "That event isn't this team's." };
  if (deps.now() >= eventHours(when).rsvpCloses) return { ok: false, message: "Answers close when the event starts." };
  await deps.pool.query(
    `insert into event_attendance (kind, event_id, team, player, rsvp, rsvp_by, rsvp_at) values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (kind, event_id, team, player) do update set rsvp = excluded.rsvp, rsvp_by = excluded.rsvp_by, rsvp_at = excluded.rsvp_at`,
    [k, id, teamKey(ref), player, rsvp, rsvp ? `${viewer.firstName} ${viewer.lastName}` : null, rsvp ? deps.now() : null],
  );
  return { ok: true };
}

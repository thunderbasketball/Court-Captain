// Events with player check-in (SPEC.md section 12). The Director creates an event, picks the players expected
// (by gender and grade) and who runs check-in. Those people, and the Director, mark each player ? / ✓ / ✗.
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { withTx } from "./sql";
import { GENDER_CHOICES, eventName, genderChoiceOf, gendersOf } from "./event-names";
import { GRADES } from "./team-names";
import { zonedTime } from "./time";
import { hasArea } from "./org-admin";

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

export const STATUSES = ["unknown", "here", "absent"] as const;
export type Status = (typeof STATUSES)[number];
const GENDERS = ["Boys", "Girls"];

const by = (v: SessionUser) => `${v.firstName} ${v.lastName}`;
const directorOnly = { ok: false as const, message: "Only a Director of Programs can manage events." };
const isId = (v: unknown): v is string => typeof v === "string" && /^\d{1,18}$/.test(v);
const pick = (v: unknown, allowed: readonly string[]) => (Array.isArray(v) ? allowed.filter((a) => v.includes(a)) : []);

export type PlayerFilter = { genders?: unknown; grades?: unknown };

// Players matching the filter, from the current registrations.
// g and gr are the query's placeholders for the genders and grades lists.
const matching = (g: string, gr: string) => `
  select registrant_id, first_name, last_name, gender, grade, grade_sort from registrations
  where gender = any(${g}::text[]) and grade = any(${gr}::text[])`;

export async function countMatching(deps: Deps, viewer: SessionUser, f: PlayerFilter): Promise<number> {
  if (!hasArea(viewer, "events")) return 0;
  const r = await deps.pool.query<{ n: number }>(`select count(*)::int as n from (${matching("$1", "$2")}) m`, [
    pick(f.genders, GENDERS),
    pick(f.grades, GRADES),
  ]);
  return r.rows[0].n;
}

export type EventInput = {
  kind: unknown; // an event type, e.g. "Tryouts"
  gender: unknown; // Boys, Girls or Coed
  grades: unknown;
  date: unknown; // YYYY-MM-DD
  time: unknown; // HH:MM, 24-hour, Eastern
  location?: unknown;
  notes?: unknown;
  staff?: unknown; // coach IDs who run check-in
  programId?: unknown; // the player program it's a Session of (default: Thunder's current one)
  signupOpens?: unknown; // Tryouts: when players can join its list (free), YYYY-MM-DD; optional
  signupCloses?: unknown;
};

function cleanInput(input: EventInput) {
  const text = (v: unknown, max: number) =>
    typeof v === "string"
      ? v
          .replace(/\r\n/g, "\n")
          .trim()
          .slice(0, max + 1)
      : "";
  const kind = typeof input.kind === "string" ? input.kind.trim() : "";
  if (!kind) throw new UserError("Pick an event type.");
  const gender = GENDER_CHOICES.find((g) => g === input.gender);
  if (!gender) throw new UserError("Pick Boys, Girls, or Coed.");
  const date = typeof input.date === "string" ? input.date.match(/^(\d{4})-(\d{2})-(\d{2})$/) : null;
  const time = typeof input.time === "string" ? input.time.match(/^([01]\d|2[0-3]):([0-5]\d)$/) : null;
  if (!date) throw new UserError("Pick a date.");
  if (!time) throw new UserError("Pick a start time.");
  const startsAt = zonedTime(+date[1], +date[2], +date[3], +time[1], +time[2]);
  const location = text(input.location, 80).replace(/\s+/g, " ");
  if (location.length > 80) throw new UserError("Keep the location to 80 characters.");
  const notes = text(input.notes, 1000);
  if (notes.length > 1000) throw new UserError("Keep the notes to 1,000 characters.");
  const genders = gendersOf(gender);
  const grades = pick(input.grades, GRADES);
  if (!grades.length) throw new UserError("Pick at least one grade.");
  const day = (v: unknown, what: string) => {
    if (v === undefined || v === null || v === "") return null;
    if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new UserError(`Check the ${what} date.`);
    return v;
  };
  const tryout = /^tryouts?$/i.test(kind);
  const signupOpens = tryout ? day(input.signupOpens, "sign-up opens") : null;
  const signupCloses = tryout ? day(input.signupCloses, "sign-up closes") : null;
  if (signupOpens && signupCloses && signupCloses < signupOpens) throw new UserError("Sign-up can't close before it opens.");
  if (input.programId !== undefined && input.programId !== null && input.programId !== "" && !isId(input.programId))
    throw new UserError("That program no longer exists.");
  const programId = isId(input.programId) ? input.programId : null;
  const staff = Array.isArray(input.staff)
    ? [...new Set(input.staff.filter((s): s is string => typeof s === "string" && /^\d{7}$/.test(s)))]
    : [];
  return {
    kind,
    name: eventName(kind, gender, grades),
    startsAt,
    location: location || null,
    notes: notes || null,
    genders,
    grades,
    staff,
    signupOpens,
    signupCloses,
    programId,
  };
}

export async function createEvent(deps: Deps, viewer: SessionUser, input: EventInput): Promise<Result<{ id: string; players: number }>> {
  if (!hasArea(viewer, "events")) return directorOnly;
  return run(async () => {
    const e = cleanInput(input);
    return withTx(deps.pool, async (q) => {
      const t = await q.query<{ name: string }>("select name from event_types where lower(name) = lower($1)", [e.kind]);
      if (!t.rows[0]) throw new UserError("That event type no longer exists. Pick again.");
      e.kind = t.rows[0].name;
      e.name = eventName(e.kind, genderChoiceOf(e.genders)!, e.grades);
      const ok = await q.query<{ coach_id: string }>("select coach_id from users where active and coach_id = any($1)", [e.staff]);
      if (ok.rows.length !== e.staff.length) throw new UserError("One of the check-in people is no longer active. Pick again.");
      // A Session of the program picked (Thunder's), or else Thunder's current program (the latest by its season).
      const prog = await q.query<{ id: string }>(
        `select id::text from player_programs where org = 'thunder' and ($1::bigint is null or id = $1::bigint)
         order by coalesce(starts_on, reg_opens) desc, id desc limit 1`,
        [e.programId],
      );
      if (e.programId && !prog.rows[0]) throw new UserError("That program no longer exists.");
      const programId = prog.rows[0]?.id ?? null;
      const ins = await q.query<{ id: string }>(
        `insert into events (name, kind, starts_at, location, notes, genders, grades, created_by, created_at, program_id,
                             signup_opens, signup_closes)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         returning id::text`,
        [e.name, e.kind, e.startsAt, e.location, e.notes, e.genders, e.grades, by(viewer), deps.now(), programId, e.signupOpens, e.signupCloses],
      );
      const id = ins.rows[0].id;
      await q.query("insert into event_staff (event_id, coach_id, added_by) select $1, unnest($2::text[]), $3", [id, e.staff, by(viewer)]);
      const added = await addMatching(q, id, e.genders, e.grades, programId);
      return { id, players: added };
    });
  });
}

// The players expected: registrations matching the genders and grades (in the session's program, when it has one).
async function addMatching(
  q: Pick<Pool, "query">,
  eventId: string,
  genders: string[],
  grades: string[],
  programId: string | null = null,
): Promise<number> {
  const r = await q.query(
    `insert into event_attendees (event_id, registrant_id, first_name, last_name, gender, grade, grade_sort)
     select $1, m.registrant_id, m.first_name, m.last_name, m.gender, m.grade, m.grade_sort
     from (${matching("$2", "$3")} and ($4::bigint is null or program_id = $4::bigint)) m
     on conflict do nothing`,
    [eventId, genders, grades, programId],
  );
  return r.rowCount ?? 0;
}

// Director: add players who registered (or changed grade) since the list was made. Never removes anyone.
export async function refreshPlayers(deps: Deps, viewer: SessionUser, eventId: unknown): Promise<Result<{ added: number }>> {
  if (!hasArea(viewer, "events")) return directorOnly;
  if (!isId(eventId)) return { ok: false, message: "That event no longer exists." };
  return run(() =>
    withTx(deps.pool, async (q) => {
      const e = await q.query<{ genders: string[]; grades: string[]; program: string | null }>(
        "select genders, grades, program_id::text as program from events where id = $1 for update",
        [eventId],
      );
      if (!e.rows[0]) throw new UserError("That event no longer exists.");
      return { added: await addMatching(q, eventId, e.rows[0].genders, e.rows[0].grades, e.rows[0].program) };
    }),
  );
}

export async function deleteEvent(deps: Deps, viewer: SessionUser, eventId: unknown): Promise<Result> {
  if (!hasArea(viewer, "events")) return directorOnly;
  if (!isId(eventId)) return { ok: false, message: "That event no longer exists." };
  const r = await deps.pool.query("delete from events where id = $1", [eventId]);
  return r.rowCount ? { ok: true } : { ok: false, message: "That event no longer exists." };
}

export type EventSummary = {
  id: string;
  name: string;
  startsAt: Date;
  location: string | null;
  total: number;
  here: number;
  absent: number;
  staff: string[];
};

const SUMMARY = `
  select e.id::text, e.name, e.starts_at as "startsAt", e.location,
         (select count(*)::int from event_attendees a where a.event_id = e.id) as total,
         (select count(*)::int from event_attendees a where a.event_id = e.id and a.status = 'here') as here,
         (select count(*)::int from event_attendees a where a.event_id = e.id and a.status = 'absent') as absent,
         array(select u.first_name || ' ' || u.last_name from event_staff s join users u on u.coach_id = s.coach_id
               where s.event_id = e.id order by lower(u.last_name), lower(u.first_name)) as staff
  from events e`;

// The Director sees every event; anyone else, the events they run check-in for. Soonest first.
export async function listEvents(deps: Deps, viewer: SessionUser): Promise<EventSummary[]> {
  const r = hasArea(viewer, "events")
    ? await deps.pool.query<EventSummary>(`${SUMMARY} order by e.starts_at, e.id`)
    : await deps.pool.query<EventSummary>(
        `${SUMMARY} where exists (select 1 from event_staff s where s.event_id = e.id and s.coach_id = $1) order by e.starts_at, e.id`,
        [viewer.coachId],
      );
  return r.rows;
}

// How many events from yesterday on the viewer runs check-in for (for the header link).
export async function myEventCount(deps: Deps, viewer: SessionUser): Promise<number> {
  const r = await deps.pool.query<{ n: number }>(
    `select count(*)::int as n from event_staff s join events e on e.id = s.event_id
     where s.coach_id = $1 and e.starts_at > $2`,
    [viewer.coachId, new Date(deps.now().getTime() - 24 * 3_600_000)],
  );
  return r.rows[0].n;
}

export type Attendee = {
  registrantId: string;
  firstName: string;
  lastName: string;
  gender: string;
  grade: string;
  status: Status;
  updatedBy: string | null;
  updatedAt: Date | null;
};
export type EventDetail = EventSummary & {
  notes: string | null;
  genders: string[];
  grades: string[];
  createdBy: string;
  players: Attendee[];
};

async function canRun(q: Pick<Pool, "query">, viewer: SessionUser, eventId: string): Promise<boolean> {
  if (hasArea(viewer, "events")) return true;
  const r = await q.query("select 1 from event_staff where event_id = $1 and coach_id = $2", [eventId, viewer.coachId]);
  return r.rows.length > 0;
}

// Null when the event doesn't exist or the viewer doesn't run it.
export async function getEvent(deps: Deps, viewer: SessionUser, eventId: string): Promise<EventDetail | null> {
  if (!isId(eventId) || !(await canRun(deps.pool, viewer, eventId))) return null;
  const e = await deps.pool.query<EventDetail>(
    `${SUMMARY.replace("from events e", ', e.notes, e.genders, e.grades, e.created_by as "createdBy" from events e')} where e.id = $1`,
    [eventId],
  );
  if (!e.rows[0]) return null;
  const p = await deps.pool.query<Attendee>(
    `select registrant_id as "registrantId", first_name as "firstName", last_name as "lastName", gender, grade, status,
            updated_by as "updatedBy", updated_at as "updatedAt"
     from event_attendees where event_id = $1
     order by grade_sort, gender, lower(last_name), lower(first_name)`,
    [eventId],
  );
  return { ...e.rows[0], players: p.rows };
}

// Mark one player. The browser sends the status it wants (not "next"), so a double tap can't skip a step.
export async function setStatus(
  deps: Deps,
  viewer: SessionUser,
  input: { eventId: unknown; registrantId: unknown; status: unknown },
): Promise<Result<{ updatedBy: string | null; updatedAt: Date | null }>> {
  const { eventId, registrantId, status } = input;
  if (!isId(eventId) || typeof registrantId !== "string" || !/^[\w-]{1,40}$/.test(registrantId)) {
    return { ok: false, message: "That player isn't on this event." };
  }
  if (typeof status !== "string" || !(STATUSES as readonly string[]).includes(status)) return { ok: false, message: "Unknown status." };
  if (!(await canRun(deps.pool, viewer, eventId))) return { ok: false, message: "You don't run check-in for this event." };
  const back = status === "unknown"; // back to ? clears who marked it
  const r = await deps.pool.query<{ updatedBy: string | null; updatedAt: Date | null }>(
    `update event_attendees set status = $3, updated_by = $4, updated_at = $5
     where event_id = $1 and registrant_id = $2 returning updated_by as "updatedBy", updated_at as "updatedAt"`,
    [eventId, registrantId, status, back ? null : by(viewer), back ? null : deps.now()],
  );
  if (!r.rows[0]) return { ok: false, message: "That player isn't on this event." };
  return { ok: true, ...r.rows[0] };
}

// People the Director can put in charge of check-in: active users with a Thunder role.
export async function staffChoices(deps: Deps, viewer: SessionUser): Promise<{ id: string; name: string }[]> {
  if (!hasArea(viewer, "events")) return [];
  const r = await deps.pool.query<{ id: string; name: string }>(
    `select u.coach_id as id, u.first_name || ' ' || u.last_name as name from users u
     where u.active and (has_role(u.coach_id, 'thunder', 'Coach') or has_role(u.coach_id, 'thunder', 'Director') or exists (select 1 from team_staff s where s.coach_id = u.coach_id))
     order by lower(u.last_name), lower(u.first_name)`,
  );
  return r.rows;
}

// ---- Quick setup: event types ----

export async function listEventTypes(deps: Deps): Promise<string[]> {
  const r = await deps.pool.query<{ name: string }>("select name from event_types order by created_at, lower(name)");
  return r.rows.map((t) => t.name);
}

export async function addEventType(deps: Deps, viewer: SessionUser, nameInput: unknown): Promise<Result<{ name: string }>> {
  if (!hasArea(viewer, "events")) return directorOnly;
  const name = typeof nameInput === "string" ? nameInput.trim().replace(/\s+/g, " ") : "";
  if (!name) return { ok: false, message: "Type a name for the new event type." };
  if (name.length > 40) return { ok: false, message: "Keep it to 40 characters." };
  if (!/^[A-Za-z0-9][A-Za-z0-9 &'/-]*$/.test(name)) return { ok: false, message: "Use letters, numbers, spaces, & ' / or -." };
  const r = await deps.pool.query("insert into event_types (name, created_by, created_at) values ($1, $2, $3) on conflict do nothing", [
    name,
    by(viewer),
    deps.now(),
  ]);
  return r.rowCount ? { ok: true, name } : { ok: false, message: `"${name}" is already an event type.` };
}

// Removing a type only takes it off the quick list; events already made from it keep their name.
export async function removeEventType(deps: Deps, viewer: SessionUser, nameInput: unknown): Promise<Result> {
  if (!hasArea(viewer, "events")) return directorOnly;
  if (typeof nameInput !== "string") return { ok: false, message: "That event type no longer exists." };
  const r = await deps.pool.query("delete from event_types where name = $1", [nameInput]);
  return r.rowCount ? { ok: true } : { ok: false, message: "That event type no longer exists." };
}

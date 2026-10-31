// Practice attendance (SPEC.md section 12): every booked team practice shows in Events. The Director and the team's
// staff check in the team's roster: ? → ✓ → ✗. Who marked each player is recorded.
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import type { Attendee } from "./events";
import { STATUSES } from "./events";
import { hasArea } from "./org-admin";

type Deps = { pool: Pool; now: () => Date };
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

export const PAST_DAYS = 60; // older practices drop off the Events list
const isId = (v: unknown): v is string => typeof v === "string" && /^\d{1,18}$/.test(v);

export type PracticeSummary = {
  slotId: string;
  teamId: string;
  teamName: string;
  startsAt: Date;
  gym: string;
  court: string;
  total: number;
  here: number;
  absent: number;
};

const SUMMARY = `
  select s.id::text as "slotId", t.id::text as "teamId", t.name as "teamName", s.starts_at as "startsAt", g.name as gym, c.name as court,
         (select count(*)::int from team_players p where p.team_id = t.id) as total,
         (select count(*)::int from practice_attendance a join team_players p on p.team_id = a.team_id and p.registrant_id = a.registrant_id
          where a.slot_id = s.id and a.team_id = t.id and a.status = 'here') as here,
         (select count(*)::int from practice_attendance a join team_players p on p.team_id = a.team_id and p.registrant_id = a.registrant_id
          where a.slot_id = s.id and a.team_id = t.id and a.status = 'absent') as absent
  from slots s join teams t on t.id = s.team_id join courts c on c.id = s.court_id join gyms g on g.id = c.gym_id`;

// Booked practices from the last 60 days on. The Director sees every team's; staff see their own teams'.
export async function listPractices(deps: Deps, viewer: SessionUser): Promise<PracticeSummary[]> {
  const since = new Date(deps.now().getTime() - PAST_DAYS * 86_400_000);
  const r = hasArea(viewer, "teams", "facilities")
    ? await deps.pool.query<PracticeSummary>(`${SUMMARY} where s.starts_at >= $1 order by s.starts_at, t.name`, [since])
    : await deps.pool.query<PracticeSummary>(
        `${SUMMARY} where s.starts_at >= $1 and exists (select 1 from team_staff ts where ts.team_id = t.id and ts.coach_id = $2)
         order by s.starts_at, t.name`,
        [since, viewer.coachId],
      );
  return r.rows;
}

// Practices today (Eastern) the viewer can check in, for the header's ✓ Check-in button.
export async function myPracticesToday(deps: Deps, viewer: SessionUser, dayStart: Date, dayEnd: Date): Promise<number> {
  const r = await deps.pool.query<{ n: number }>(
    `select count(*)::int as n from slots s join team_staff ts on ts.team_id = s.team_id
     where ts.coach_id = $1 and s.starts_at >= $2 and s.starts_at < $3`,
    [viewer.coachId, dayStart, dayEnd],
  );
  return r.rows[0].n;
}

// The slot's team, when the viewer may check in this practice.
async function practiceTeam(q: Pick<Pool, "query">, viewer: SessionUser, slotId: string): Promise<string | null> {
  const r = await q.query<{ team_id: string; staff: boolean }>(
    `select s.team_id::text, exists (select 1 from team_staff ts where ts.team_id = s.team_id and ts.coach_id = $2) as staff
     from slots s where s.id = $1 and s.team_id is not null`,
    [slotId, viewer.coachId],
  );
  const row = r.rows[0];
  return row && (hasArea(viewer, "teams", "facilities") || row.staff) ? row.team_id : null;
}

export type PracticeDetail = PracticeSummary & { players: Attendee[] };

// Null when there's no booked practice here or the viewer isn't the Director or on the team's staff.
export async function getPractice(deps: Deps, viewer: SessionUser, slotId: string): Promise<PracticeDetail | null> {
  if (!isId(slotId)) return null;
  const teamId = await practiceTeam(deps.pool, viewer, slotId);
  if (!teamId) return null;
  const s = await deps.pool.query<PracticeSummary>(`${SUMMARY} where s.id = $1`, [slotId]);
  const p = await deps.pool.query<Attendee>(
    `select p.registrant_id as "registrantId", p.first_name as "firstName", p.last_name as "lastName", p.gender, p.grade,
            coalesce(a.status, 'unknown') as status, a.updated_by as "updatedBy", a.updated_at as "updatedAt"
     from team_players p
     left join practice_attendance a on a.slot_id = $1 and a.team_id = p.team_id and a.registrant_id = p.registrant_id
     where p.team_id = $2
     order by p.grade_sort, p.gender, lower(p.last_name), lower(p.first_name)`,
    [slotId, teamId],
  );
  return { ...s.rows[0], players: p.rows };
}

export async function setPracticeStatus(
  deps: Deps,
  viewer: SessionUser,
  input: { slotId: unknown; registrantId: unknown; status: unknown },
): Promise<Result<{ updatedBy: string | null; updatedAt: Date | null }>> {
  const { slotId, registrantId, status } = input;
  if (!isId(slotId) || typeof registrantId !== "string" || !/^[\w-]{1,40}$/.test(registrantId)) {
    return { ok: false, message: "That player isn't on this team." };
  }
  if (typeof status !== "string" || !(STATUSES as readonly string[]).includes(status)) return { ok: false, message: "Unknown status." };
  const teamId = await practiceTeam(deps.pool, viewer, slotId);
  if (!teamId) return { ok: false, message: "You can't take attendance for this practice." };
  const back = status === "unknown"; // back to ? clears who marked it
  const by = back ? null : `${viewer.firstName} ${viewer.lastName}`;
  const at = back ? null : deps.now();
  const r = await deps.pool.query<{ updatedBy: string | null; updatedAt: Date | null }>(
    `insert into practice_attendance (slot_id, team_id, registrant_id, status, updated_by, updated_at)
     select $1, $2, $3, $4, $5, $6 where exists (select 1 from team_players where team_id = $2 and registrant_id = $3)
     on conflict (slot_id, team_id, registrant_id) do update set status = excluded.status, updated_by = excluded.updated_by, updated_at = excluded.updated_at
     returning updated_by as "updatedBy", updated_at as "updatedAt"`,
    [slotId, teamId, registrantId, status, by, at],
  );
  if (!r.rows[0]) return { ok: false, message: "That player isn't on this team." };
  return { ok: true, ...r.rows[0] };
}

// What stops a team being deleted or withdrawn (SPEC.md section 13): a team already on an event's schedule (in a matchup)
// can't be withdrawn or deleted: it requests removal from the schedule, and the Scheduler puts TBD in its games. A team
// only registered (not scheduled) can be deleted; that withdraws it.
import type { Queryable } from "./sql";
import { easternDate } from "./time";

// The events (not ended) these League teams (scenic_teams ids) are registered in, by start date.
export async function currentEventsOf(q: Pick<Queryable, "query">, teamIds: string[], now: Date): Promise<string[]> {
  if (!teamIds.length) return [];
  const r = await q.query<{ name: string }>(
    `select distinct p.name, p.starts_on from scenic_registrations r join scenic_programs p on p.id = r.program_id
      where r.team_id = any($1::bigint[]) and p.ends_on >= $2::date order by p.starts_on, p.name`,
    [teamIds, easternDate(now)],
  );
  return r.rows.map((x) => x.name);
}

// The message refusing a delete while the team is on an event's schedule (not ended), or null. Registered but not
// scheduled, it can be deleted (that withdraws it).
export async function scheduledRefusal(q: Pick<Queryable, "query">, teamIds: string[], now: Date): Promise<string | null> {
  if (!teamIds.length) return null;
  const r = await q.query<{ name: string }>(
    `select distinct p.name, p.starts_on from scenic_matchups m join scenic_programs p on p.id = m.program_id
      where (m.team_a = any($1::bigint[]) or m.team_b = any($1::bigint[])) and p.ends_on >= $2::date order by p.starts_on, p.name`,
    [teamIds, easternDate(now)],
  );
  return r.rows.length
    ? `It's on the schedule for ${r.rows.map((x) => x.name).join(" and ")}. Request removal from the schedule (the Scheduler puts TBD in its games), then delete it.`
    : null;
}

// Whether the team is in any of this event's matchups (on its schedule).
export async function isScheduled(q: Pick<Queryable, "query">, programId: string, teamId: string): Promise<boolean> {
  const r = await q.query("select 1 from scenic_matchups where program_id = $1 and (team_a = $2 or team_b = $2) limit 1", [programId, teamId]);
  return !!r.rowCount;
}

export const SCHEDULED_REFUSAL = "It's already on the schedule for this event, so it can't withdraw. Request removal from the schedule instead.";

// Removal from an event's schedule (SPEC.md section 13). A team registered in an event can't be deleted (withdraw it
// first), and a team already on its schedule (in a matchup) can't withdraw: whoever manages it asks the League's
// Scheduler to take it off. Approving puts TBD in its place in each of its games (a game it played against TBD goes) and
// withdraws it; declining leaves it on. Every check runs here, on the server.
import type { Pool, PoolClient } from "pg";
import type { SessionUser } from "./auth/service";
import { hasArea } from "./org-admin";
import { teamsManagerOf } from "./org-teams";
import { isScheduler } from "./scenic-programs";
import { withTx, type Queryable } from "./sql";
import { easternDate } from "./time";

type Deps = { pool: Pool; now: () => Date };
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };
const isId = (v: unknown): v is string => typeof v === "string" && /^\d{1,18}$/.test(v);
const by = (v: SessionUser) => `${v.firstName} ${v.lastName}`;

// What Delete team needs to know (null: nothing): on an event's schedule (it can't be deleted yet; with any removal
// already asked for), or only registered in one that hasn't ended (deleting withdraws it). `kind`: Thunder's teams or an
// organization's; `id`: its id there.
export type DeleteBlock =
  | { why: "registered"; program: string }
  | { why: "scheduled"; program: string; programId: string; teamId: string; requested: { by: string; at: Date } | null };

export async function deleteBlock(q: Pick<Queryable, "query">, kind: "thunder" | "org", id: string, now: Date): Promise<DeleteBlock | null> {
  const col = kind === "thunder" ? "st.thunder_team_id" : "st.org_team_id";
  const r = await q.query<{
    program: string;
    program_id: string;
    team_id: string;
    scheduled: boolean;
    requested_by: string | null;
    requested_at: Date | null;
  }>(
    `select p.name as program, p.id::text as program_id, st.id::text as team_id,
            exists (select 1 from scenic_matchups m where m.program_id = p.id and st.id in (m.team_a, m.team_b)) as scheduled,
            x.requested_by, x.requested_at
       from scenic_registrations r join scenic_teams st on st.id = r.team_id join scenic_programs p on p.id = r.program_id
       left join scenic_schedule_removals x on x.program_id = p.id and x.team_id = st.id and x.decision is null
      where ${col} = $1 and p.ends_on >= $2::date
      order by 4 desc, p.starts_on`,
    [id, easternDate(now)],
  );
  const b = r.rows[0];
  if (!b) return null;
  if (!b.scheduled) return { why: "registered", program: b.program };
  return {
    why: "scheduled",
    program: b.program,
    programId: b.program_id,
    teamId: b.team_id,
    requested: b.requested_by ? { by: b.requested_by, at: b.requested_at! } : null,
  };
}

// Whoever manages the team in its organization (Thunder's Directors of Teams; an organization's Admins and Directors of
// Teams) may ask.
async function mayAsk(q: Pick<Queryable, "query">, viewer: SessionUser, teamId: string) {
  const t = await q.query<{ org: string | null; thunder: boolean }>(
    `select o.org, st.thunder_team_id is not null as thunder from scenic_teams st left join org_teams o on o.id = st.org_team_id
      where st.id = $1`,
    [teamId],
  );
  const row = t.rows[0];
  if (!row) return false;
  if (row.thunder) return hasArea(viewer, "teams");
  return !!row.org && !!(await teamsManagerOf(q, viewer, row.org));
}

// Ask the Scheduler to take a team off an event's schedule (once; asking again changes nothing).
export async function requestRemoval(deps: Deps, viewer: SessionUser, programId: unknown, teamId: unknown): Promise<Result> {
  if (!isId(programId) || !isId(teamId)) return { ok: false, message: "Pick a team." };
  return withTx(deps.pool, async (q) => {
    if (!(await mayAsk(q, viewer, teamId))) return { ok: false as const, message: "Only whoever manages this team can ask." };
    const reg = await q.query("select 1 from scenic_registrations where program_id = $1 and team_id = $2 for update", [programId, teamId]);
    if (!reg.rowCount) return { ok: false as const, message: "That team isn't registered." };
    const on = await q.query("select 1 from scenic_matchups where program_id = $1 and $2 in (team_a, team_b) limit 1", [programId, teamId]);
    if (!on.rowCount) return { ok: false as const, message: "It isn't on the schedule, so it can simply withdraw." };
    await q.query(
      `insert into scenic_schedule_removals (program_id, team_id, requested_by, requested_at) values ($1, $2, $3, $4)
       on conflict (program_id, team_id) where decision is null do nothing`,
      [programId, teamId, by(viewer), deps.now()],
    );
    return { ok: true as const };
  });
}

export type RemovalRequest = { id: string; teamId: string; team: string; games: number; by: string; at: Date };

// The open requests in an event, oldest first (the Scheduler's card).
export async function removalRequests(q: Pick<Queryable, "query">, programId: string): Promise<RemovalRequest[]> {
  const r = await q.query<RemovalRequest>(
    `select x.id::text, x.team_id::text as "teamId", t.name as team, x.requested_by as by, x.requested_at as at,
            (select count(*)::int from scenic_matchups m where m.program_id = x.program_id and x.team_id in (m.team_a, m.team_b)) as games
       from scenic_schedule_removals x join scenic_teams t on t.id = x.team_id
      where x.program_id = $1 and x.decision is null order by x.requested_at`,
    [programId],
  );
  return r.rows;
}

// The Scheduler decides. Approve: TBD takes the team's place in each of its games (the other team stays, home or away as
// it was; a game it had against TBD goes), then it's withdrawn. Refused, nothing changed, when the other team already
// plays TBD that day (fix that game on the Grid first).
export async function decideRemoval(deps: Deps, viewer: SessionUser, id: unknown, approve: boolean): Promise<Result<{ games: number }>> {
  if (!isId(id)) return { ok: false, message: "That request no longer exists." };
  return withTx(deps.pool, async (q) => {
    if (!(await isScheduler(q, viewer))) return { ok: false as const, message: "Only a Director of Scheduling can decide this." };
    const x = (
      await q.query<{ program_id: string; team_id: string }>(
        "select program_id::text, team_id::text from scenic_schedule_removals where id = $1 and decision is null for update",
        [id],
      )
    ).rows[0];
    if (!x) return { ok: false as const, message: "That request was already decided." };
    let games = 0;
    if (approve) {
      const tbd = await toTbd(q, x.program_id, x.team_id);
      if (typeof tbd === "string") return { ok: false as const, message: tbd };
      games = tbd;
      await q.query("delete from scenic_registrations where program_id = $1 and team_id = $2", [x.program_id, x.team_id]);
    }
    await q.query("update scenic_schedule_removals set decision = $2, decided_by = $3, decided_at = $4 where id = $1", [
      id,
      approve ? "approved" : "declined",
      by(viewer),
      deps.now(),
    ]);
    return { ok: true as const, games };
  });
}

// TBD in the team's place in each of its games; returns how many changed, or why it can't.
async function toTbd(q: PoolClient, programId: string, teamId: string): Promise<number | string> {
  const games = await q.query<{ id: string; day: string; team_a: string; team_b: string | null; home_side: "a" | "b" | null }>(
    `select id::text, day::text, team_a::text, team_b::text, home_side from scenic_matchups
      where program_id = $1 and $2 in (team_a, team_b) for update`,
    [programId, teamId],
  );
  for (const g of games.rows) {
    const other = g.team_a === teamId ? g.team_b : g.team_a;
    if (!other) {
      await q.query("delete from scenic_matchups where id = $1", [g.id]); // it against TBD: no game left
      continue;
    }
    const clash = await q.query(
      "select 1 from scenic_matchups where program_id = $1 and day = $2 and team_a = $3 and team_b is null and id <> $4",
      [programId, g.day, other, g.id],
    );
    if (clash.rowCount) {
      const name = (await q.query<{ name: string }>("select name from scenic_teams where id = $1", [other])).rows[0]?.name;
      return `${name} already plays TBD on ${g.day}. Change that game on the Grid first, then approve.`;
    }
    // The other team stays home or away as it was; it's now side "a" (TBD has no side).
    const otherWasHome = g.home_side === (g.team_a === other ? "a" : "b");
    await q.query("update scenic_matchups set team_a = $2, team_b = null, home_side = $3 where id = $1", [
      g.id,
      other,
      g.home_side === null ? null : otherWasHome ? "a" : "b",
    ]);
  }
  return games.rows.length;
}

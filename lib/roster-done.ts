// How many of an organization's teams have a complete roster (SPEC.md section 14): no roster warning on the team: it has
// players, each with a birthdate (one that can be right) and a uniform number, and no two sharing a number. A League (Scenic
// City): the teams registered in its Leagues not ended, from wherever each roster is kept, by organization; any other
// organization: its own teams, by grade and gender. Thunder's birthdates come from registration (not checked here, as on its
// team page), and its numbers count only with Uniforms on.
import type { CoachUse } from "./coach-use";
import { ordinal } from "./grades";
import { wrongBirthdate } from "./roster-match";
import type { Queryable } from "./sql";
import { easternDate } from "./time";
import { dupNumbers } from "./uniform-fields";

type Row = { team: string; name: string; part: string; dates: boolean; player: string | null; birthdate: string | null; grade: number | null; number: string | null };

// Each team (with its part) and its players, one row each (a team with none: one row, player null).
const LEAGUE = `with t as (
    select distinct t.id, t.name, t.thunder_team_id, t.org_team_id, coalesce(pa.name, 'Solo teams') as part
      from scenic_registrations r join scenic_programs p on p.id = r.program_id and p.org = $1 and p.ends_on >= $2::date
      join scenic_teams t on t.id = r.team_id left join partners pa on pa.id = t.partner_id
     where r.removed_by is null and t.name not like '%(DEV)')
  select t.id::text as team, t.name, t.part, x.dates, x.player, x.birthdate, x.grade, x.number from t left join lateral (
    select false as dates, p.registrant_id::text as player, null::text as birthdate, g.grade_sort as grade, u.number
      from team_players p join registrations g on g.registrant_id = p.registrant_id
      left join team_uniforms u on u.team_id = p.team_id and u.registrant_id = p.registrant_id
     where p.team_id = t.thunder_team_id
    union all
    select true, p.id::text, to_char(p.birthdate, 'YYYY-MM-DD'), p.grade, p.jersey from org_team_players p where p.team_id = t.org_team_id
    union all
    select true, p.id::text, to_char(p.birthdate, 'YYYY-MM-DD'), p.grade, p.jersey from scenic_team_players p
     where p.team_id = t.id and t.thunder_team_id is null and t.org_team_id is null
  ) x on true`;
const THUNDER = `select t.id::text as team, t.name, t.gender || ' ' || t.grade_sort as part, false as dates, p.registrant_id::text as player,
         null::text as birthdate, g.grade_sort as grade, u.number
    from teams t left join team_players p on p.team_id = t.id left join registrations g on g.registrant_id = p.registrant_id
    left join team_uniforms u on u.team_id = p.team_id and u.registrant_id = p.registrant_id
   where $1::text is not null and $2::date is not null`;
const ORG = `select t.id::text as team, t.name, t.gender || ' ' || t.grade as part, true as dates, p.id::text as player,
         to_char(p.birthdate, 'YYYY-MM-DD') as birthdate, p.grade, p.jersey as number
    from org_teams t left join org_team_players p on p.team_id = t.id
   where t.org = $1 and t.archived_at is null and $2::date is not null`;

// "Boys 4" → "4th Boys" (Pre-K, K).
const gradePart = (part: string) => {
  const [gender, g] = part.split(" ");
  const n = Number(g);
  return `${n < 0 ? "Pre-K" : n === 0 ? "K" : ordinal(String(n))} ${gender}`;
};
const pct = (done: number, total: number) => Math.round((done * 100) / total);

// Each team's roster and what's missing from it (nothing: complete). `numbers`: whether uniform numbers count (Thunder: with
// Uniforms on; everyone else always). `id`: the team where it's kept here (a League: its League team).
export type RosterTeam = { id: string; name: string; part: string; missing: string[] };
export async function rosterTeams(q: Pick<Queryable, "query">, org: string, now: Date, numbers = true): Promise<RosterTeam[]> {
  const league = org === "scenic-city";
  const today = easternDate(now);
  const r = await q.query<Row>(league ? LEAGUE : org === "thunder" ? THUNDER : ORG, [org, today]);
  const teams = new Map<string, { name: string; part: string; players: Row[] }>();
  for (const row of r.rows) {
    const t = teams.get(row.team) ?? { name: row.name, part: league ? row.part : gradePart(row.part), players: [] };
    if (row.player) t.players.push(row);
    teams.set(row.team, t);
  }
  const s = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  return [...teams].map(([id, t]) => {
    const ps = t.players;
    const missing: string[] = [];
    if (!ps.length) missing.push("no players on the roster yet");
    else {
      const noDate = ps.filter((p) => p.dates && !p.birthdate).length;
      const badDate = ps.filter((p) => p.dates && p.birthdate && wrongBirthdate(p, today)).length;
      const noNumber = numbers ? ps.filter((p) => !p.number?.trim()).length : 0;
      const dups = dupNumbers(ps.map((p) => p.number));
      if (noDate) missing.push(`${s(noDate, "player")} without a birthdate`);
      if (badDate) missing.push(`${s(badDate, "birthdate")} that can't be right for the grade`);
      if (noNumber) missing.push(`${s(noNumber, "player")} without a jersey number`);
      if (dups.length) missing.push(`number${dups.length === 1 ? "" : "s"} ${dups.join(", ")} used twice`);
    }
    return { id, name: t.name, part: t.part, missing };
  });
}

// Null when it has no teams.
export async function rostersDone(q: Pick<Queryable, "query">, org: string, now: Date, numbers = true): Promise<CoachUse | null> {
  const league = org === "scenic-city";
  const teams = await rosterTeams(q, org, now, numbers);
  if (!teams.length) return null;
  const parts = new Map<string, { using: number; total: number }>();
  let done = 0;
  for (const t of teams) {
    const ok = !t.missing.length;
    if (ok) done++;
    const p = parts.get(t.part) ?? { using: 0, total: 0 };
    p.total++;
    if (ok) p.using++;
    parts.set(t.part, p);
  }
  return {
    using: done,
    total: teams.length,
    percent: pct(done, teams.length),
    by: league ? "organization" : "grade",
    parts: [...parts]
      .map(([name, p]) => ({ name, using: p.using, total: p.total, percent: pct(p.using, p.total) }))
      .sort((a, b) => a.percent - b.percent || b.total - a.total || a.name.localeCompare(b.name)),
  };
}

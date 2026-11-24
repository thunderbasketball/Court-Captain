// Roster conflicts (SPEC.md section 13): players who look like they're on more than one of a League program's rosters, by
// first name, last name and date of birth (lib/roster-match), and whether that's allowed: only in the same organization, in
// different divisions, and never REC and COMP. Each team's League roster once it's locked, else its roster now. The League's
// Owners, Admins and Directors of Programs see it (full names and birthdates) and mark a pair as different players, or
// allowed; it comes back if either entry changes. Who decided is recorded. Nothing on a roster is changed here.
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { orgHasArea } from "./org-admin";
import { matchPlayers, normName, oddBirthdate, rulesBroken, type Strength, type TeamFacts } from "./roster-match";
import { schoolYearOf } from "./eligibility";
import { gradeLabel, gradeRange } from "./scenic-teams";
import type { Queryable } from "./sql";
import { easternDate } from "./time";

type Deps = { pool: Pool; now: () => Date };
type Result = { ok: true } | { ok: false; message: string };
const isId = (v: unknown): v is string => typeof v === "string" && /^\d{1,18}$/.test(v);

type Player = TeamFacts & {
  first: string;
  last: string;
  dob: string | null;
  grade: number | null;
  team: string;
  org: string;
  division: string;
  locked: boolean;
};

export type ConflictSide = { name: string; dob: string | null; grade: string | null; team: string; org: string; division: string; locked: boolean };
export type RosterConflict = {
  pair: string;
  strength: Strength;
  why: string; // why they look like the same player
  broken: string[]; // the rules it breaks (empty: allowed)
  a: ConflictSide;
  b: ConflictSide;
  review: { decision: "different" | "allowed"; by: string } | null;
};
export type OddBirthdate = { name: string; dob: string; why: string; team: string; org: string };
export type RosterReport = {
  conflicts: RosterConflict[]; // to look at: Conflict, Likely, then Check
  allowed: RosterConflict[]; // the same player, within the rules
  reviewed: RosterConflict[];
  birthdates: OddBirthdate[]; // can't be right: they hide matches
  teams: number;
  withRoster: number;
  players: number;
  missing: number; // players with no birthdate
};

const gradeOf = (g: string | null): number | null => (g === null || g === "" ? null : /^k$/i.test(g) ? 0 : /^pre-?k$/i.test(g) ? -1 : /^-?\d{1,2}$/.test(g) ? Number(g) : null);

async function playersOf(q: Pick<Queryable, "query">, programId: string): Promise<{ teams: number; players: Player[]; facts: Map<string, TeamFacts> }> {
  const r = await q.query<{
    team_id: string;
    team: string;
    level: string;
    division_id: string;
    gender: string;
    low: number;
    high: number;
    org_key: string;
    org: string;
    locked: boolean;
    players: { first: string; last: string; dob: string | null; grade: string | null }[];
  }>(
    `select st.id::text as team_id, st.name as team, g.level, d.id::text as division_id, d.gender, d.grade_low as low, d.grade_high as high,
            -- An outside club's teams share a partner; FastBreak's are each their own.
            case when ot.id is not null then 'org:' || ot.org when st.thunder_team_id is not null then 'org:thunder'
                 when pa.org_slug is not null then 'org:' || pa.org_slug
                 when pa.id is not null and lower(pa.name) <> 'fastbreak' then 'club:' || pa.id else 'team:' || st.id end as org_key,
            coalesce(o.short_name, case when st.thunder_team_id is not null then 'Thunder' end, pa.name, 'Solo') as org,
            s.team_id is not null as locked,
            case when s.team_id is not null then
              coalesce((select json_agg(json_build_object('first', x.first_name, 'last', x.last_name, 'dob', to_char(x.birthdate, 'YYYY-MM-DD'), 'grade', x.grade))
                          from scenic_snapshot_players x where x.program_id = r.program_id and x.team_id = r.team_id and x.removed_by is null), '[]')
            else coalesce((select json_agg(y) from (
              select p.first_name as first, p.last_name as last, to_char(rg.birthdate, 'YYYY-MM-DD') as dob, p.grade::text as grade
                from team_players p left join lateral (select birthdate from registrations where registrant_id = p.registrant_id limit 1) rg on true
               where p.team_id = st.thunder_team_id
              union all
              select p.first_name, p.last_name, to_char(p.birthdate, 'YYYY-MM-DD'), p.grade::text from org_team_players p where p.team_id = st.org_team_id
              union all
              select p.first_name, p.last_name, to_char(p.birthdate, 'YYYY-MM-DD'), p.grade::text
                from scenic_team_players p where p.team_id = st.id and st.org_team_id is null and st.thunder_team_id is null) y), '[]') end as players
       from scenic_registrations r
       join scenic_teams st on st.id = r.team_id
       join scenic_pools po on po.id = r.pool_id join scenic_grade_groups g on g.id = po.group_id join scenic_divisions d on d.id = g.division_id
       left join org_teams ot on ot.id = st.org_team_id left join organizations o on o.slug = ot.org left join partners pa on pa.id = st.partner_id
       left join scenic_roster_snapshots s on s.program_id = r.program_id and s.team_id = r.team_id
      where r.program_id = $1 and r.removed_at is null and st.name not like '%(DEV)'`,
    [programId],
  );
  return {
    teams: r.rows.length,
    facts: new Map(r.rows.map((t) => [t.team_id, { teamId: t.team_id, orgKey: t.org_key, divisionId: t.division_id, level: t.level }])),
    players: r.rows.flatMap((t) =>
      t.players.map((p) => ({
        teamId: t.team_id,
        team: t.team,
        level: t.level,
        divisionId: t.division_id,
        division: `${t.gender} ${gradeRange(t.low, t.high)}`,
        orgKey: t.org_key,
        org: t.org,
        locked: t.locked,
        first: p.first,
        last: p.last,
        dob: p.dob,
        grade: gradeOf(p.grade),
      })),
    ),
  };
}

const entryKey = (p: Player) => `${p.teamId}|${normName(p.first)}|${normName(p.last)}|${p.dob ?? ""}`;
const pairKey = (programId: string, a: Player, b: Player) =>
  createHash("sha256").update([programId, ...[entryKey(a), entryKey(b)].sort()].join("||")).digest("hex");
const RANK: Record<Strength, number> = { Conflict: 0, Likely: 1, Check: 2 };

// The report itself (the caller has checked who may see it). Players are compared only within the same birthdate or the
// same name, so a big League stays quick.
export async function rosterReport(q: Pick<Queryable, "query">, programId: string, now: Date): Promise<RosterReport> {
  const [{ teams, players }, reviews] = await Promise.all([
    playersOf(q, programId),
    q.query<{ pair: string; decision: "different" | "allowed"; by: string }>("select pair, decision, reviewed_by as by from roster_conflict_reviews where program_id = $1", [programId]),
  ]);
  const reviewed = new Map(reviews.rows.map((r) => [r.pair, r]));
  const buckets = new Map<string, number[]>();
  players.forEach((p, i) => {
    for (const k of [...(p.dob ? [`d${p.dob}`] : []), `n${normName(p.first)} ${normName(p.last)}`]) buckets.set(k, [...(buckets.get(k) ?? []), i]);
  });
  const seen = new Set<string>();
  const out: RosterReport = {
    conflicts: [],
    allowed: [],
    reviewed: [],
    birthdates: [],
    teams,
    withRoster: new Set(players.map((p) => p.teamId)).size,
    players: players.length,
    missing: players.filter((p) => !p.dob).length,
  };
  const side = (p: Player): ConflictSide => ({
    name: `${p.first} ${p.last}`.trim(),
    dob: p.dob,
    grade: p.grade === null ? null : gradeLabel(p.grade, p.grade),
    team: p.team,
    org: p.org,
    division: `${p.division} ${p.level}`,
    locked: p.locked,
  });
  for (const list of buckets.values())
    for (let x = 0; x < list.length; x++)
      for (let y = x + 1; y < list.length; y++) {
        const id = `${list[x]}-${list[y]}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const [a, b] = [players[list[x]], players[list[y]]];
        const m = matchPlayers(a, b);
        if (!m) continue;
        const broken = rulesBroken(a, b);
        if (m.strength === "Check" && (a.teamId === b.teamId || !broken.length)) continue; // twins on one team; or fine even if it is them
        const pair = pairKey(programId, a, b);
        const r = reviewed.get(pair);
        const c: RosterConflict = { pair, ...m, broken, a: side(a), b: side(b), review: r ? { decision: r.decision, by: r.by } : null };
        (r ? out.reviewed : broken.length ? out.conflicts : out.allowed).push(c);
      }
  const order = (a: RosterConflict, b: RosterConflict) => RANK[a.strength] - RANK[b.strength] || a.a.name.localeCompare(b.a.name) || a.a.team.localeCompare(b.a.team);
  for (const list of [out.conflicts, out.allowed, out.reviewed]) list.sort(order);
  const year = schoolYearOf(easternDate(now));
  for (const p of players) {
    const why = oddBirthdate(p.dob, p.grade, year);
    if (why) out.birthdates.push({ name: `${p.first} ${p.last}`.trim(), dob: p.dob!, why, team: p.team, org: p.org });
  }
  out.birthdates.sort((a, b) => a.org.localeCompare(b.org) || a.team.localeCompare(b.team) || a.name.localeCompare(b.name));
  return out;
}

async function mayReview(q: Pick<Queryable, "query">, viewer: SessionUser, programId: string): Promise<boolean> {
  const org = (await q.query<{ org: string }>("select org from scenic_programs where id = $1 and kind = 'League'", [programId])).rows[0]?.org;
  return !!org && orgHasArea(q, viewer.coachId, org, "programs");
}

// The program's card: the League's Owners, Admins and Directors of Programs; null for anyone else.
export async function rosterConflicts(deps: Deps, viewer: SessionUser, programId: unknown): Promise<RosterReport | null> {
  if (!isId(programId) || !(await mayReview(deps.pool, viewer, programId))) return null;
  return rosterReport(deps.pool, programId, deps.now());
}

// Different players, allowed, or (null) back to be looked at.
export async function reviewConflict(deps: Deps, viewer: SessionUser, programId: unknown, pair: unknown, decision: unknown): Promise<Result> {
  if (!isId(programId) || typeof pair !== "string" || !/^[0-9a-f]{64}$/.test(pair)) return { ok: false, message: "That isn't there any more." };
  if (decision !== null && decision !== "different" && decision !== "allowed") return { ok: false, message: "Pick what it is." };
  if (!(await mayReview(deps.pool, viewer, programId))) return { ok: false, message: "Only the League's Owners, Admins and Directors of Programs can do that." };
  if (decision === null) await deps.pool.query("delete from roster_conflict_reviews where program_id = $1 and pair = $2", [programId, pair]);
  else
    await deps.pool.query(
      `insert into roster_conflict_reviews (program_id, pair, decision, reviewed_by, reviewed_at)
       select p.id, $2, $3, $4, $5 from scenic_programs p where p.id = $1
       on conflict (program_id, pair) do update set decision = excluded.decision, reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at`,
      [programId, pair, decision, `${viewer.firstName} ${viewer.lastName}`, deps.now()],
    );
  return { ok: true };
}

// Home's To Do: each current League's Conflict and Likely pairs still to look at (the caller is one of its Admins).
export async function openConflicts(q: Pick<Queryable, "query">, org: string, now: Date): Promise<{ programId: string; program: string; n: number }[]> {
  const r = await q.query<{ id: string; name: string }>("select id::text, name from scenic_programs where org = $1 and kind = 'League' and ends_on >= $2::date order by starts_on", [
    org,
    easternDate(now),
  ]);
  const out = await Promise.all(
    r.rows.map(async (p) => ({ programId: p.id, program: p.name, n: (await rosterReport(q, p.id, now)).conflicts.filter((c) => c.strength !== "Check").length })),
  );
  return out.filter((x) => x.n > 0);
}

// ---- Warnings while adding players (SPEC.md section 13): the same match and rule, before they're saved ----

export type AddTo = { orgTeamId: string } | { thunderTeamId: string } | { teamId: string } | { teamId: string; programId: string };
export type AddEntry = { first: string; last: string; dob: string | null; grade: number | null };
const RULE: Record<string, string> = {
  "REC and COMP": "A player can't be on a REC and a COMP team.",
  "Different organizations": "A player can be on teams in only one organization.",
  "Same division": "A player can't be on two teams in the same division.",
};

// Each entry's warnings (one list per entry): a player who looks the same on another team of a League this team is
// registered in, against the rule. Another organization's team and player aren't named. With `programId` only that League
// (its locked roster is being fixed); else Leagues not ended where the team's roster isn't locked yet. The caller has
// checked who may change the roster. Never stops anything.
export async function addWarnings(q: Pick<Queryable, "query">, to: AddTo, entries: AddEntry[], now: Date): Promise<string[][]> {
  const out: string[][] = entries.map(() => []);
  if (!entries.length) return out;
  const [col, id] = "orgTeamId" in to ? ["org_team_id", to.orgTeamId] : "thunderTeamId" in to ? ["thunder_team_id", to.thunderTeamId] : ["id", to.teamId];
  const only = "programId" in to ? to.programId : null;
  const regs = await q.query<{ programId: string; program: string; teamId: string }>(
    `select p.id::text as "programId", p.name as program, t.id::text as "teamId"
       from scenic_teams t join scenic_registrations r on r.team_id = t.id and r.removed_at is null
       join scenic_programs p on p.id = r.program_id and p.kind = 'League'
      where t.${col} = $1
        and case when $2::bigint is null then p.ends_on >= $3::date
                   and not exists (select 1 from scenic_roster_snapshots s where s.program_id = p.id and s.team_id = t.id)
                 else p.id = $2::bigint end
      order by p.starts_on`,
    [id, only, easternDate(now)],
  );
  for (const g of regs.rows) {
    const { players, facts } = await playersOf(q, g.programId);
    const mine = facts.get(g.teamId);
    if (!mine) continue;
    entries.forEach((e, i) => {
      for (const p of players) {
        if (p.teamId === g.teamId) continue;
        const m = matchPlayers(e, p);
        const sameOrg = p.orgKey === mine.orgKey;
        // A maybe is only worth saying for the same name in the same organization, with a birthdate missing.
        if (!m || (m.strength === "Check" && !(sameOrg && (!e.dob || !p.dob)))) continue;
        const broken = rulesBroken(mine, p);
        if (!broken.length) continue;
        const who = `${e.first} ${e.last}`.trim();
        const is = m.strength === "Conflict" ? "is on" : "may be on";
        const line = sameOrg
          ? `${who} ${is} ${p.team} (${p.division} ${p.level}) in ${g.program}. ${broken.map((b) => RULE[b] ?? b).join(" ")}`
          : `${who} ${is} another organization's team in ${g.program}. ${broken.map((b) => RULE[b] ?? b).join(" ")}`;
        if (!out[i].includes(line)) out[i].push(line);
      }
    });
  }
  return out;
}

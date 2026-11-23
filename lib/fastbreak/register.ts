// The FastBreak list (Scenic City Teams → the FastBreak pill; a one-off for Winter 26/27, SPEC.md section 14 "To remove
// later"): every team registered in FastBreak Compete for a current League, one list, the ones not in Scenic City first.
// A team is in Scenic City when it was added from FastBreak before (linked by its FastBreak id), or a Scenic City team has
// the FastBreak Head Coach's cell with the same grade and gender (registered in the League, or one not registered yet).
// Register (a Director of Teams): links a matched team, or adds it to the FastBreak club (FastBreak is treated like an
// organization here) with its Head Coach (their cell is their login), named "5B <Team Name> Gray" (the Team Name filled in from FastBreak, editable),
// COMP or REC; then registers each week it signed up for in FastBreak as 1GG or 2GG (picked on the list), and puts it in
// the League's Brackets when it's in FastBreak's Championship. Who did it: the Director. Only teams and their staff are
// read from FastBreak; no cells or emails reach the page.
import type { Pool, PoolClient } from "pg";
import type { SessionUser } from "../auth/service";
import { cleanName } from "../auth/validate";
import { orgHasArea } from "../org-admin";
import { TeamError, resolveHead } from "../org-teams";
import { normalizeCell } from "../phone";
import { cleanPlaceName } from "../scenic-partners";
import { TEAM_COACHES, saveChoice } from "../scenic-programs";
import { withTx } from "../sql";
import { signupTeamName } from "../team-names";
import { easternDate } from "../time";
import type { FastbreakClient, FbTeam } from "./client";
import { eventUse, type League } from "./sync";

type Deps = { pool: Pool; now: () => Date; client: FastbreakClient };
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };
const by = (v: SessionUser) => `${v.firstName} ${v.lastName}`;
const notDirector = "Only a Scenic City Director of Teams can do that.";

export type FbListTeam = {
  fbId: number;
  name: string; // FastBreak's team name
  grade: number;
  gender: "Boys" | "Girls" | "Boys & Girls";
  coach: string | null; // the Head Coach's name in FastBreak
  coachLast: string | null; // their last name, the end of its Scenic City name
  part: string; // the middle of its Scenic City name ("5B <part> Gray"): FastBreak's team name to start, editable
  weeks: string[]; // the League's Game Days it signed up for (YYYY-MM-DD)
  brackets: boolean; // in FastBreak's Championship: put in the League's Brackets
  // In Scenic City: linked, or the same coach's team (registered in the League, or one not registered yet).
  here: { id: string; name: string; level: string; how: "linked" | "coach"; registered: boolean } | null;
};

type Use = { program: League; days: Set<string>; brackets: boolean };
type Wanted = { team: FbTeam; uses: Map<string, Use> };
type LeagueDays = League & { bracketDays: string[] };

// FastBreak's teams in the current Leagues: each week (a single-day event on a Game Day) it signed up for, and whether
// it's in the Championship (a multi-day event over the League's Bracket Days).
async function readFastbreak(deps: Deps): Promise<{ leagues: LeagueDays[]; wanted: Map<number, Wanted> }> {
  const today = easternDate(deps.now());
  const leagues = (
    await deps.pool.query<LeagueDays>(
      `select p.id::text, p.name,
              array(select to_char(g.day, 'YYYY-MM-DD') from program_game_days pg join game_days g on g.id = pg.game_day_id
                    where pg.program_id = p.id and pg.kind = 'game' order by g.day) as "gameDays",
              array(select to_char(g.day, 'YYYY-MM-DD') from program_game_days pg join game_days g on g.id = pg.game_day_id
                    where pg.program_id = p.id and pg.kind = 'bracket' order by g.day) as "bracketDays"
         from scenic_programs p where p.kind = 'League' and p.ends_on >= $1::date order by p.starts_on, p.id`,
      [today],
    )
  ).rows;
  const wanted = new Map<number, Wanted>();
  const entryFor = (t: FbTeam, program: League) => {
    const w = wanted.get(t.id) ?? { team: t, uses: new Map() };
    wanted.set(t.id, w);
    const u = w.uses.get(program.id) ?? { program, days: new Set<string>(), brackets: false };
    w.uses.set(program.id, u);
    return u;
  };
  for (const e of await deps.client.events()) {
    const week = eventUse(e, leagues);
    const champ =
      !week && !e.archived && e.sportId === 2 && e.type === "multi-day"
        ? leagues.find((l) => l.bracketDays.some((d) => d >= e.start && d <= e.end))
        : undefined;
    if (!week && !champ) continue;
    for (const t of await deps.client.teams(e.id)) {
      if (week) entryFor(t, week.program).days.add(week.day);
      else if (champ) entryFor(t, champ).brackets = true;
    }
  }
  return { leagues, wanted };
}

const genderOf = (t: FbTeam) => (t.genderId === 1 ? "Boys" : t.genderId === 2 ? "Girls" : "Boys & Girls") as FbListTeam["gender"];
const headOf = (t: FbTeam) => {
  const staff = t.staff ?? [];
  return staff.find((x) => /head/i.test(x.title ?? "")) ?? staff[0];
};

// FastBreak's team name as the start of its Scenic City Team Name, without a trailing coach's name ("Dalton Cats -
// Harrell" → "Dalton Cats"); its organization's name when the team's isn't usable.
function partOf(t: FbTeam, coachLast: string | null): string {
  let name = (t.name ?? "").trim();
  if (coachLast) name = name.replace(new RegExp(`\\s*-\\s*${coachLast.replace(/[^\p{L}' .-]/gu, "")}$`, "iu"), "");
  return cleanPlaceName(name) ?? cleanPlaceName(t.organizationName) ?? "";
}

// The Scenic City team for a FastBreak team: added from FastBreak before, or a Scenic City team whose Head or Assistant
// Coach has the FastBreak Head Coach's cell, with the same grade and gender: registered in one of these Leagues first,
// else one not registered yet (Teams → Not registered).
const REGISTERED = `exists (select 1 from scenic_registrations r where r.team_id = t.id and r.program_id = any($1::bigint[]) and r.removed_by is null)`;
async function matchOf(q: Pick<PoolClient, "query">, t: FbTeam, programIds: string[]): Promise<FbListTeam["here"]> {
  const linked = await q.query<{ id: string; name: string; level: string; registered: boolean }>(
    `select t.id::text, t.name, t.level, ${REGISTERED} as registered from scenic_teams t where t.fastbreak_id = $2`,
    [programIds, t.id],
  );
  if (linked.rows[0]) return { ...linked.rows[0], how: "linked" };
  const cell = headOf(t)?.phone ? normalizeCell(headOf(t)!.phone!) : null;
  const gender = genderOf(t);
  if (!cell || gender === "Boys & Girls") return null;
  const r = await q.query<{ id: string; name: string; level: string; registered: boolean }>(
    `select t.id::text, t.name, t.level, ${REGISTERED} as registered from scenic_teams t
      where t.gender = $3 and t.grade = $4 and t.fastbreak_id is null and t.name not like '%(DEV)'
        and exists (select 1 from json_array_elements(${TEAM_COACHES}) x(c) join users u on x.c->>'key' = 'u:' || u.coach_id where u.cell = $2)
      order by ${REGISTERED} desc, t.id limit 1`,
    [programIds, cell, gender, t.grade],
  );
  return r.rows[0] ? { ...r.rows[0], how: "coach" } : null;
}

// Not in Scenic City first, then in it but not registered yet, then registered.
const rank = (t: FbListTeam) => (!t.here ? 0 : !t.here.registered ? 1 : 2);

// The list, or null when the viewer isn't a Director of Teams: not in Scenic City first, then by grade and name.
export async function fastbreakList(deps: Deps, viewer: SessionUser): Promise<Result<{ teams: FbListTeam[] }> | null> {
  if (!(await orgHasArea(deps.pool, viewer.coachId, "scenic-city", "teams"))) return null;
  let read;
  try {
    read = await readFastbreak(deps);
  } catch (e) {
    return { ok: false, message: `Couldn't read FastBreak: ${e instanceof Error ? e.message : String(e)}` };
  }
  const ids = read.leagues.map((l) => l.id);
  const teams: FbListTeam[] = [];
  for (const { team, uses } of read.wanted.values()) {
    const head = headOf(team);
    const coachLast = cleanName(head?.lastName) || null;
    teams.push({
      fbId: team.id,
      name: team.name,
      grade: team.grade,
      gender: genderOf(team),
      coach: head ? `${head.firstName ?? ""} ${head.lastName ?? ""}`.trim() || null : null,
      coachLast,
      part: partOf(team, coachLast),
      weeks: [...uses.values()].flatMap((u) => [...u.days]).sort(),
      brackets: [...uses.values()].some((u) => u.brackets),
      here: await matchOf(deps.pool, team, ids),
    });
  }
  teams.sort((a, b) => rank(a) - rank(b) || a.grade - b.grade || a.name.localeCompare(b.name));
  return { ok: true, teams };
}

// The FastBreak club: FastBreak is treated like an organization here (its teams say "FastBreak", tag FB). Made once.
async function fastbreakClub(q: PoolClient, who: string): Promise<string> {
  const had = await q.query<{ id: string }>("select id::text from partners where lower(name) = 'fastbreak' order by id limit 1");
  if (had.rows[0]) return had.rows[0].id;
  const r = await q.query<{ id: string }>(
    `insert into partners (name, kind, hosts_games, registers_teams, approved, created_by, abbr)
     values ('FastBreak', 'Organization', false, true, true, $1, 'FB') returning id::text`,
    [who],
  );
  return r.rows[0].id;
}

// A new team for a FastBreak team, in the FastBreak club, coached by its Head Coach (their login, made from FastBreak's cell).
async function addFastbreakTeam(q: PoolClient, now: Date, t: FbTeam, part: string, level: "COMP" | "REC", who: string): Promise<string> {
  const gender = t.genderId === 1 ? "Boys" : t.genderId === 2 ? "Girls" : null;
  if (!gender) throw new TeamError("FastBreak lists it as Boys & Girls; add it by hand.");
  if (!Number.isInteger(t.grade) || t.grade < 0 || t.grade > 12) throw new TeamError(`Grade ${t.grade} isn't K–12.`);
  const s = headOf(t);
  const first = cleanName(s?.firstName);
  const last = cleanName(s?.lastName);
  const cell = s?.phone ? normalizeCell(s.phone) : null;
  if (!first || !last || !cell) throw new TeamError("FastBreak has no Head Coach with a good cell for it; add it by hand.");
  const head = await resolveHead(q, { first, last, cell }, now);
  if (!head) throw new TeamError("FastBreak has no Head Coach with a good cell for it; add it by hand.");
  const email = s?.email?.trim().toLowerCase();
  if (email && /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/.test(email))
    await q.query("update users set email = $2 where coach_id = $1 and email is null", [head.coachId, email]);
  const r = await q.query<{ id: string }>(
    `insert into scenic_teams (name, gender, grade_low, grade, level, partner_id, coach_id, alt_name, fastbreak_id,
                               created_by, created_at, updated_by, updated_at)
     values ($1, $2, $3, $3, $4, $5, $6, $7, $8, $9, $10, $9, $10) returning id::text`,
    [signupTeamName(gender, String(t.grade), part, head.lastName), gender, t.grade, level, await fastbreakClub(q, who), head.coachId, cleanPlaceName(t.name), t.id, who, now],
  );
  await q.query("select set_role($1, 'scenic-city', 'Coach', true, $2), set_role($1, 'scenic-city', 'Request', false, $2)", [head.coachId, who]);
  return r.rows[0].id;
}

// The weeks it signed up for in FastBreak that aren't registered yet (past ones left out), each 1GG or 2GG as picked.
// A team made ALL Season in the app keeps that.
async function registerWeeks(q: PoolClient, now: Date, teamId: string, u: Use, twoGames: Set<string>, who: string) {
  const today = easternDate(now);
  const had = (
    await q.query<{ all_season: boolean; days: string[] }>(
      `select r.all_season, array(select to_char(g.day, 'YYYY-MM-DD') from scenic_registration_days d join game_days g on g.id = d.game_day_id
                                  where d.program_id = r.program_id and d.team_id = r.team_id) as days
         from scenic_registrations r where r.program_id = $1 and r.team_id = $2`,
      [u.program.id, teamId],
    )
  ).rows[0];
  const days = had?.all_season ? [] : [...u.days].filter((d) => d >= today && !had?.days.includes(d)).sort();
  if (!days.length) return;
  const r = await saveChoice(
    q,
    u.program.id,
    teamId,
    { allSeason: false, days: days.map((date) => ({ date, kind: twoGames.has(date) ? "single_2" : "single_1" })) },
    who,
    now,
    false, // registered in FastBreak: options' own closes don't apply
    true, // picked here by a Director of Teams: "REC open to" doesn't apply
  );
  if ("error" in r) throw new TeamError(r.error);
}

// Register one FastBreak team in Scenic City (a Director of Teams): link the matched team or add it to the FastBreak club, then
// register the weeks it signed up for in FastBreak that aren't registered yet (`twoGames`: the dates picked as 2GG; the
// rest 1GG), and put it in the Brackets when it's in FastBreak's Championship. One at a time (a lock); all or nothing.
// `part`: the middle of a new team's name ("5B <part> Gray"; up to 30 letters). `level`: COMP to start, or REC.
export async function registerFastbreakTeam(
  deps: Deps,
  viewer: SessionUser,
  fbId: unknown,
  opts: { part?: unknown; level?: unknown; twoGames?: unknown } = {},
): Promise<Result<{ name: string; how: "linked" | "added" }>> {
  if (typeof fbId !== "number" || !Number.isInteger(fbId) || fbId <= 0) return { ok: false, message: "Pick a team." };
  const level = opts.level ?? "COMP";
  if (level !== "COMP" && level !== "REC") return { ok: false, message: "Pick COMP or REC." };
  const middle = opts.part === undefined || opts.part === null || opts.part === "" ? null : cleanPlaceName(opts.part);
  if (opts.part && (!middle || middle.length > 30)) return { ok: false, message: "Team Name: up to 30 letters, numbers and spaces." };
  const two = opts.twoGames ?? [];
  if (!Array.isArray(two) || two.some((d) => typeof d !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d)))
    return { ok: false, message: "Pick 1GG or 2GG for each week." };
  if (!(await orgHasArea(deps.pool, viewer.coachId, "scenic-city", "teams"))) return { ok: false, message: notDirector };
  let read;
  try {
    read = await readFastbreak(deps);
  } catch (e) {
    return { ok: false, message: `Couldn't read FastBreak: ${e instanceof Error ? e.message : String(e)}` };
  }
  const w = read.wanted.get(fbId);
  if (!w) return { ok: false, message: "That team isn't in FastBreak's current events anymore." };
  const now = deps.now();
  const who = by(viewer);
  try {
    return await withTx(deps.pool, async (q) => {
      await q.query("select pg_advisory_xact_lock(hashtext('sync:fastbreak:' || current_schema()))");
      const here = await matchOf(q, w.team, read.leagues.map((l) => l.id));
      let id: string;
      if (here?.how === "linked") id = here.id;
      else if (here) {
        id = here.id;
        await q.query("update scenic_teams set fastbreak_id = $2 where id = $1 and fastbreak_id is null", [id, fbId]);
      } else id = "";
      // A team not registered anywhere yet (new, or one waiting in Teams → Not registered) takes the level picked.
      if (here && !here.registered && opts.level !== undefined)
        await q.query(
          `update scenic_teams set level = $2, updated_by = $3, updated_at = $4
            where id = $1 and level <> $2 and not exists (select 1 from scenic_registrations r where r.team_id = $1)`,
          [id, level, who, now],
        );
      if (!here) {
        const coachLast = cleanName(headOf(w.team)?.lastName) || null;
        const part = middle ?? partOf(w.team, coachLast);
        if (!part) throw new TeamError("Type its Team Name.");
        id = await addFastbreakTeam(q, now, w.team, part, level, who);
      }
      for (const u of w.uses.values()) {
        await registerWeeks(q, now, id, u, new Set(two as string[]), who);
        if (!u.brackets) continue;
        // In FastBreak's Championship: in the League's Brackets (it needs a registration there first).
        const r = await q.query(
          `update scenic_registrations set bracket_by = $3, bracket_at = $4
            where program_id = $1 and team_id = $2 and bracket_by is null`,
          [u.program.id, id, who, now],
        );
        const there =
          r.rowCount || (await q.query("select 1 from scenic_registrations where program_id = $1 and team_id = $2", [u.program.id, id])).rowCount;
        if (!there) throw new TeamError(`It's in FastBreak's Championship but no ${u.program.name} weeks; register it by hand first.`);
      }
      const name = (await q.query<{ name: string }>("select name from scenic_teams where id = $1", [id])).rows[0].name;
      return { ok: true as const, name, how: here ? ("linked" as const) : ("added" as const) };
    });
  } catch (e) {
    if (e instanceof TeamError) return { ok: false, message: e.message };
    if ((e as { code?: string }).code === "23505")
      return { ok: false, message: "That coach already has a team with this name. Change its Team Name." };
    throw e;
  }
}

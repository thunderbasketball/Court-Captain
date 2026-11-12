// Scrimmages (SPEC.md section 14): an organization with CourtPlayers schedules scrimmage games for the teams in its
// player programs. Two of its own teams, or one of its teams against an outside team typed in; at one of its gyms
// (the whole gym: every goal's open practice slots in that time are blocked, noted "Scrimmage", freed when it's removed),
// or at any place typed in. Who adds and removes them: the organization's Admins and Directors of Teams or Events, and
// the Head Coach of one of its teams playing. Checked here, on the server.
import type { Pool, PoolClient } from "pg";
import type { SessionUser } from "./auth/service";
import { NO_FEATURE, hasFeature } from "./features";
import { hasArea, orgHasArea } from "./org-admin";
import { officiatesGames } from "./officiating";
import { managesOfficials } from "./officials";
import { listOrgs } from "./org-registry";
import type { OrgSlug } from "./orgs";
import { withTx } from "./sql";
import { cleanLocation } from "./team-practices";
import { TZ, zonedTime } from "./time";

type Deps = { pool: Pool; now: () => Date };
type Q = Pick<PoolClient, "query">;
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

export type Scrimmage = {
  id: string;
  startsAt: Date;
  minutes: number;
  home: string;
  away: string;
  outside: boolean; // the away team is an outside team
  place: string;
  atOurGym: boolean; // its gym time is blocked
  addedBy: string;
  officials: string | null; // the Officials Group scheduling its officials
  // For Edit: what the form starts with.
  form: {
    home: string;
    away: string;
    awayName: string;
    date: string;
    time: string;
    minutes: string;
    gymId: string;
    location: string;
    officials: string; // an Officials Group, or ""
  };
};
export type ScrimmageChoices = {
  teams: { id: string; name: string }[];
  gyms: { id: string; name: string }[];
  officials: { org: string; name: string }[]; // Officials Groups to schedule officials from
};

const ID = /^\d{1,18}$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^(\d{2}):(\d{2})$/;
export const SCRIMMAGE_MINUTES = [30, 60, 90, 120];
export const TBD = "tbd"; // a team picked later
const thunder = (org: string) => org === "thunder";
const by = (v: SessionUser) => `${v.firstName} ${v.lastName}`;

// Scrimmages come with CourtPlayers.
export const scrimmagesOn = (q: Q, org: string) => hasFeature(q, org as OrgSlug, "player-registration");

// The organization's Admins and Directors of Teams or Events (Thunder's Directors from the session, re-read per request).
async function directs(q: Q, viewer: SessionUser, org: string): Promise<boolean> {
  return thunder(org) ? hasArea(viewer, "teams", "events") : orgHasArea(q, viewer.coachId, org as OrgSlug, "teams", "events");
}

// Is this person the Head Coach of any of these teams of the organization?
async function headCoachOf(q: Q, viewer: SessionUser, org: string, teamIds: string[]): Promise<boolean> {
  if (!teamIds.length) return false;
  const r = thunder(org)
    ? await q.query("select 1 from team_staff where team_id = any($1::bigint[]) and coach_id = $2 and role = 'HeadCoach' limit 1", [
        teamIds,
        viewer.coachId,
      ])
    : await q.query(
        `select 1 from org_team_coaches c join org_teams t on t.id = c.team_id
          where c.team_id = any($1::bigint[]) and t.org = $3 and c.coach_id = $2 and c.role = 'HeadCoach' limit 1`,
        [teamIds, viewer.coachId, org],
      );
  return !!r.rowCount;
}

// The program's card shows + Scrimmage to the organization's Admins and Directors of Teams or Events.
export async function addsScrimmages(q: Q, viewer: SessionUser, org: string): Promise<boolean> {
  return (await scrimmagesOn(q, org)) && directs(q, viewer, org);
}

// The organization's teams (by name) and active gyms, for the form. A scrimmage takes the whole gym (its courts are the
// goals, used only for practices).
export async function scrimmageChoices(deps: Pick<Deps, "pool">, org: string): Promise<ScrimmageChoices> {
  const [teams, gyms] = await Promise.all([
    thunder(org)
      ? deps.pool.query<{ id: string; name: string }>("select id::text, name from teams order by grade_sort, gender, lower(name)")
      : deps.pool.query<{ id: string; name: string }>(
          "select id::text, name from org_teams where org = $1 and archived_at is null order by grade, gender, lower(name)",
          [org],
        ),
    deps.pool.query<ScrimmageChoices["gyms"][number]>(
      "select id::text, name from gyms where org = $1 and active order by lower(name)",
      [org],
    ),
  ]);
  return { teams: teams.rows, gyms: gyms.rows, officials: await officialsGroups(deps.pool, org) };
}

// Every Officials Group on CourtCaptain (CourtOfficials with CourtSync), by name; never the organization itself.
export async function officialsGroups(q: Q, org: string): Promise<{ org: string; name: string }[]> {
  const out: { org: string; name: string }[] = [];
  for (const o of await listOrgs(q)) if (o.slug !== org && (await officiatesGames(q, o.slug))) out.push({ org: o.slug, name: o.name });
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

const TEAM_NAME = (org: string, side: "home" | "away") =>
  thunder(org)
    ? `(select name from teams where id = s.${side}_thunder_team_id)`
    : `(select name from org_teams where id = s.${side}_org_team_id)`;

// A program's scrimmages that haven't ended yet, soonest first.
export async function upcomingScrimmages(deps: Deps, org: string, programId: string): Promise<Scrimmage[]> {
  if (!ID.test(programId) || !(await scrimmagesOn(deps.pool, org))) return [];
  const r = await deps.pool.query<Scrimmage>(
    `select s.id::text, s.starts_at as "startsAt", s.minutes, coalesce(${TEAM_NAME(org, "home")}, 'TBD') as home,
            coalesce(s.away_name, ${TEAM_NAME(org, "away")}, 'TBD') as away, s.away_name is not null as outside,
            s.place, s.gym_id is not null as "atOurGym", s.added_by as "addedBy",
            (select name from organizations where slug = s.officials_org) as officials,
            json_build_object(
              'home', coalesce(coalesce(s.home_thunder_team_id, s.home_org_team_id)::text, 'tbd'),
              'away', case when s.away_name is not null then 'outside'
                           else coalesce(coalesce(s.away_thunder_team_id, s.away_org_team_id)::text, 'tbd') end,
              'awayName', coalesce(s.away_name, ''),
              'date', to_char(s.starts_at at time zone $4, 'YYYY-MM-DD'), 'time', to_char(s.starts_at at time zone $4, 'HH24:MI'),
              'minutes', s.minutes::text,
              'gymId', coalesce(s.gym_id::text, 'elsewhere'), 'location', case when s.gym_id is null then s.place else '' end,
              'officials', coalesce(s.officials_org, '')
            ) as form
       from scrimmages s
      where s.org = $1 and s.program_id = $2 and s.starts_at + make_interval(mins => s.minutes) > $3
      order by s.starts_at, s.id`,
    [org, programId, deps.now(), TZ],
  );
  return r.rows;
}

// One scrimmage on a team's schedule (Next 7 days, Games, the Teams page's 📅): who it plays (another of the
// organization's teams, an outside team, or TBD), when, how long and where.
export type TeamScrimmage = { id: string; startsAt: Date; minutes: number; opponent: string; outside: boolean; place: string };

// These teams' scrimmages that haven't ended yet, by team id, soonest first (none when the feature is off).
export async function teamScrimmages(deps: Deps, org: string, teamIds: string[]): Promise<Record<string, TeamScrimmage[]>> {
  const ids = teamIds.filter((t) => ID.test(t));
  if (!ids.length || !(await scrimmagesOn(deps.pool, org))) return {};
  const col = thunder(org) ? "thunder_team_id" : "org_team_id";
  const r = await deps.pool.query<TeamScrimmage & { team: string }>(
    `select x.team, s.id::text, s.starts_at as "startsAt", s.minutes, s.place, s.away_name is not null and x.home as outside,
            case when x.home then coalesce(s.away_name, ${TEAM_NAME(org, "away")}, 'TBD') else coalesce(${TEAM_NAME(org, "home")}, 'TBD') end
              as opponent
       from scrimmages s
       cross join lateral (values (s.home_${col}::text, true), (s.away_${col}::text, false)) x(team, home)
      where s.org = $1 and x.team = any($2::text[]) and s.starts_at + make_interval(mins => s.minutes) > $3
      order by s.starts_at, s.id`,
    [org, ids, deps.now()],
  );
  const out: Record<string, TeamScrimmage[]> = {};
  for (const { team, ...x } of r.rows) (out[team] ??= []).push(x);
  return out;
}

export type ScrimmageInput = {
  home: unknown; // one of the organization's teams, or "tbd"
  away: unknown; // another of its teams, "tbd", or "" with awayName
  awayName?: unknown; // an outside team
  date: unknown; // "2026-12-12"
  time: unknown; // "10:00"
  minutes: unknown;
  gymId?: unknown; // one of its gyms (the whole gym: every goal), or "" with location
  location?: unknown; // any other place
  officials?: unknown; // an Officials Group to schedule officials, or "" for none
};

// A team name typed in: letters, numbers and simple punctuation, never starting like a formula.
function cleanTeamName(v: unknown): string | null {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  if (!s || s.length > 60 || /^[=+\-@]/.test(s) || !/^[\p{L}\p{N} .,'&#()/:-]+$/u.test(s)) return null;
  return s;
}

function parseWhen(date: unknown, time: unknown): Date | null {
  const d = DATE.exec(String(date ?? ""));
  const t = TIME.exec(String(time ?? ""));
  if (!d || !t) return null;
  const [y, m, day, hh, mm] = [Number(d[1]), Number(d[2]), Number(d[3]), Number(t[1]), Number(t[2])];
  const check = new Date(Date.UTC(y, m - 1, day));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== day || hh > 23 || mm > 59) return null;
  return zonedTime(y, m, day, hh, mm);
}

// Add a scrimmage to a program. At one of the organization's gyms, every goal's practice slots in that time must be open
// (not booked, not blacked out) and no other scrimmage there; they're blocked for it.
export async function addScrimmage(
  deps: Deps,
  viewer: SessionUser,
  org: string,
  programId: unknown,
  input: ScrimmageInput,
): Promise<Result<{ id: string; blocked: number }>> {
  if (!ID.test(String(programId ?? ""))) return { ok: false, message: "That program wasn't found." };
  return saveScrimmage(deps, viewer, org, { programId: String(programId) }, input);
}

// Change a scrimmage that hasn't started (teams, time, length, place). The gym time it blocked is freed, then the new
// time is checked and blocked the same way as when adding.
export async function updateScrimmage(
  deps: Deps,
  viewer: SessionUser,
  org: string,
  id: unknown,
  input: ScrimmageInput,
): Promise<Result<{ id: string; blocked: number }>> {
  if (!ID.test(String(id ?? ""))) return { ok: false, message: "That scrimmage wasn't found." };
  return saveScrimmage(deps, viewer, org, { id: String(id) }, input);
}

async function saveScrimmage(
  deps: Deps,
  viewer: SessionUser,
  org: string,
  target: { programId: string } | { id: string },
  input: ScrimmageInput,
): Promise<Result<{ id: string; blocked: number }>> {
  const homeIn = String(input.home ?? "");
  const awayIn = String(input.away ?? "");
  if (homeIn !== TBD && !ID.test(homeIn)) return { ok: false, message: "Pick your team, or TBD." };
  const home = homeIn === TBD ? "" : homeIn;
  const away = awayIn === TBD ? "" : awayIn;
  const awayName = awayIn ? null : cleanTeamName(input.awayName);
  if (awayIn && awayIn !== TBD && !ID.test(awayIn)) return { ok: false, message: "Pick the other team." };
  if (!awayIn && !awayName) return { ok: false, message: "Pick the other team, or type the outside team's name (letters and numbers)." };
  if (home && away === home) return { ok: false, message: "Pick two different teams." };
  const startsAt = parseWhen(input.date, input.time);
  if (!startsAt) return { ok: false, message: "Pick the date and start time." };
  const minutes = Number(input.minutes);
  if (!SCRIMMAGE_MINUTES.includes(minutes)) return { ok: false, message: "Pick how long it runs." };
  if (startsAt.getTime() <= deps.now().getTime()) return { ok: false, message: "That time has already passed." };
  const gymId = String(input.gymId ?? "");
  const location = gymId ? null : cleanLocation(input.location);
  if (gymId && !ID.test(gymId)) return { ok: false, message: "Pick the gym." };
  if (!gymId && !location) return { ok: false, message: "Pick one of your gyms, or type the place (letters and numbers)." };
  if (!(await scrimmagesOn(deps.pool, org))) return { ok: false, message: NO_FEATURE };
  const officials = String(input.officials ?? "") || null;
  if (officials && !(await officialsGroups(deps.pool, org)).some((g) => g.org === officials))
    return { ok: false, message: "Pick an officials group from the list." };
  const ends = new Date(startsAt.getTime() + minutes * 60_000);
  const editing = "id" in target ? target.id : null;

  return withTx(deps.pool, async (q) => {
    const ours = [home, away].filter(Boolean);
    const director = await directs(q, viewer, org);
    if (editing) {
      // A Head Coach changes only a scrimmage their team plays, and keeps their team in it.
      const old = (
        await q.query<{ starts_at: Date; home: string | null; away: string | null }>(
          `select starts_at, coalesce(home_thunder_team_id, home_org_team_id)::text as home,
                  coalesce(away_thunder_team_id, away_org_team_id)::text as away
             from scrimmages where id = $1 and org = $2 for update`,
          [editing, org],
        )
      ).rows[0];
      if (!old) return { ok: false as const, message: "That scrimmage wasn't found." };
      const before = [old.home, old.away].filter((x): x is string => !!x);
      if (!director && !((await headCoachOf(q, viewer, org, before)) && (await headCoachOf(q, viewer, org, ours))))
        return { ok: false as const, message: "Only the Directors and a playing team's Head Coach can change a scrimmage." };
      if (old.starts_at.getTime() <= deps.now().getTime())
        return { ok: false as const, message: "That scrimmage has started; it stays as it was." };
      await q.query(
        "update slots set blackout = false, note = null, booked_by = null, booked_at = null, scrimmage_id = null where scrimmage_id = $1",
        [editing],
      );
    } else {
      if (!director && !(await headCoachOf(q, viewer, org, ours)))
        return { ok: false as const, message: "Only the Directors and a playing team's Head Coach can add a scrimmage." };
      const prog = await q.query("select 1 from player_programs where id = $1 and org = $2", [(target as { programId: string }).programId, org]);
      if (!prog.rowCount) return { ok: false as const, message: "That program wasn't found." };
    }
    const teams = thunder(org)
      ? await q.query("select id from teams where id = any($1::bigint[])", [ours])
      : await q.query("select id from org_teams where id = any($1::bigint[]) and org = $2 and archived_at is null", [ours, org]);
    if (teams.rowCount !== ours.length) return { ok: false as const, message: "Pick teams from your list." };

    let place = location ?? "";
    if (gymId) {
      const g = (
        await q.query<{ name: string }>("select name from gyms where id = $1 and org = $2 and active for update", [gymId, org])
      ).rows[0];
      if (!g) return { ok: false as const, message: "Pick one of your gyms." };
      place = g.name;
      const clash = await q.query(
        `select 1 from scrimmages where gym_id = $1 and starts_at < $2 and starts_at + make_interval(mins => minutes) > $3
            and id is distinct from $4::bigint limit 1`,
        [gymId, ends, startsAt, editing],
      );
      if (clash.rowCount) return { ok: false as const, message: "Another scrimmage is in that gym then." };
      // The whole gym: every goal's practice slots (an hour long) overlapping its time must be open.
      const busy = await q.query<{ team: string | null; blackout: boolean }>(
        `select (select name from teams where id = s.team_id) as team, s.blackout from slots s join courts c on c.id = s.court_id
          where c.gym_id = $1 and s.starts_at < $2 and s.starts_at + interval '1 hour' > $3 and (s.team_id is not null or s.blackout)
          order by s.starts_at limit 1 for update of s`,
        [gymId, ends, startsAt],
      );
      if (busy.rows[0])
        return {
          ok: false as const,
          message: busy.rows[0].team
            ? `That gym has a practice booked then (${busy.rows[0].team}). Pick another gym or time, or cancel that practice first.`
            : "That gym is blacked out then. Pick another gym or time.",
        };
    }

    const col = thunder(org) ? "thunder_team_id" : "org_team_id";
    const values = [home || null, away || null, awayName, startsAt, minutes, gymId || null, place, officials];
    const id = editing
      ? (await q.query(
          `update scrimmages set home_${col} = $2, away_${col} = $3, away_name = $4, starts_at = $5, minutes = $6, gym_id = $7, place = $8,
                  officials_org = $9
            where id = $1`,
          [editing, ...values],
        ),
        editing)
      : (
          await q.query<{ id: string }>(
            `insert into scrimmages (org, program_id, home_${col}, away_${col}, away_name, starts_at, minutes, gym_id, place, officials_org,
                                     added_by, added_at)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning id::text`,
            [org, (target as { programId: string }).programId, ...values, by(viewer), deps.now()],
          )
        ).rows[0].id;
    if (editing) {
      // Its officials stay only with the same group, and only while the new time doesn't put them on two games at once.
      await q.query(
        `delete from game_officials o using scrimmages s
          where o.scrimmage_id = $1 and s.id = o.scrimmage_id
            and (o.officials_org is distinct from s.officials_org
                 or exists (select 1 from game_officials x join scrimmages y on y.id = x.scrimmage_id
                             where x.coach_id = o.coach_id and x.scrimmage_id <> o.scrimmage_id
                               and y.starts_at < s.starts_at + make_interval(mins => s.minutes)
                               and s.starts_at < y.starts_at + make_interval(mins => y.minutes)))`,
        [editing],
      );
    }
    let blocked = 0;
    if (gymId) {
      const r = await q.query(
        `update slots s set blackout = true, note = 'Scrimmage', booked_by = $4, booked_at = $5, scrimmage_id = $6
           from courts c
          where c.id = s.court_id and c.gym_id = $1 and s.starts_at < $2 and s.starts_at + interval '1 hour' > $3
            and s.team_id is null and not s.blackout`,
        [gymId, ends, startsAt, by(viewer), deps.now(), id],
      );
      blocked = r.rowCount ?? 0;
    }
    return { ok: true as const, id, blocked };
  });
}

// Remove a scrimmage that hasn't started; the gym time it blocked opens again.
export async function removeScrimmage(deps: Deps, viewer: SessionUser, org: string, id: unknown): Promise<Result> {
  if (!ID.test(String(id ?? ""))) return { ok: false, message: "That scrimmage wasn't found." };
  if (!(await scrimmagesOn(deps.pool, org))) return { ok: false, message: NO_FEATURE };
  return withTx(deps.pool, async (q) => {
    const s = (
      await q.query<{ starts_at: Date; home: string | null; away: string | null }>(
        `select starts_at, coalesce(home_thunder_team_id, home_org_team_id)::text as home,
                coalesce(away_thunder_team_id, away_org_team_id)::text as away
           from scrimmages where id = $1 and org = $2 for update`,
        [id, org],
      )
    ).rows[0];
    if (!s) return { ok: false as const, message: "That scrimmage wasn't found." };
    const ours = [s.home, s.away].filter((x): x is string => !!x);
    if (!(await directs(q, viewer, org)) && !(await headCoachOf(q, viewer, org, ours)))
      return { ok: false as const, message: "Only the Directors and a playing team's Head Coach can remove a scrimmage." };
    if (s.starts_at.getTime() <= deps.now().getTime())
      return { ok: false as const, message: "That scrimmage has started; it stays on the schedule." };
    await q.query(
      "update slots set blackout = false, note = null, booked_by = null, booked_at = null, scrimmage_id = null where scrimmage_id = $1",
      [id],
    );
    await q.query("delete from scrimmages where id = $1", [id]);
    return { ok: true as const };
  });
}

// A game an Officials Group is asked to officiate: who plays, for which organization, when, how long and where.
export type GameToOfficiate = {
  id: string;
  org: string; // the organization playing it
  orgName: string;
  home: string;
  away: string;
  startsAt: Date;
  minutes: number;
  place: string;
  address: string | null;
};

// For an Officials Group's page (its Admins and Officials Assigners): the scrimmages that picked it and haven't ended,
// soonest first. Null for anyone else.
export async function gamesToOfficiate(deps: Deps, viewer: SessionUser, officialsOrg: string): Promise<GameToOfficiate[] | null> {
  if (!(await managesOfficials(deps.pool, viewer, officialsOrg))) return null;
  const name = (side: "home" | "away") =>
    `coalesce((select name from teams where id = s.${side}_thunder_team_id), (select name from org_teams where id = s.${side}_org_team_id))`;
  const r = await deps.pool.query<GameToOfficiate>(
    `select s.id::text, s.org, o.name as "orgName", coalesce(${name("home")}, 'TBD') as home,
            coalesce(s.away_name, ${name("away")}, 'TBD') as away, s.starts_at as "startsAt", s.minutes, s.place,
            nullif(g.address, '') as address
       from scrimmages s join organizations o on o.slug = s.org left join gyms g on g.id = s.gym_id
      where s.officials_org = $1 and s.starts_at + make_interval(mins => s.minutes) > $2
      order by s.starts_at, s.id`,
    [officialsOrg, deps.now()],
  );
  return r.rows;
}

// Warnings before a player is added to a roster (SPEC.md section 13, Roster conflicts): they look like a player on another
// team against the rule. Only for whoever may change that roster (checked here); no one else gets an answer, and nothing is
// saved or stopped.
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { birthdateOf, gradeOf } from "./birthdate-text";
import { mayManageLeagueTeam } from "./league-roster";
import { hasArea } from "./org-admin";
import { rosterOrg } from "./org-rosters";
import { addWarnings, type AddEntry, type AddTo } from "./roster-conflicts";
import { mayFixSnapshot } from "./roster-snapshot";

type Deps = { pool: Pool; now: () => Date };
const isId = (v: unknown): v is string => typeof v === "string" && /^\d{1,18}$/.test(v);
const text = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 60) : "");

export type WarnTarget =
  | { kind: "org"; org: string; teamId: string } // an organization's team
  | { kind: "league"; teamId: string } // a team the League keeps
  | { kind: "locked"; programId: string; teamId: string } // a locked League roster being fixed
  | { kind: "thunder"; teamId: string }; // Thunder's: players by registration id
type Typed = { first?: unknown; last?: unknown; grade?: unknown; birthdate?: unknown };

export async function rosterAddWarnings(deps: Deps, viewer: SessionUser, target: WarnTarget, players: unknown): Promise<string[]> {
  if (!target || !isId(target.teamId) || !Array.isArray(players)) return [];
  const list = players.slice(0, 100);
  let to: AddTo;
  let entries: AddEntry[];
  if (target.kind === "thunder") {
    if (!hasArea(viewer, "teams")) return [];
    to = { thunderTeamId: target.teamId };
    const r = await deps.pool.query<{ first: string; last: string; dob: string | null; grade: string | null }>(
      "select first_name as first, last_name as last, to_char(birthdate, 'YYYY-MM-DD') as dob, grade::text from registrations where registrant_id = any($1)",
      [list.filter((x) => typeof x === "string").slice(0, 100)],
    );
    entries = r.rows.map((x) => ({ ...x, grade: gradeOf(x.grade) }));
  } else {
    if (target.kind === "org") {
      if (!(await rosterOrg(deps.pool, viewer, target.org, target.teamId))) return [];
      if (!(await deps.pool.query("select 1 from org_teams where id = $1 and org = $2", [target.teamId, target.org])).rowCount) return [];
      to = { orgTeamId: target.teamId };
    } else if (target.kind === "league") {
      if (!(await mayManageLeagueTeam(deps.pool, viewer, target.teamId))) return [];
      to = { teamId: target.teamId };
    } else if (target.kind === "locked") {
      if (!(await mayFixSnapshot(deps.pool, viewer, target.programId, target.teamId))) return [];
      to = { teamId: target.teamId, programId: target.programId };
    } else return [];
    entries = list.map((x: Typed) => ({ first: text(x?.first), last: text(x?.last), dob: birthdateOf(x?.birthdate) ?? null, grade: gradeOf(x?.grade) }));
  }
  return (await addWarnings(deps.pool, to, entries, deps.now())).flat();
}

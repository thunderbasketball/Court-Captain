// Uniform numbers on typed-in rosters (SPEC.md section 14): every player needs one, unique on the team. Whoever may
// change the roster fills in the missing ones (or changes one) on the team page's Roster card: an organization's
// (lib/org-rosters) or a League team's kept by Scenic City (lib/league-roster). All saved or none, in one transaction;
// who set each is recorded. With CourtPlayers (like Thunder), numbers are set on Uniforms.
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { mayManageLeagueTeam } from "./league-roster";
import { rosterOrg } from "./org-rosters";
import { withTx } from "./sql";

type Deps = { pool: Pool; now: () => Date };
type Result = { ok: true } | { ok: false; message: string };
const isId = (v: unknown): v is string => typeof v === "string" && /^\d{1,18}$/.test(v);

function clean(input: unknown): Map<string, string> | string {
  if (!Array.isArray(input) || !input.length || input.length > 100) return "Enter at least one number.";
  const out = new Map<string, string>();
  for (const x of input) {
    const { id, number } = (x && typeof x === "object" ? x : {}) as { id?: unknown; number?: unknown };
    const n = typeof number === "string" ? number.trim().replace(/^#/, "") : "";
    if (!isId(id) || !/^[0-9]{1,2}$/.test(n)) return "Uniform numbers are 0 to 99.";
    out.set(id, n);
  }
  return out;
}

async function save(
  deps: Deps,
  viewer: SessionUser,
  t: { table: "org_team_players" | "scenic_team_players"; lock: string; lockParams: unknown[]; teamId: string },
  input: unknown,
): Promise<Result> {
  const numbers = clean(input);
  if (typeof numbers === "string") return { ok: false, message: numbers };
  return withTx(deps.pool, async (q) => {
    if (!(await q.query(t.lock, t.lockParams)).rowCount) return { ok: false as const, message: "That team no longer exists." };
    const players = (
      await q.query<{ id: string; name: string; jersey: string | null }>(
        `select id::text, first_name || ' ' || last_name as name, jersey from ${t.table} where team_id = $1`,
        [t.teamId],
      )
    ).rows;
    for (const id of numbers.keys())
      if (!players.some((p) => p.id === id)) return { ok: false as const, message: "A player isn't on this team any more. Refresh and try again." };
    for (const p of players) {
      const n = numbers.get(p.id);
      if (n === undefined) continue;
      const other = players.find((x) => x.id !== p.id && (numbers.get(x.id) ?? x.jersey) === n);
      if (other) return { ok: false as const, message: `#${n} is taken: ${p.name} and ${other.name}.` };
    }
    for (const [id, n] of numbers)
      await q.query(`update ${t.table} set jersey = $3, jersey_by = $4, jersey_at = $5 where id = $1 and team_id = $2 and jersey is distinct from $3`, [
        id,
        t.teamId,
        n,
        `${viewer.firstName} ${viewer.lastName}`,
        deps.now(),
      ]);
    return { ok: true as const };
  });
}

// An organization's typed-in roster (its Admins, Directors of Teams, or the team's Head and Assistant Coaches).
export async function setOrgNumbers(deps: Deps, viewer: SessionUser, org: unknown, teamId: unknown, input: unknown): Promise<Result> {
  if (!isId(teamId)) return { ok: false, message: "That team no longer exists." };
  const o = await rosterOrg(deps.pool, viewer, org, teamId);
  if (!o) return { ok: false, message: "Only the team's coaches and its Directors can change this roster." };
  return save(deps, viewer, { table: "org_team_players", lock: "select 1 from org_teams where id = $1 and org = $2 for update", lockParams: [teamId, o], teamId }, input);
}

// A League team's roster kept by Scenic City (its coach, or Scenic City's Directors of Teams, Owners and Admins).
export async function setLeagueNumbers(deps: Deps, viewer: SessionUser, teamId: unknown, input: unknown): Promise<Result> {
  if (!isId(teamId) || !(await mayManageLeagueTeam(deps.pool, viewer, teamId)))
    return { ok: false, message: "Only the team's coach or a Scenic City Director of Teams can change this." };
  return save(deps, viewer, { table: "scenic_team_players", lock: "select 1 from scenic_teams where id = $1 for update", lockParams: [teamId], teamId }, input);
}

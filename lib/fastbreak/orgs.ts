// The FastBreak page (Scenic City Teams → FastBreak; SPEC.md section 13): each organization seen in Fastbreak and what it
// is here, which a Director of Teams (or Admin) picks or changes: an outside club (one already here, or a new one), on
// CourtCaptain (its teams are skipped), or not picked yet (its teams wait). Sync now runs the import. Teams already
// added stay as they are when a pick changes. Who did it: the picker's name (the sync's own picks: "Fastbreak (auto)").
import type { Pool } from "pg";
import type { SessionUser } from "../auth/service";
import { orgHasArea } from "../org-admin";
import { TeamError } from "../org-teams";
import { clubFor, outsideClubs, type Club } from "../scenic-club-teams";
import { cleanPlaceName } from "../scenic-partners";
import { withTx } from "../sql";
import type { FastbreakClient } from "./client";
import { FASTBREAK_SYNC, syncFastbreak, type FastbreakReport } from "./sync";

type Deps = { pool: Pool; now: () => Date };
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

const notDirector = "Only a Scenic City Director of Teams can do that.";
const by = (v: SessionUser) => `${v.firstName} ${v.lastName}`;
const isDirector = (pool: Pick<Pool, "query">, viewer: SessionUser) => orgHasArea(pool, viewer.coachId, "scenic-city", "teams");

export type FbOrg = {
  id: string;
  fbName: string;
  kind: "waiting" | "skip" | "club";
  clubId: string | null;
  clubName: string | null;
  teams: number; // in Fastbreak at the last sync
  added: number; // this club's teams from Fastbreak here
  setBy: string | null;
  setAt: Date | null;
  suggested: string; // a new club's name (Fastbreak's, cleaned up)
};
export type FbTeamHere = { id: string; name: string; club: string; altName: string | null; days: string[]; createdAt: Date };

export type FastbreakPage = {
  orgs: FbOrg[];
  clubs: Club[];
  teams: FbTeamHere[];
  sync: { checkedAt: Date; ok: boolean; message: string } | null;
};

// Everything on the page, or null when the viewer isn't a Director of Teams. Organizations to pick first, then by name.
export async function fastbreakPage(deps: Deps, viewer: SessionUser): Promise<FastbreakPage | null> {
  if (!(await isDirector(deps.pool, viewer))) return null;
  const [orgs, clubs, teams, sync] = await Promise.all([
    deps.pool.query<Omit<FbOrg, "suggested">>(
      `select o.fb_org_id::text as id, o.fb_name as "fbName",
              case when o.skip or p.org_slug is not null then 'skip' when p.id is not null then 'club' else 'waiting' end as kind,
              p.id::text as "clubId", p.name as "clubName", o.teams,
              (select count(*)::int from scenic_teams t where t.partner_id = p.id and t.fastbreak_id is not null) as added,
              o.set_by as "setBy", o.set_at as "setAt"
         from fastbreak_orgs o left join partners p on p.id = o.partner_id`,
    ),
    outsideClubs(deps.pool),
    deps.pool.query<FbTeamHere>(
      `select t.id::text, t.name, p.name as club, t.alt_name as "altName", t.created_at as "createdAt",
              array(select to_char(g.day, 'YYYY-MM-DD') from scenic_registration_days d join game_days g on g.id = d.game_day_id
                     where d.team_id = t.id order by g.day) as days
         from scenic_teams t join partners p on p.id = t.partner_id
        where t.fastbreak_id is not null
        order by t.grade, t.gender, lower(t.name)`,
    ),
    deps.pool.query<{ checkedAt: Date; ok: boolean; message: string }>(
      `select checked_at as "checkedAt", ok, message from sync_status where name = $1`,
      [FASTBREAK_SYNC],
    ),
  ]);
  const order = { waiting: 0, club: 1, skip: 2 };
  return {
    orgs: orgs.rows
      .map((o) => ({ ...o, suggested: cleanPlaceName(o.fbName) ?? "" }))
      .sort((a, b) => order[a.kind] - order[b.kind] || a.fbName.localeCompare(b.fbName)),
    clubs,
    teams: teams.rows,
    sync: sync.rows[0] ?? null,
  };
}

// Pick what a Fastbreak organization is: "waiting", "skip" (on CourtCaptain), an outside club's id, or a new club
// ({ name, abbr }, made if it isn't here yet).
export async function setFastbreakOrg(deps: Deps, viewer: SessionUser, fbOrgId: unknown, pick: unknown): Promise<Result> {
  if (typeof fbOrgId !== "string" || !/^\d{1,18}$/.test(fbOrgId)) return { ok: false, message: "Pick an organization." };
  if (!(await isDirector(deps.pool, viewer))) return { ok: false, message: notDirector };
  try {
    return await withTx(deps.pool, async (q) => {
      const row = await q.query("select 1 from fastbreak_orgs where fb_org_id = $1 for update", [fbOrgId]);
      if (!row.rowCount) return { ok: false as const, message: "That organization isn't in Fastbreak's list anymore." };
      let partner: string | null = null;
      let skip = false;
      if (pick === "skip") skip = true;
      else if (pick !== "waiting") partner = (await clubFor(q, viewer, pick)).id;
      await q.query("update fastbreak_orgs set partner_id = $2, skip = $3, set_by = $4, set_at = $5 where fb_org_id = $1", [
        fbOrgId,
        partner,
        skip,
        by(viewer),
        deps.now(),
      ]);
      return { ok: true as const };
    });
  } catch (e) {
    if (e instanceof TeamError) return { ok: false, message: e.message };
    throw e;
  }
}

// Sync now: bring in what's new in Fastbreak.
export async function syncFastbreakNow(
  deps: Deps & { client: () => FastbreakClient },
  viewer: SessionUser,
): Promise<Result<{ report: FastbreakReport }>> {
  if (!(await isDirector(deps.pool, viewer))) return { ok: false, message: notDirector };
  let client: FastbreakClient;
  try {
    client = deps.client();
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
  const r = await syncFastbreak({ pool: deps.pool, now: deps.now, client });
  if (r.status === "busy") return { ok: false, message: "A sync is already running. Try again in a minute." };
  if (r.status === "failed") return { ok: false, message: r.message };
  return { ok: true, report: r.report };
}

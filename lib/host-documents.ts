// A hosting organization's Documents card (SPEC.md section 14): the Leagues' rules (PDFs their Directors of Programs
// add), a blank scoresheet, and scoresheets for each coming Game Day with games placed at its gyms. For its Owners,
// Admins and Directors of Facilities, when it hosts games (Hosting available).
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { canHost } from "./facilities";
import { orgHasArea } from "./org-admin";
import type { OrgSlug } from "./orgs";
import { localParts } from "./time";

type Deps = { pool: Pool; now: () => Date };

export type HostDocuments = {
  leagues: { id: string; name: string; rules: string | null }[]; // rules: the PDF's name, or null until the League adds it
  days: { day: string; gyms: { key: string; name: string; games: number }[] }[];
};

export const seesHostDocuments = async (q: Pick<Pool, "query">, viewer: SessionUser, org: OrgSlug) =>
  (await canHost(q, org)) && (await orgHasArea(q, viewer.coachId, org, "facilities"));

export async function hostDocuments(deps: Deps, viewer: SessionUser, org: OrgSlug): Promise<HostDocuments | null> {
  if (!(await seesHostDocuments(deps.pool, viewer, org))) return null;
  const p = localParts(deps.now());
  const today = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  const [leagues, games] = await Promise.all([
    deps.pool.query<{ id: string; name: string; rules: string | null }>(
      `select id::text, name, case when rules is not null then coalesce(rules_name, 'Rules.pdf') end as rules
         from scenic_programs where kind = 'League' and ends_on >= $1::date order by starts_on, lower(name)`,
      [today],
    ),
    deps.pool.query<{ day: string; key: string; name: string; games: number }>(
      `select to_char(m.day, 'YYYY-MM-DD') as day, 'o' || g.id as key, g.name, count(*)::int as games
         from scenic_matchups m join gyms g on m.court_key like 'o%' and g.id::text = split_part(substr(m.court_key, 2), '-', 1)
        where g.org = $1 and m.day >= $2::date
        group by m.day, g.id, g.name order by m.day, lower(g.name)`,
      [org, today],
    ),
  ]);
  const days: HostDocuments["days"] = [];
  for (const r of games.rows) {
    let d = days.at(-1);
    if (!d || d.day !== r.day) days.push((d = { day: r.day, gyms: [] }));
    d.gyms.push({ key: r.key, name: r.name, games: r.games });
  }
  return { leagues: leagues.rows, days };
}

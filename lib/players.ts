import "server-only";
import { db } from "./db";
import type { SessionUser } from "./auth/service";
import { getSyncStatus, type SyncStatus } from "./teamsnap/sync";
import { hasArea } from "./org-admin";

export type PlayerListItem = {
  registrantId: string;
  firstName: string;
  lastName: string;
  gender: "Boys" | "Girls";
  grade: string;
  birthdate: string | null;
  parentName: string | null;
  parentCell: string | null;
  parentEmail: string | null;
  coachRequest: string | null;
  coachingInterest: string | null;
  team: string | null; // the team they're rostered on
  addedBy: string | null; // added in the app (not from TeamSnap) by
  feesWaivedBy: string | null;
};

export type MemberPlayer = PlayerListItem & {
  gradeSort: number;
  interestedTeams: string[]; // teams that marked them Interested (shown on unrostered players)
  playsUp: string | null; // "3rd grader" when rostered on a team of another grade
  // More from registration, shown when the player's card is opened (Members → Players).
  parent2Name: string | null;
  parent2Cell: string | null;
  parent2Email: string | null;
  address: string | null; // "12 Main St, Chattanooga 37411"
  uniformSize: string | null;
  uniformNumber: string | null;
  totalFees: string | null; // "185.00"
  amountRemaining: string | null;
};
export type GradeTeam = { id: string; name: string; players: MemberPlayer[] };
export type GradeGroup = { gender: "Boys" | "Girls"; grade: string; unrostered: MemberPlayer[]; teams: GradeTeam[] };

const gradeOf = (sort: number) => (sort === 0 ? "K" : String(sort));
const ordinalOf = (g: string) => (g === "K" ? "Kindergartner" : `${g}${["", "st", "nd", "rd"][Number(g)] ?? "th"} grader`);

// Members → Players (Directors of Players or Teams). Boys then Girls, by grade; in each grade the unrostered players first
// (by last name), then each team's roster (teams by name). A rostered player is listed with their team's grade, noting
// their own grade when it differs ("plays up").
export async function listPlayersByGrade(
  viewer: SessionUser,
): Promise<{
  groups: GradeGroup[];
  total: number;
  boys: number;
  girls: number;
  importedAt: Date | null;
  importedBy: string | null;
  sync: SyncStatus | null;
}> {
  if (!hasArea(viewer, "players", "teams")) throw new Error("Director only");
  const r = await db.query<
    PlayerListItem &
      Omit<MemberPlayer, keyof PlayerListItem | "playsUp"> & { teamId: string | null; teamGrade: number | null }
  >(
    `select r.registrant_id as "registrantId", r.first_name as "firstName", r.last_name as "lastName", r.gender, r.grade,
            r.grade_sort as "gradeSort", to_char(r.birthdate, 'YYYY-MM-DD') as birthdate,
            nullif(trim(coalesce(r.parent1_first, '') || ' ' || coalesce(r.parent1_last, '')), '') as "parentName",
            r.parent1_cell as "parentCell", r.parent1_email as "parentEmail",
            r.coach_request as "coachRequest", r.coaching_interest as "coachingInterest",
            nullif(trim(coalesce(r.parent2_first, '') || ' ' || coalesce(r.parent2_last, '')), '') as "parent2Name",
            r.parent2_cell as "parent2Cell", r.parent2_email as "parent2Email",
            nullif(concat_ws(', ', nullif(trim(r.address), ''), nullif(trim(concat_ws(' ', nullif(trim(r.city), ''), nullif(trim(r.zip), ''))), '')), '') as address,
            nullif(trim(r.uniform_size), '') as "uniformSize", nullif(trim(r.uniform_number), '') as "uniformNumber",
            r.total_fees::text as "totalFees", r.amount_remaining::text as "amountRemaining",
            r.added_by as "addedBy", r.fees_waived_by as "feesWaivedBy",
            t.id::text as "teamId", t.name as team, t.grade_sort as "teamGrade",
            array(select t2.name from evaluations e join teams t2 on t2.id = e.team_id
                  where e.registrant_id = r.registrant_id and e.interested order by t2.name) as "interestedTeams"
     from registrations r
     left join lateral (select p.team_id from team_players p join teams x on x.id = p.team_id
                        where p.registrant_id = r.registrant_id order by x.name limit 1) tp on true
     left join teams t on t.id = tp.team_id
     order by lower(r.last_name), lower(r.first_name)`,
  );
  const groups = new Map<string, GradeGroup & { sort: number }>();
  for (const { teamId, teamGrade, ...p } of r.rows) {
    const sort = teamId !== null && teamGrade !== null ? teamGrade : p.gradeSort;
    const key = `${p.gender}|${String(sort).padStart(2, "0")}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { gender: p.gender, grade: gradeOf(sort), sort, unrostered: [], teams: [] }));
    const player: MemberPlayer = { ...p, playsUp: teamId !== null && p.gradeSort !== sort ? ordinalOf(p.grade) : null };
    if (teamId === null) g.unrostered.push(player);
    else {
      let t = g.teams.find((x) => x.id === teamId);
      if (!t) g.teams.push((t = { id: teamId, name: p.team!, players: [] }));
      t.players.push(player);
    }
  }
  const list: GradeGroup[] = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, g]) => ({ gender: g.gender, grade: g.grade, unrostered: g.unrostered, teams: g.teams }));
  for (const g of list) g.teams.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const imported = await db.query<{ at: Date; by: string }>(
    "select imported_at as at, imported_by as by from registrations where added_by is null limit 1",
  );
  return {
    groups: list,
    total: r.rows.length,
    boys: r.rows.filter((p) => p.gender === "Boys").length,
    girls: r.rows.filter((p) => p.gender === "Girls").length,
    importedAt: imported.rows[0]?.at ?? null,
    importedBy: imported.rows[0]?.by ?? null,
    sync: await getSyncStatus(db),
  };
}

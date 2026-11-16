// Programs (SPEC.md section 14, "Where we're going"): every organization's programs in one shape. A program takes
// players (CourtPlayers: a Season, with Sessions like open gyms and tryouts that have check-in) or teams (CourtTeams:
// a League, Circuit or Tournament). Kept in player_programs and scenic_programs until step 5 makes them one table.
import type { ProgramSettings } from "./player-programs";
import type { Queryable } from "./sql";
import { easternDate } from "./time";
import { PROGRAM_LOGO_SQL } from "./scenic-programs";

export type ProgramSession = {
  id: string;
  kind: string;
  name: string;
  startsAt: Date;
  expected: number;
  here: number;
  signupOpens: string | null; // Tryouts: when players can join its list
  signupCloses: string | null;
};
export type Program = {
  id: string;
  takes: "players" | "teams";
  kind: string; // Season | League | Circuit | Tournament
  name: string;
  regOpens: string; // YYYY-MM-DD
  regCloses: string | null; // null: open until the season ends
  startsOn: string | null;
  endsOn: string | null;
  seasonFrom: string | null; // the team program its season dates come from
  logo: string | null; // a team program's logo link
  registered: number; // players, or teams
  sessions: ProgramSession[]; // player programs only
  settings: ProgramSettings | null; // a player program's type and settings (Season or Clinic / Training)
  stage: "upcoming" | "open" | "running" | "ended";
};

type Row = Omit<Program, "sessions" | "stage" | "takes" | "settings"> & {
  takes: string;
  tryouts: boolean | null;
  openGyms: boolean | null;
  grades: string[] | null;
  levels: string[] | null;
  genders: string[] | null;
  scrimmages: boolean | null;
  sessions: number | null;
  boysGrades: string[] | null;
  girlsGrades: string[] | null;
};

// Where a program stands today: ended, registration not open yet, registration open, under way (registration
// closed, season started), or waiting for its season (registration closed; counted as upcoming).
export function stageOf(p: Pick<Program, "regOpens" | "regCloses" | "startsOn" | "endsOn">, today: string): Program["stage"] {
  if (p.endsOn && today > p.endsOn) return "ended";
  if (today < p.regOpens) return "upcoming";
  if (!p.regCloses || today <= p.regCloses) return "open";
  return p.startsOn && today >= p.startsOn ? "running" : "upcoming";
}

const ORDER: Record<Program["stage"], number> = { open: 0, running: 1, upcoming: 2, ended: 3 };

// An organization's programs: what's open or going first, then coming, then ended (newest first within each).
export async function orgPrograms(q: Pick<Queryable, "query">, org: string, now: Date): Promise<Program[]> {
  const day = (c: string) => `to_char(${c}, 'YYYY-MM-DD')`;
  const [rows, sessions] = await Promise.all([
    q.query<Row>(
      `select p.id::text, 'players' as takes, p.kind, p.name, ${day("p.reg_opens")} as "regOpens", ${day("p.reg_closes")} as "regCloses",
              ${day("coalesce(p.starts_on, s.starts_on)")} as "startsOn", ${day("coalesce(p.ends_on, s.ends_on)")} as "endsOn",
              s.name as "seasonFrom", null as logo,
              (select count(*)::int from registrations r where r.program_id = p.id) as registered,
              p.tryouts, p.open_gyms as "openGyms", p.grades, p.levels, p.genders, p.scrimmages, p.sessions,
              p.boys_grades as "boysGrades", p.girls_grades as "girlsGrades"
       from player_programs p left join scenic_programs s on s.id = p.season_from
       where p.org = $1
       union all
       select p.id::text, 'teams', p.kind, p.name, ${day("p.reg_opens")}, ${day("p.reg_closes")}, ${day("p.starts_on")}, ${day("p.ends_on")},
              null, ${PROGRAM_LOGO_SQL}, (select count(*)::int from scenic_registrations r where r.program_id = p.id and r.removed_by is null),
              null, null, null, null, null, null, null, null, null
       from scenic_programs p
       where p.org = $1`,
      [org],
    ),
    q.query<ProgramSession & { programId: string }>(
      `select e.id::text, e.program_id::text as "programId", coalesce(e.kind, 'Session') as kind, e.name, e.starts_at as "startsAt",
              (select count(*)::int from event_attendees a where a.event_id = e.id) as expected,
              (select count(*)::int from event_attendees a where a.event_id = e.id and a.status = 'here') as here,
              to_char(e.signup_opens, 'YYYY-MM-DD') as "signupOpens", to_char(e.signup_closes, 'YYYY-MM-DD') as "signupCloses"
       from events e join player_programs p on p.id = e.program_id
       where p.org = $1
       order by e.starts_at, e.id`,
      [org],
    ),
  ]);
  const today = easternDate(now);
  return rows.rows
    .map(({ tryouts, openGyms, grades, levels, genders, scrimmages, sessions: sessionCount, boysGrades, girlsGrades, ...r }) => ({
      ...r,
      takes: r.takes as Program["takes"],
      settings:
        r.takes === "players"
          ? {
              kind: (r.kind === "Session" || r.kind === "Course" ? r.kind : "Season") as ProgramSettings["kind"],
              tryouts: !!tryouts,
              openGyms: !!openGyms,
              scrimmages: !!scrimmages,
              sessions: sessionCount,
              grades: grades ?? [],
              levels: levels ?? [],
              genders: genders ?? [],
              boysGrades: boysGrades ?? [],
              girlsGrades: girlsGrades ?? [],
            }
          : null,
      sessions: r.takes === "players" ? sessions.rows.filter((s) => s.programId === r.id).map(({ programId, ...s }) => (void programId, s)) : [],
      stage: stageOf(r, today),
    }))
    .sort((a, b) => ORDER[a.stage] - ORDER[b.stage] || (b.startsOn ?? b.regOpens).localeCompare(a.startsOn ?? a.regOpens));
}

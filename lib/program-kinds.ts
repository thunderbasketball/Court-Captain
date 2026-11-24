// Program types and options, safe for the browser (the program form) and the server alike (SPEC.md section 14).
// CourtPlayers: a Season (teams formed from player registrations; Tryouts, Open Gyms, Scrimmages when it has them), a
// Training Session (one day) or a Training Course (several dates; its number of sessions). CourtEvents (team programs):
// a League (pool games over several weeks, then a post-season bracket), a Tournament (a weekend: pool games into a
// bracket), a Shootout (pool games only) or a Circuit (bulk registration into several Tournaments and/or Shootouts).
export const PROGRAM_KINDS = [
  { key: "Season", label: "Season", about: "Teams formed from player registrations." },
  { key: "Session", label: "Training Session", about: "A session on one day." },
  { key: "Course", label: "Training Course", about: "Sessions on several dates." },
] as const;
export type ProgramKind = (typeof PROGRAM_KINDS)[number]["key"];
export const TEAM_KINDS = [
  { key: "League", label: "League", about: "Pool games over several weeks, then a post-season bracket." },
  { key: "Tournament", label: "Tournament", about: "On a weekend: pool games into a bracket." },
  { key: "Shootout", label: "Shootout", about: "Pool games only." },
  { key: "Circuit", label: "Circuit", about: "Bulk registration into several Tournaments and/or Shootouts." },
] as const;
export type TeamKind = (typeof TEAM_KINDS)[number]["key"];
// League and Tournament pick Single or Double elimination; a Shootout has no bracket.
export const hasBracket = (k: string) => k === "League" || k === "Tournament";
export const hasPoolGames = (k: string) => k === "League" || k === "Tournament" || k === "Shootout";
export const ELIMINATION = [
  { key: "single", label: "Single elimination" },
  { key: "double", label: "Double elimination" },
] as const;
export const kindLabel = (k: string) => [...PROGRAM_KINDS, ...TEAM_KINDS].find((x) => x.key === k)?.label ?? k;
export const isTraining = (k: string) => k === "Session" || k === "Course";

export const PROGRAM_GRADES = ["K", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"] as const;
export const PROGRAM_LEVELS = ["REC", "COMP"] as const;
export const PROGRAM_GENDERS = ["Boys", "Girls"] as const;
export type ProgramSettings = {
  kind: ProgramKind;
  tryouts: boolean;
  openGyms: boolean;
  scrimmages: boolean;
  sessions: number | null; // a Training Course
  grades: string[]; // every grade it has (either gender)
  levels: string[]; // no longer used (levels of play are a team's setting)
  genders: string[];
  boysGrades: string[]; // the grades for each gender it has
  girlsGrades: string[];
};
// The grades a program has for a gender.
export const gradesFor = (p: Pick<ProgramSettings, "boysGrades" | "girlsGrades">, gender: string) =>
  gender === "Boys" ? p.boysGrades : gender === "Girls" ? p.girlsGrades : [];

// The Session types a program offers: a Training Session or Course anything but Tryouts and Open Gym; a Season
// everything, except Tryouts or Open Gym when it doesn't have them.
const isTryouts = (t: string) => /^tryouts?$/i.test(t);
const isOpenGym = (t: string) => /^open gyms?$/i.test(t);
export function sessionTypesFor(p: Pick<ProgramSettings, "kind" | "tryouts" | "openGyms">, types: string[]): string[] {
  return types.filter((t) =>
    isTraining(p.kind) ? !isTryouts(t) && !isOpenGym(t) : !(isTryouts(t) && !p.tryouts) && !(isOpenGym(t) && !p.openGyms),
  );
}

// Grades in short runs: "K–8", "3–5, 7", "All grades" (K–12).
export function gradeRuns(list: readonly string[]): string {
  const idx = list.map((g) => (PROGRAM_GRADES as readonly string[]).indexOf(g)).filter((i) => i >= 0).sort((a, b) => a - b);
  if (!idx.length) return "no grades";
  if (idx.length === PROGRAM_GRADES.length) return "All grades";
  const runs: string[] = [];
  for (let i = 0; i < idx.length; i++) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1] === idx[j] + 1) j++;
    runs.push(i === j ? PROGRAM_GRADES[idx[i]] : `${PROGRAM_GRADES[idx[i]]}–${PROGRAM_GRADES[idx[j]]}`);
    i = j;
  }
  return runs.join(", ");
}
// "Boys K–8 · Girls 3–8" (or one gender).
export const whoLine = (p: Pick<ProgramSettings, "genders" | "boysGrades" | "girlsGrades">) =>
  p.genders.map((g) => `${g} ${gradeRuns(gradesFor(p, g))}`).join(" · ");

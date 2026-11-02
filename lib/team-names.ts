// Team naming rules, shared by the server and the New team form.
export const GRADES = ["K", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"] as const;
export const LEVELS = ["REC", "COMP"] as const;
export const gradeSort = (g: string) => (g === "K" ? 0 : Number(g));

// "4G Epps", "KB Harper"; a multi-grade team takes its top grade.
export function teamName(gender: "Boys" | "Girls", grades: string[], headLastName: string): string {
  const top = [...grades].sort((a, b) => gradeSort(b) - gradeSort(a))[0];
  return `${top}${gender[0]} ${headLastName.trim()}`;
}

// One grade, or two next to each other (3rd/4th): what leagues place by. Grades as in GRADES ("K", "1" … "12").
export function gradesOk(grades: string[]): boolean {
  if (!grades.length || grades.length > 2 || !grades.every((g) => (GRADES as readonly string[]).includes(g))) return false;
  if (grades.length === 1) return true;
  const [a, b] = grades.map(gradeSort).sort((x, y) => x - y);
  return b === a + 1;
}

// A team with no Head Coach yet is "4G TBD"; another like it "4G TBD 2", and so on (`taken`: names in use, lower case).
export function tbdName(gender: "Boys" | "Girls", grades: string[], taken: Set<string>): string {
  const base = teamName(gender, grades, "TBD");
  for (let n = 1; ; n++) {
    const name = n === 1 ? base : `${base} ${n}`;
    if (!taken.has(name.toLowerCase())) return name;
  }
}

// A team's name in a league: its organization's Abbreviation first ("ER 5B Harris").
export const leagueName = (abbr: string, name: string) => `${abbr} ${name}`;

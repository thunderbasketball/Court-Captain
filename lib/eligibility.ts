import { gradeSort } from "./team-names";

// Grade eligibility (age control date, by default Aug 1 after the school year). For a team of grade G (K = 0), in school
// year Y–(Y+1) and control date Aug 1, Y+1 (3rd grade, 2026-27: Aug 1, 2027):
// - Eligible: in grade G or below, and doesn't turn G + 8 (`oldest`) before the control date (3rd: not 11 before Aug 1, 2027).
// - Age exception: any grade, but doesn't turn G + 7 (`exception`) before the control date (3rd: not 10). Null: none.
// A team of two grades is checked against its top grade. The numbers are set in the gears (lib/grade-rules.ts).
export type GradeRules = { month: number; day: number; oldest: number; exception: number | null };
export const DEFAULT_RULES: GradeRules = { month: 8, day: 1, oldest: 8, exception: 7 };
export type Eligibility = "ok" | "exception" | "too-old" | "grade" | "no-birthdate";

// The school year a date falls in: its first year (Aug 1 starts a new one). "2026-11-10" → 2026.
export function schoolYearOf(today: string): number {
  const [y, m] = today.split("-").map(Number);
  return m >= 8 ? y : y - 1;
}

const pad = (n: number) => String(n).padStart(2, "0");
// "YYYY-MM-DD" birthdates compare as text. Born on or after this date = doesn't turn `age` before the control date.
const bornOnOrAfter = (year: number, age: number, r: GradeRules) => `${year + 1 - age}-${pad(r.month)}-${pad(r.day)}`;

// "Aug 1, 2027": the control date for a school year.
export const controlDateLabel = (year: number, r: GradeRules) =>
  new Date(Date.UTC(year + 1, r.month - 1, r.day, 12)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

export function eligibility(
  teamGrades: string[],
  playerGrade: string,
  birthdate: string | null,
  year: number,
  r: GradeRules = DEFAULT_RULES,
): Eligibility {
  if (!teamGrades.length) return "ok";
  const g = Math.max(...teamGrades.map(gradeSort));
  if (!birthdate) return "no-birthdate";
  if (r.exception !== null && birthdate >= bornOnOrAfter(year, g + r.exception, r)) return "exception"; // young enough for any grade
  if (gradeSort(playerGrade) > g) return "grade";
  if (birthdate < bornOnOrAfter(year, g + r.oldest, r)) return "too-old";
  return "ok";
}

// How each result reads on a player's line; null when nothing needs showing.
export function eligibilityChip(e: Eligibility, playerGrade: string, teamGrades: string[]) {
  const top = Math.max(...teamGrades.map(gradeSort));
  if (e === "too-old") return { tone: "red" as const, text: "Too old" };
  if (e === "grade") return { tone: "red" as const, text: "Grade too high" };
  if (e === "no-birthdate") return { tone: "amber" as const, text: "No birthdate" };
  if (e === "exception" && gradeSort(playerGrade) > top) return { tone: "amber" as const, text: "Age exception" };
  return null;
}

// A roster's eligibility problems for its card's title: "1 Too old", "2 Grade too high", or "3 not eligible" when mixed;
// null when every player is eligible (an Age exception or a missing birthdate isn't counted).
export function rosterIssue(
  teamGrades: string[],
  players: { grade: string; birthdate: string | null }[],
  year: number,
  r: GradeRules = DEFAULT_RULES,
): string | null {
  const bad = players
    .map((p) => eligibilityChip(eligibility(teamGrades, p.grade, p.birthdate, year, r), p.grade, teamGrades))
    .filter((c) => c?.tone === "red");
  if (!bad.length) return null;
  const kinds = new Set(bad.map((c) => c!.text));
  return `${bad.length} ${kinds.size === 1 ? bad[0]!.text : "not eligible"}`;
}

// "Mar 4, 2017"
export const birthdayLabel = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

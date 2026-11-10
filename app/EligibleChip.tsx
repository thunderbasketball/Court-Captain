import { birthdayLabel, eligibility, eligibilityChip, type GradeRules } from "@/lib/eligibility";
import { Chip } from "./ui";

// A player's grade eligibility for their team (lib/eligibility.ts): red Too old / Grade too high, amber Age exception or
// No birthdate; nothing when they're eligible. `year` is the school year's first year (2026 for 2026-27).
export default function EligibleChip({
  teamGrades,
  grade,
  birthdate,
  year,
  rules,
}: {
  rules: GradeRules; // the organization's grade requirements (lib/grade-rules.ts)
  teamGrades: string[];
  grade: string;
  birthdate: string | null;
  year: number;
}) {
  const c = eligibilityChip(eligibility(teamGrades, grade, birthdate, year, rules), grade, teamGrades);
  return c && <Chip tone={c.tone}>{c.text}</Chip>;
}

// "· born Mar 4, 2017" for a player's line.
export const bornLabel = (d: string | null) => (d ? ` · born ${birthdayLabel(d)}` : "");

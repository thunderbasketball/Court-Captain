// An official's Level (SPEC.md section 14, step 4c), kept apart so the phone's forms can list them. Recruits can't be
// scheduled to officiate games.
export const OFFICIAL_LEVELS = ["Certified", "Experienced", "Student", "Recruit"] as const;
export type OfficialLevel = (typeof OFFICIAL_LEVELS)[number];
export const canOfficiate = (level: string | null) => level !== "Recruit";

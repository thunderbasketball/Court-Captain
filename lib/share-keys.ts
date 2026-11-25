// Addresses of the grade groups' share pictures (no server code: the browser uses these too).
// A grade group's address part: "5th Boys COMP" → "5th-boys-comp".
export const groupSlug = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
export const groupKey = (what: "standings" | "schedule", programId: string, label: string) => `${what}.${programId}.${groupSlug(label)}`;

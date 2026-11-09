// Organizations grouped by the CourtCaptain features they have (the logo menu and CourtCaptain's Organizations tab):
// "CourtOrg + CourtSync", "CourtSync", … Safe for the browser (no database).
import { FEATURES } from "./features";

// More than this many organizations: grouped (each group opens and closes).
export const GROUP_OVER = 4;

// The group's name from an organization's stored features: its Court… features in the usual order, joined with "+".
export function featureGroup(stored: Iterable<string>): string {
  const has = new Set(stored);
  const names = FEATURES.filter((f) => f.key.startsWith("court-") && has.has(f.key)).map((f) => f.name);
  return names.length ? names.join(" + ") : "No features yet";
}

// The organizations in their groups (order within a group kept): groups with more features first, then by name.
export function groupByFeatures<T extends { group: string }>(orgs: T[]): { label: string; orgs: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const o of orgs) groups.set(o.group, [...(groups.get(o.group) ?? []), o]);
  const size = (label: string) => (label.startsWith("No ") ? 0 : label.split(" + ").length);
  return [...groups]
    .map(([label, orgs]) => ({ label, orgs }))
    .sort((a, b) => size(b.label) - size(a.label) || a.label.localeCompare(b.label));
}

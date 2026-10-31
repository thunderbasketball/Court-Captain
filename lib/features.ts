// CourtCaptain features (SPEC.md section 14). Organizations subscribe to CourtCaptain and turn on the features they
// use; later each one is bought as an upgrade. Which organization has which lives in `org_features`; Alerts come
// with every organization. The server checks a feature before showing its pages or making its changes.
import type { Queryable } from "./sql";
import type { OrgSlug } from "./orgs";

export const FEATURES = [
  { key: "player-registration", name: "Player Registration", about: "Players register; you see them by grade and gender." },
  { key: "team-building", name: "Team Building", about: "Teams, staff, rosters and player evaluations." },
  { key: "uniforms", name: "Uniform Ordering", about: "Numbers and sizes for every rostered player." },
  { key: "practice", name: "Practice Management", about: "Gyms, practice slots, booking limits and blackouts." },
  { key: "events", name: "Event Management", about: "Open gyms, tryouts and trainings with check-in." },
  { key: "chat", name: "Chat", about: "Chats for coaches, teams, Directors and the whole organization." },
  {
    key: "partner-tools",
    name: "Partner Tools",
    about: "Work as a partner of another organization: share gym times, register teams.",
  },
  { key: "hosting-available", name: "Hosting Sites Available", about: "Offer your gyms to host another organization's games." },
  { key: "team-registration", name: "Team Registrations", about: "Partners and Solo coaches register teams." },
  {
    key: "hosting-partners",
    name: "Hosting Sites Wanted",
    about: "Other organizations host your games: game days, partners' gyms, courts and open times.",
  },
  { key: "programs", name: "Programs", about: "Leagues, circuits and tournaments with divisions." },
  { key: "officials", name: "Officials Management", about: "Referees and scorekeepers for your games." },
  { key: "alerts", name: "Alerts", about: "Announcements and reminders. Comes with every organization.", always: true },
] as const;

export type Feature = (typeof FEATURES)[number]["key"];

const ALWAYS = new Set<string>(FEATURES.filter((f) => "always" in f && f.always).map((f) => f.key));

export async function orgFeatures(pool: Pick<Queryable, "query">, org: OrgSlug): Promise<Set<Feature>> {
  const r = await pool.query<{ feature: Feature }>(`select feature from org_features where org = $1`, [org]);
  return new Set<Feature>([...(ALWAYS as Set<Feature>), ...r.rows.map((x) => x.feature)]);
}

export async function hasFeature(pool: Pick<Queryable, "query">, org: OrgSlug, feature: Feature): Promise<boolean> {
  if (ALWAYS.has(feature)) return true;
  const r = await pool.query(`select 1 from org_features where org = $1 and feature = $2`, [org, feature]);
  return r.rowCount === 1;
}

export const NO_FEATURE = "Your organization doesn't have this feature. A Director can add it on Upgrades.";

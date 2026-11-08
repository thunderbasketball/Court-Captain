// CourtCaptain features (SPEC.md section 14). CourtCaptain is the platform; each organization subscribes and turns on the
// features it uses (later each one is bought as an upgrade). Which organization has which lives in `org_features`;
// Alerts come with every organization. The server checks before showing a page or making a change.
//
// Two levels:
// - FEATURES: what an organization has and buys (CourtPlayers, CourtTeams, …), stored in `org_features`.
// - Feature (abilities): the finer parts the pages check (programs, uniforms, practice, …), worked out from the features
//   it has (`abilitiesFrom`).
import type { Queryable } from "./sql";
import type { OrgSlug } from "./orgs";

export const FEATURES = [
  {
    key: "court-players",
    name: "CourtPlayers",
    about:
      "Players register; evaluations, uniforms, tryouts and open gyms. Add teams and coaches and roster players from registrations.",
  },
  {
    key: "court-teams",
    name: "CourtTeams",
    about: "Teams register into your programs. With CourtPlayers, roster players from registrations. Includes Chat.",
  },
  {
    key: "court-org",
    name: "CourtOrg",
    about: "Add your organization's teams and coaches, enter rosters, and register your teams into events.",
  },
  {
    key: "court-scheduler",
    name: "CourtScheduler",
    about: "Leagues, circuits and tournaments with divisions, schedules and officials. Includes CourtSync Schedule and Chat.",
  },
  {
    key: "court-sync",
    name: "CourtSync",
    about:
      "Schedule (with CourtScheduler): other organizations host your games. Host: offer your gyms for others' games. Includes Chat.",
  },
  {
    key: "court-facility",
    name: "CourtFacility",
    about: "Gyms, practice slots, booking limits and blackouts. Gym rentals coming soon.",
  },
  { key: "alerts", name: "Alerts", about: "Announcements and reminders. Comes with every organization.", always: true },
] as const;

export type FeatureKey = (typeof FEATURES)[number]["key"];
export const isFeatureKey = (v: unknown): v is FeatureKey => FEATURES.some((f) => f.key === v);

// The abilities the pages check. Kept the same as before the CourtCaptain features were named, so each page's check stays.
export type Feature =
  | "player-registration"
  | "team-building" // add teams and coaches, rosters
  | "uniforms"
  | "practice"
  | "events"
  | "chat"
  | "hosting-available" // CourtSync Host
  | "team-registration"
  | "hosting-partners" // CourtSync Schedule
  | "programs"
  | "officials"
  | "alerts";

const GIVES: Record<FeatureKey, Feature[]> = {
  "court-players": ["player-registration", "uniforms", "events", "team-building"],
  "court-teams": ["team-registration", "chat"],
  "court-org": ["team-building"],
  "court-scheduler": ["programs", "officials", "hosting-partners", "chat"],
  "court-sync": ["chat"], // and its Schedule or Host part, below
  "court-facility": ["practice"],
  alerts: ["alerts"],
};

// CourtSync's part: Schedule with CourtScheduler (others host your games), else Host (your gyms host others' games).
export const syncPart = (has: ReadonlySet<string>): "Schedule" | "Host" => (has.has("court-scheduler") ? "Schedule" : "Host");

export function abilitiesFrom(stored: Iterable<string>): Set<Feature> {
  const has = new Set<string>(stored);
  const out = new Set<Feature>(["alerts"]);
  for (const f of FEATURES) if (has.has(f.key)) for (const a of GIVES[f.key]) out.add(a);
  if (has.has("court-sync") && syncPart(has) === "Host") out.add("hosting-available");
  return out;
}

// Features that work for any organization today; the rest are built for Thunder or Scenic City so far, and a new
// organization's sign-up records them as requested (SPEC.md section 14).
export const READY_FOR_ANY_ORG = new Set<FeatureKey>(["court-sync", "court-org", "alerts"]);

// Keys stored before the CourtCaptain features were named (left in place for the live site until it gets this code;
// ignored here). Delete those rows after pushing.
export const RETIRED_KEYS = [
  "player-registration",
  "team-building",
  "uniforms",
  "practice",
  "events",
  "chat",
  "hosting-available",
  "team-registration",
  "hosting-partners",
  "programs",
  "officials",
];

// The features an organization has (stored keys, plus Alerts).
export async function orgFeatureKeys(pool: Pick<Queryable, "query">, org: OrgSlug): Promise<Set<FeatureKey>> {
  const r = await pool.query<{ feature: string }>(`select feature from org_features where org = $1`, [org]);
  return new Set<FeatureKey>(["alerts", ...r.rows.map((x) => x.feature).filter(isFeatureKey)]);
}

// The abilities an organization has.
export async function orgFeatures(pool: Pick<Queryable, "query">, org: OrgSlug): Promise<Set<Feature>> {
  return abilitiesFrom(await orgFeatureKeys(pool, org));
}

export async function hasFeature(pool: Pick<Queryable, "query">, org: OrgSlug, feature: Feature): Promise<boolean> {
  return feature === "alerts" || (await orgFeatures(pool, org)).has(feature);
}

export const NO_FEATURE = "Your organization doesn't have this feature. A Director can add it on Upgrades.";

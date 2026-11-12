// CourtCaptain features (SPEC.md section 14). CourtCaptain is the platform; each organization subscribes and turns on the
// features it uses (later each one is bought as an upgrade). Which organization has which lives in `org_features`;
// Alerts come with every organization. The server checks before showing a page or making a change.
//
// Two levels:
// - FEATURES: what an organization has and buys (CourtPlayers, CourtTeams, …), stored in `org_features`.
// - Feature (abilities): the finer parts the pages check (programs, uniforms, practice, …), worked out from the features
//   it has (`abilitiesFrom`).
import { memo, remembering } from "./request-memo";
import type { Queryable } from "./sql";
import type { OrgSlug } from "./orgs";

// The layout agreed Nov 11, 2026 (SPEC.md section 14, "Where we're going"). `always`: every organization has it (free,
// part of CourtOrg). `free`: no charge, but the organization turns it on (CourtSync, in its Feature Settings). The rest
// are paid upgrades.
export const FEATURES = [
  {
    key: "court-players",
    name: "CourtPlayers",
    about:
      "Player registration programs: players register; evaluations, tryouts and open gyms with check-in. Includes CourtPractice, Uniforms, Team and Parents chats, chats with your coaches, and Directors.",
  },
  {
    key: "court-teams",
    name: "CourtTeams",
    about:
      "Team registration programs (Leagues, Circuits, Tournaments): teams register; divisions, the Scheduler and publishing. Includes chat with the registered teams' coaches, and Directors.",
  },
  {
    key: "court-practice",
    name: "CourtPractice",
    about: "Practice slots, booking limits and your own gyms' practices. Comes with CourtPlayers.",
  },
  {
    key: "court-officials",
    name: "CourtOfficials",
    about:
      "For officials groups: keep your referees, and (with CourtSync) assign them to the games of the leagues you work with.",
  },
  {
    key: "court-sync",
    name: "CourtSync",
    about:
      "Scheduler (with CourtTeams): other organizations host your games. Host: offer your gyms for others' games once a Scheduler approves you. Officials (with CourtOfficials): work leagues' games. Includes Scheduler ↔ Host chat.",
    free: true,
  },
  {
    key: "court-club",
    name: "CourtClub",
    about:
      "Your teams, coaches and rosters; register your teams into CourtTeams programs that are open to you. A team is active from its program registration until 30 days after it ends. A stand-alone team is a club of one.",
    always: true,
  },
  {
    key: "court-facilities",
    name: "CourtFacilities",
    about: "Gyms, courts and blackouts; offer game space (CourtSync) and practice times (CourtPractice).",
    always: true,
  },
  { key: "alerts", name: "Alerts", about: "Announcements and reminders. Comes with every organization.", always: true },
] as const;

export type FeatureKey = (typeof FEATURES)[number]["key"];
export const isFeatureKey = (v: unknown): v is FeatureKey => FEATURES.some((f) => f.key === v);
export const isAlways = (f: (typeof FEATURES)[number]) => "always" in f && f.always;
export const isFree = (f: (typeof FEATURES)[number]) => isAlways(f) || ("free" in f && f.free);

// The abilities the pages check. Kept the same as before the CourtCaptain features were named, so each page's check stays.
export type Feature =
  | "player-registration"
  | "team-building" // add teams and coaches, rosters
  | "uniforms"
  | "practice"
  | "events"
  | "chat" // the organization's chats: Directors (CourtPlayers or CourtTeams)
  | "team-chat" // team, Parents and own-coach chats (CourtPlayers)
  | "hosting-available" // CourtSync Host
  | "team-registration"
  | "hosting-partners" // CourtSync Scheduler
  | "programs"
  | "officials"
  | "alerts";

const GIVES: Record<FeatureKey, Feature[]> = {
  "court-players": ["player-registration", "uniforms", "events", "team-building", "practice", "chat", "team-chat"],
  "court-teams": ["team-registration", "programs", "chat"],
  "court-practice": ["practice"],
  "court-officials": ["officials"],
  "court-sync": [], // its Scheduler or Host part, below (Scheduler ↔ Host chat comes later)
  "court-club": ["team-building"], // a stand-alone team (kind 'Team') has one
  "court-facilities": [],
  alerts: ["alerts"],
};

// CourtSync's part: Scheduler with CourtTeams (others host your games), Officials with CourtOfficials and no gyms (an
// Officials Group working leagues' games), else Host (your gyms host others' games; a host may keep officials too).
export type SyncPart = "Schedule" | "Officials" | "Host";
export const syncPart = (has: ReadonlySet<string>): SyncPart =>
  has.has("court-teams")
    ? "Schedule"
    : has.has("court-officials") && !has.has("court-facilities")
      ? "Officials"
      : "Host";

// `withAlways` false: `stored` already holds the always-on ones it has (orgFeatureKeys: an Officials Group has fewer).
export function abilitiesFrom(stored: Iterable<string>, withAlways = true): Set<Feature> {
  const has = new Set<string>(stored);
  if (withAlways) for (const f of FEATURES) if (isAlways(f)) has.add(f.key);
  const out = new Set<Feature>();
  for (const f of FEATURES) if (has.has(f.key)) for (const a of GIVES[f.key]) out.add(a);
  const part = syncPart(has);
  if (has.has("court-sync") && part !== "Officials") out.add(part === "Host" ? "hosting-available" : "hosting-partners");
  return out;
}

// Features that work for any organization today; the rest are built for Thunder or Scenic City so far, and a new
// organization's sign-up records them as requested (SPEC.md section 14).
export const READY_FOR_ANY_ORG = new Set<FeatureKey>(["court-sync", "court-club", "court-facilities", "court-officials", "alerts"]);

// Keys stored before the CourtCaptain features were named (left in place for the live site until it gets this code;
// ignored here). Delete those rows after pushing.
export const RETIRED_KEYS = [
  "court-scheduler", // became part of CourtTeams (110_feature_layout.sql)
  "court-facility", // became CourtFacilities (free) + CourtPractice
  "court-org", // CourtOrg and CourtSolo became CourtClub (106_court_club.sql)
  "court-solo",
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

// The features an organization has (stored keys, plus the ones every organization has). An Officials Group has no teams or
// gyms: of the always-on ones, only Alerts.
export async function orgFeatureKeys(pool: Pick<Queryable, "query">, org: OrgSlug): Promise<Set<FeatureKey>> {
  // Asked many times on one page (and for every organization in the header's menus): while a page is being built, every
  // organization's features are read in one query and reused; saving a change, or inside a transaction, reads fresh.
  if ("totalCount" in pool && remembering()) {
    const all = await memo(pool, `features:${version}`, () => loadAllFeatureRows(pool));
    return new Set<FeatureKey>(all.get(org) ?? (await loadFeatureRows(pool, org)));
  }
  return new Set<FeatureKey>(await loadFeatureRows(pool, org));
}

// Bumped by every change to an organization's features or kind, so a page load reads them fresh afterwards.
let version = 0;
export function featuresChanged() {
  version++;
}

const alwaysFor = (officials: boolean) =>
  FEATURES.filter(isAlways)
    .map((f) => f.key)
    .filter((k) => !officials || k === "alerts");

// Every organization's features at once: slug → its keys (with the always-on ones it has).
async function loadAllFeatureRows(pool: Pick<Queryable, "query">): Promise<Map<string, FeatureKey[]>> {
  const r = await pool.query<{ slug: string; officials: boolean; features: (string | null)[] }>(
    `select o.slug, o.kind = 'Officials' as officials, array_agg(f.feature) as features
       from organizations o left join org_features f on f.org = o.slug group by o.slug, o.kind`,
  );
  return new Map(r.rows.map((x) => [x.slug, [...alwaysFor(x.officials), ...x.features.filter(isFeatureKey)]]));
}

async function loadFeatureRows(pool: Pick<Queryable, "query">, org: string): Promise<FeatureKey[]> {
  const r = await pool.query<{ feature: string | null; officials: boolean }>(
    `select f.feature, o.kind = 'Officials' as officials
       from organizations o left join org_features f on f.org = o.slug where o.slug = $1
     union all select null, false where not exists (select 1 from organizations where slug = $1)`,
    [org],
  );
  return [...alwaysFor(!!r.rows[0]?.officials), ...r.rows.map((x) => x.feature).filter(isFeatureKey)];
}

// The abilities an organization has.
export async function orgFeatures(pool: Pick<Queryable, "query">, org: OrgSlug): Promise<Set<Feature>> {
  return abilitiesFrom(await orgFeatureKeys(pool, org), false);
}

export async function hasFeature(pool: Pick<Queryable, "query">, org: OrgSlug, feature: Feature): Promise<boolean> {
  return feature === "alerts" || (await orgFeatures(pool, org)).has(feature);
}

export const NO_FEATURE = "Your organization doesn't have this feature. A Director can add it on Upgrades.";

// CourtSync is free: an organization's Owners and Admins turn it on or off (Feature Settings). Off keeps its
// partnerships and game space as they are; they just don't show until it's on again.
export async function setCourtSync(
  deps: { pool: Pick<Queryable, "query">; now: () => Date },
  viewer: { coachId: string; firstName: string; lastName: string },
  org: OrgSlug,
  on: unknown,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (typeof on !== "boolean") return { ok: false, message: "Pick on or off." };
  const admin = await deps.pool.query<{ ok: boolean }>("select acts_as($1, $2, 'Admin') as ok", [viewer.coachId, org]);
  if (!admin.rows[0]?.ok) return { ok: false, message: "Only an Owner or Admin of this organization can turn CourtSync on or off." };
  if (on)
    await deps.pool.query(
      `insert into org_features (org, feature, source, turned_on_by, turned_on_at) values ($1, 'court-sync', 'org', $2, $3)
       on conflict (org, feature) do nothing`,
      [org, `${viewer.firstName} ${viewer.lastName}`, deps.now()],
    );
  else await deps.pool.query("delete from org_features where org = $1 and feature = 'court-sync'", [org]);
  featuresChanged();
  return { ok: true };
}

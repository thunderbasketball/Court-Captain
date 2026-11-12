import { db } from "@/lib/db";
import { FEATURES, hasFeature, isAlways, isFree, orgFeatureKeys, syncPart } from "@/lib/features";
import { isOrgAdmin, isOrgOwner } from "@/lib/org-admin";
import { orgInfo } from "@/lib/org-registry";
import { ORG_COLORS } from "@/lib/org-signup";
import { TZ } from "@/lib/time";
import OrgLogo from "./OrgLogo";
import OrgSettings from "./OrgSettings";
import OrgGradeRules from "./OrgGradeRules";
import { orgGradeRules } from "@/lib/grade-rules";
import { easternDate } from "@/lib/time";
import { teamWarningSettings } from "@/lib/team-warnings";
import SubCard from "./SubCard";
import { clubActiveDays } from "@/lib/court-club";
import ClubSettingsForm from "./warnings/ClubSettingsForm";
import SyncSwitch from "./warnings/SyncSwitch";
import ChatSettingsForm from "./warnings/ChatSettingsForm";
import { chatEmailSetting } from "@/lib/chat";
import WarningsForm from "./warnings/WarningsForm";

// The gear after an organization's last tab, for its Admins only (checked here on the server): its name (Owners), login link, every
// feature (what it has, since when, and what it can add: buying upgrades in the app is coming soon), its color and logo.
export default async function OrgGear({ org, coachId }: { org: string; coachId: string }) {
  const [admin, owner, o, on, asked] = await Promise.all([
    isOrgAdmin(db, coachId, org),
    isOrgOwner(db, coachId, org),
    orgInfo(db, org),
    db.query<{ feature: string; turned_on_at: Date }>("select feature, turned_on_at from org_features where org = $1", [org]),
    db.query<{ feature: string }>("select feature from org_feature_requests where org = $1", [org]),
  ]);
  if (!admin || !o) return null;
  const now = new Date();
  const since = new Map(on.rows.map((f) => [f.feature, f.turned_on_at]));
  const has = new Set<string>(await orgFeatureKeys(db, org)); // with the ones everyone has (an Officials Group: Alerts only)
  const players = has.has("court-players"); // CourtPlayers: Grade requirements, and uniforms where they're kept
  // The team warnings sit in CourtPlayers' card when it has it, else CourtClub's (every organization).
  const teamFeature = players || has.has("court-club") ? FEATURES.find((f) => f.key === (players ? "court-players" : "court-club")) : undefined;
  const [grades, w, clubDays, chatOn] = await Promise.all([
    players ? orgGradeRules(db, org, now) : null,
    teamFeature ? teamWarningSettings(db, org) : null,
    clubActiveDays(db, org),
    hasFeature(db, org, "chat"),
  ]);
  const chatSetting = chatOn ? await chatEmailSetting(db, org) : null;
  const requested = new Set(asked.rows.map((f) => f.feature));
  const date = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: TZ });
  const always = isAlways;
  const have = FEATURES.filter((f) => has.has(f.key));
  const add = FEATURES.filter((f) => !have.includes(f));
  return (
    <OrgSettings
      org={org}
      color={o.color}
      colors={o.color && !(ORG_COLORS as readonly string[]).includes(o.color) ? [o.color, ...ORG_COLORS] : ORG_COLORS}
      login={o.login}
      abbr={o.abbr}
      name={o.name}
      short={o.short}
      canRename={owner}
      featureSettings={
        (
          <div className="space-y-2">
            {/* CourtSync: free; its Owners and Admins turn it on here. */}
            <SubCard title="CourtSync" count={has.has("court-sync") ? `On · ${syncPart(has)}` : "Off"}>
              <SyncSwitch org={org} on={has.has("court-sync")} part={syncPart(has)} />
            </SubCard>
            {/* CourtClub (not an Officials Group's: it has no teams). */}
            {has.has("court-club") && (
              <SubCard title="CourtClub">
                <ClubSettingsForm org={org} days={clubDays} />
              </SubCard>
            )}
            {chatSetting && (
              <SubCard title="Chat">
                <ChatSettingsForm org={org} on={chatSetting.on} hours={chatSetting.hours} />
              </SubCard>
            )}
          </div>
        )
      }
      warnings={
        <div className="space-y-2">
          {/* A card for each feature it has. The team warnings come with whichever of CourtPlayers, CourtOrg or CourtSolo it
              has (the first); Grade requirements and uniforms with CourtPlayers. */}
          {have.map((f) => (
            <SubCard key={f.key} title={f.name}>
              {f.key === teamFeature?.key && w ? (
                <div className="space-y-4">
                  {grades && <OrgGradeRules org={org} grades={grades} today={easternDate(now)} />}
                  <WarningsForm
                    org={org}
                    settings={w.settings}
                    parts={w.uniformsKept ? ["roster", "idle", "uniforms"] : ["roster", "idle"]}
                    setBy={w.setBy}
                  />
                </div>
              ) : (
                <p className="text-sm text-zinc-500">No warnings for this feature yet.</p>
              )}
            </SubCard>
          ))}
        </div>
      }
      featuresOn={have.length}
      logo={<OrgLogo src={o.logo} name={o.name} color={o.color} className="size-14 rounded-xl text-xl" />}
      features={
        <div className="space-y-3">
          <ul className="divide-y divide-zinc-100 rounded-xl ring-1 ring-zinc-950/10 dark:divide-white/5 dark:ring-white/10">
            {have.map((f) => (
              <li key={f.key} className="flex items-start justify-between gap-3 px-3 py-2">
                <span className="min-w-0 text-sm">
                  <span className="font-medium">
                    {f.name}
                    {f.key === "court-sync" && ` · ${syncPart(has)}`}
                  </span>
                  <span className="block text-xs text-zinc-500">
                    {f.about}
                    {since.has(f.key) && ` · since ${date(since.get(f.key)!)}`}
                  </span>
                </span>
                <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">
                  {always(f) ? "Included" : isFree(f) ? "Free · On" : "On"}
                </span>
              </li>
            ))}
          </ul>
          {add.length > 0 && (
            <>
              <h4 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">Add to {o.short ?? o.name}</h4>
              <ul className="divide-y divide-zinc-100 rounded-xl ring-1 ring-zinc-950/10 dark:divide-white/5 dark:ring-white/10">
                {add.map((f) => (
                  <li key={f.key} className="flex items-start justify-between gap-3 px-3 py-2">
                    <span className="min-w-0 text-sm">
                      <span className="font-medium">{f.name}</span>
                      <span className="block text-xs text-zinc-500">{f.about}</span>
                      {requested.has(f.key) && (
                        <span className="block text-xs font-medium text-amber-700 dark:text-amber-300">
                          Requested · coming soon
                        </span>
                      )}
                    </span>
                    {isFree(f) ? (
                      <span className="shrink-0 rounded-full bg-zinc-100 px-2.5 py-0.5 text-[11px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                        Free · turn on in Feature Settings
                      </span>
                    ) : (
                    <button
                      type="button"
                      disabled
                      title="Buying upgrades in the app is coming soon"
                      className="shrink-0 rounded-full bg-zinc-200 px-2.5 py-0.5 text-[11px] font-semibold text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                    >
                      Upgrade
                    </button>
                    )}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-zinc-500">Buying upgrades in the app is coming soon.</p>
            </>
          )}
        </div>
      }
    />
  );
}

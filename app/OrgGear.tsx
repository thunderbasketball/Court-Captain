import { db } from "@/lib/db";
import { FEATURES, syncPart } from "@/lib/features";
import { isOrgAdmin, isOrgOwner } from "@/lib/org-admin";
import { orgInfo } from "@/lib/org-registry";
import { ORG_COLORS } from "@/lib/org-signup";
import { TZ } from "@/lib/time";
import OrgLogo from "./OrgLogo";
import OrgSettings from "./OrgSettings";

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
  const since = new Map(on.rows.map((f) => [f.feature, f.turned_on_at]));
  const requested = new Set(asked.rows.map((f) => f.feature));
  const date = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: TZ });
  const always = (f: (typeof FEATURES)[number]) => "always" in f && f.always;
  const have = FEATURES.filter((f) => always(f) || since.has(f.key));
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
                    {f.key === "court-sync" && ` · ${syncPart(new Set(since.keys()))}`}
                  </span>
                  <span className="block text-xs text-zinc-500">
                    {f.about}
                    {since.has(f.key) && ` · since ${date(since.get(f.key)!)}`}
                  </span>
                </span>
                <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">
                  {always(f) ? "Included" : "On"}
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
                    <button
                      type="button"
                      disabled
                      title="Buying upgrades in the app is coming soon"
                      className="shrink-0 rounded-full bg-zinc-200 px-2.5 py-0.5 text-[11px] font-semibold text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                    >
                      Upgrade
                    </button>
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

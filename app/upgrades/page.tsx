import { Suspense } from "react";
import { redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { PLATFORM } from "@/lib/contexts";
import { currentContexts } from "@/lib/contexts-server";
import { db } from "@/lib/db";
import { FEATURES } from "@/lib/features";
import { ORGS } from "@/lib/orgs";
import { TZ } from "@/lib/time";
import { isOrgAdmin } from "@/lib/org-admin";
import AppHeader from "../AppHeader";
import { card, PageTitle } from "../ui";

export default function UpgradesPage() {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <Upgrades />
    </Suspense>
  );
}

// The organization's CourtCaptain features (SPEC.md section 14): what it has, and what it can add.
// Directors of the organization they're working in only (the chip in use picks the organization).
async function Upgrades() {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  const { active } = await currentContexts(user);
  if (active?.org === PLATFORM) redirect("/platform");
  const org = active?.org ?? "thunder";
  // Upgrades are bought by the organization's Admins.
  const onDirectorChip = org === "scenic-city" ? active?.key === "scenic:Director" : active?.key === "director";
  if (!onDirectorChip || !(await isOrgAdmin(db, user.coachId, org))) redirect("/");

  const r = await db.query<{ feature: string; turned_on_at: Date }>(
    `select feature, turned_on_at from org_features where org = $1`,
    [org],
  );
  const since = new Map(r.rows.map((x) => [x.feature, x.turned_on_at]));
  const on = FEATURES.filter((f) => ("always" in f && f.always) || since.has(f.key));
  const off = FEATURES.filter((f) => !on.includes(f));
  const date = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: TZ });

  return (
    <>
      <AppHeader user={user} context={org === "scenic-city" ? "scenic:Director" : "director"} tab="features" />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <PageTitle title="Features" subtitle={`${ORGS[org].name} on CourtCaptain: what you have, and upgrades you can add`} />

        <h2 className="mb-2 text-sm font-semibold text-zinc-500 dark:text-zinc-400">Your features ({on.length})</h2>
        <div className="mb-6 grid gap-3 sm:grid-cols-2">
          {on.map((f) => (
            <div key={f.key} className={`${card} p-4`}>
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold">{f.name}</h3>
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">
                  {"always" in f && f.always ? "Included" : "On"}
                </span>
              </div>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{f.about}</p>
              {since.has(f.key) && <p className="mt-1 text-xs text-zinc-500">Since {date(since.get(f.key)!)}</p>}
            </div>
          ))}
        </div>

        {off.length > 0 && (
          <>
            <h2 className="mb-2 text-sm font-semibold text-zinc-500 dark:text-zinc-400">Add to {ORGS[org].name}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {off.map((f) => (
                <div key={f.key} className={`${card} p-4`}>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-semibold">{f.name}</h3>
                    <button
                      type="button"
                      disabled
                      title="Payments are coming soon"
                      className="rounded-full bg-zinc-200 px-3 py-1 text-xs font-semibold text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                    >
                      Upgrade
                    </button>
                  </div>
                  <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{f.about}</p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-zinc-500">Buying upgrades in the app is coming soon.</p>
          </>
        )}
      </main>
    </>
  );
}

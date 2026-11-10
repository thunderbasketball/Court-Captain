import { Suspense } from "react";
import { redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { db } from "@/lib/db";
import OrgLogo from "../OrgLogo";
import { AREAS } from "@/lib/org-admin";
import { platformOverview } from "@/lib/platform";
import { GROUP_OVER, featureGroup, groupByFeatures } from "@/lib/org-groups";
import { TZ } from "@/lib/time";
import AppHeader from "../AppHeader";
import { card, EmailLink, PageTitle, PhoneLink } from "../ui";
import { ResetLoginButton } from "../ResetLoginButton";
import { ViewAsButton } from "../ViewAsButton";
import Link from "next/link";
import { formatCell } from "@/lib/phone";
import { AddOwner, AddStaff, DeleteOrganization, FeatureSwitch, FeaturesGear, RemoveOwner, RemoveStaff } from "./PlatformTools";
import SupportAdmin from "./SupportAdmin";
import { listArticles } from "@/lib/support";

const AREA_NAMES = Object.fromEntries(AREAS.map((a) => [a.key, a.name])) as Record<string, string>;

export default function PlatformPage({ searchParams }: PageProps<"/platform">) {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <Platform searchParams={searchParams} />
    </Suspense>
  );
}

// CourtCaptain's own page (SPEC.md section 14): CourtCaptain staff only. Tabs: Staff (CourtCaptain Owners and Admins;
// Owners add and remove Admins) and Organizations (each collapsed: open it for its Owners, Admins, Directors, features).
async function Platform({ searchParams }: { searchParams: PageProps<"/platform">["searchParams"] }) {
  const asked = (await searchParams).tab;
  const tab = asked === "staff" || asked === "support" ? asked : "orgs";
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  const data = await platformOverview({ pool: db, now: () => new Date() }, user);
  if (!data) redirect("/");
  const date = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: TZ });
  const how: Record<string, string> = { setup: "set up", comp: "free", purchase: "bought" };

  return (
    <>
      <AppHeader user={user} context="platform" />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <PageTitle title="CourtCaptain" subtitle={`${data.orgs.length} organizations · ${data.platformAdmins.length} staff`} />
        <nav aria-label="CourtCaptain" className="mb-5 flex gap-1 border-b border-zinc-200 dark:border-white/10">
          {(
            [
              ["staff", "Staff"],
              ["orgs", "Organizations"],
              ["support", "Support"],
            ] as const
          ).map(([key, label]) => (
            <Link
              key={key}
              href={key === "orgs" ? "/platform" : `/platform?tab=${key}`}
              aria-current={tab === key ? "page" : undefined}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold ${
                tab === key
                  ? "border-thunder-orange text-zinc-900 dark:text-white"
                  : "border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
              }`}
            >
              {label}
            </Link>
          ))}
        </nav>

        {tab === "support" && <SupportAdmin articles={await listArticles(db)} />}

        {tab === "staff" && (
          <section className={`${card} p-4`}>
            <div className="mb-2 flex items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold">CourtCaptain staff</h2>
                <p className="text-sm text-zinc-500">
                  Owner-level access to every organization, in the background (not shown on organization pages).
                </p>
              </div>
              {data.isOwner && <AddStaff options={data.staffOptions} />}
            </div>
            <ul className="divide-y divide-zinc-100 dark:divide-white/5">
              {data.platformAdmins.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span>
                    <span className="font-medium">{a.name}</span> <PhoneLink cell={a.cell} label={formatCell(a.cell)} />
                    <span className="block text-xs text-thunder-blue dark:text-blue-300">
                      CourtCaptain {a.role}
                      {a.role === "Admin" && <span className="text-zinc-500"> · added by {a.grantedBy}</span>}
                    </span>
                  </span>
                  {data.isOwner && a.role === "Admin" && <RemoveStaff coachId={a.id} name={a.name} />}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-zinc-500">Owners add and remove Admins. Owners can&apos;t be removed here.</p>
          </section>
        )}

        {tab === "orgs" && (
          <div className="grid gap-4">
            {/* More than 4: grouped by their features ("CourtOrg + CourtSync"), each group tapped open. */}
            {(data.orgs.length > GROUP_OVER
              ? groupByFeatures(data.orgs.map((o) => ({ ...o, group: featureGroup(o.features.filter((f) => f.on).map((f) => f.key)) })))
              : [{ label: "", orgs: data.orgs }]
            ).map((g) => {
              const cards = (
                <div className="grid gap-3">
                  {g.orgs.map((o) => (
                    <details key={o.slug} className={`${card} group overflow-hidden`}>
                      <summary className="flex cursor-pointer list-none items-center gap-3 p-4 [&::-webkit-details-marker]:hidden">
                        {/* The logo opens the organization (like the logo menu); the rest of the card opens or closes it. */}
                        <a
                          href={`/switch?org=${o.slug}`}
                          aria-label={`Open ${o.name}`}
                          title={`Open ${o.name}`}
                          className="shrink-0 rounded-lg ring-offset-2 hover:ring-2 hover:ring-thunder-blue"
                        >
                          <OrgLogo src={o.logo} name={o.name} color={o.color} className="size-10 rounded-lg" />
                        </a>
                        <div className="min-w-0 flex-1">
                          <h2 className="font-semibold">
                            {o.name}
                            <span className="ml-1.5 rounded bg-zinc-100 px-1.5 py-0.5 align-middle text-[11px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                              {o.abbr}
                            </span>
                          </h2>
                          <p className="text-xs text-zinc-500">
                            {o.owners.length ? `Owner: ${o.owners.map((d) => d.name).join(", ")}` : "No owner yet"} ·{" "}
                            {o.features.filter((f) => f.on).length} features on · /login/{o.slug}
                          </p>
                          {/* Its numbers at a glance, without opening the card. */}
                          <dl className="mt-2 grid grid-cols-4 gap-1.5 text-center">
                            {[
                              { label: "People", value: o.stats.people },
                              { label: "Teams", value: o.stats.teams },
                              { label: "Players", value: o.stats.players ?? "—" },
                              { label: "Visits wk", value: o.stats.visitsWeek, note: `${o.stats.visitsToday} today` },
                            ].map((m) => (
                              <div key={m.label} className="rounded-lg bg-zinc-50 px-1 py-1.5 dark:bg-white/5">
                                <dt className="text-[11px] text-zinc-500">{m.label}</dt>
                                <dd className="text-base font-semibold tabular-nums">{m.value}</dd>
                                {m.note && <dd className="text-[10px] text-zinc-500">{m.note}</dd>}
                              </div>
                            ))}
                          </dl>
                          {o.stats.coaches > 0 && (
                            <p className="mt-1.5 text-xs text-zinc-500">
                              Coaches logged in this week:{" "}
                              <span className="font-medium text-zinc-800 dark:text-zinc-100">
                                {o.stats.coachesThisWeek} of {o.stats.coaches}
                              </span>
                            </p>
                          )}
                        </div>
                        {/* The gear: this organization's features in a pop-up (a button, so it doesn't open or close the card). */}
                        <FeaturesGear orgName={o.name}>
                          <p className="text-sm text-zinc-500">{o.features.filter((f) => f.on).length} on</p>
                          <ul className="divide-y divide-zinc-950/5 dark:divide-white/10">
                            {o.features.map((f) => (
                              <li key={f.key} className="flex items-center justify-between gap-3 py-2">
                                <div className="min-w-0">
                                  <p className={`text-sm font-medium ${f.on ? "" : "text-zinc-500"}`}>{f.name}</p>
                                  <p className="text-xs text-zinc-500">
                                    {f.always
                                      ? "Comes with every organization"
                                      : f.since
                                        ? `On since ${date(f.since)} (${how[f.source ?? ""] ?? f.source})`
                                        : "Off"}
                                  </p>
                                </div>
                                {!f.always && <FeatureSwitch org={o.slug} orgName={o.name} feature={f.key} name={f.name} on={f.on} />}
                              </li>
                            ))}
                          </ul>
                          {o.slug !== "thunder" && o.slug !== "scenic-city" && (
                            <DeleteOrganization org={o.slug} orgName={o.name} teams={o.stats.teams} />
                          )}
                        </FeaturesGear>
                        <svg
                          viewBox="0 0 20 20"
                          fill="currentColor"
                          aria-hidden
                          className="size-5 text-zinc-400 transition-transform group-open:rotate-180"
                        >
                          <path d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" />
                        </svg>
                      </summary>
                      <div className="border-t border-zinc-100 p-4 dark:border-white/5">
                        <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-zinc-500 uppercase">Owners</h3>
                        {/* Each Owner's contact info, View as (view only) for support, and 🔑 Reset login (PIN 1234, email cleared). */}
                        <ul className="mb-2 divide-y divide-zinc-100 rounded-xl ring-1 ring-zinc-950/10 dark:divide-white/5 dark:ring-white/10">
                          {o.owners.map((d) => (
                            <li key={d.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                              <span className="min-w-0">
                                <span className="block font-medium">{d.name}</span>
                                <span className="block text-zinc-500">
                                  {d.cell ? <PhoneLink cell={d.cell} label={formatCell(d.cell)} /> : "No cell"}
                                </span>
                                <span className="block truncate text-zinc-500">
                                  {d.email ? <EmailLink email={d.email} /> : "No email"}
                                </span>
                              </span>
                              <span className="flex shrink-0 items-center gap-2">
                                {d.id !== user.coachId && <ViewAsButton coachId={d.id} name={d.name} />}
                                {d.id !== user.coachId && <ResetLoginButton org={o.slug} coachId={d.id} name={d.name} />}
                                <RemoveOwner org={o.slug} orgName={o.name} coachId={d.id} name={d.name} />
                              </span>
                            </li>
                          ))}
                          {o.owners.length === 0 && <li className="px-3 py-2.5 text-sm text-red-600">None yet: add one.</li>}
                        </ul>
                        <div className="mb-4">
                          <AddOwner org={o.slug} options={o.options} />
                        </div>

                        <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-zinc-500 uppercase">Admins</h3>
                        <p className="mb-4 text-sm">
                          {o.admins.length ? (
                            o.admins.map((a) => a.name).join(", ")
                          ) : (
                            <span className="text-zinc-500">None besides the Owners.</span>
                          )}
                        </p>

                        <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-zinc-500 uppercase">Directors</h3>
                        <ul className="mb-4 text-sm">
                          {o.directors.map((d) => (
                            <li key={d.id} className="py-0.5">
                              <span className="font-medium">{d.name}</span>
                              <span className="text-zinc-500">
                                {" "}
                                · {d.areas.length ? d.areas.map((a) => AREA_NAMES[a]).join(", ") : "no areas yet"}
                              </span>
                            </li>
                          ))}
                          {o.directors.length === 0 && <li className="text-zinc-500">None besides the Admins.</li>}
                        </ul>
                        <p className="-mt-3 mb-4 text-xs text-zinc-500">
                          Owners choose Admins and Admins choose Directors, on the organization&apos;s Users page.
                        </p>
                      </div>
                    </details>
                  ))}
                </div>
              );
              return g.label ? (
                <details key={g.label} className="group/k">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-1 py-2 [&::-webkit-details-marker]:hidden">
                    <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
                      <h2 className="text-sm font-semibold text-zinc-600 dark:text-zinc-300">
                        {g.label} <span className="font-normal text-zinc-400">({g.orgs.length})</span>
                      </h2>
                      {/* Collapsed: each organization's small logo (tap one to open it). */}
                      <span className="flex flex-wrap gap-1.5 group-open/k:hidden">
                        {g.orgs.map((o) => (
                          <a key={o.slug} href={`/switch?org=${o.slug}`} title={`Open ${o.name}`} aria-label={`Open ${o.name}`}>
                            <OrgLogo src={o.logo} name={o.name} color={o.color} className="size-7 rounded-md" />
                          </a>
                        ))}
                      </span>
                    </span>
                    <span className="shrink-0 text-zinc-400 transition-transform group-open/k:rotate-90">›</span>
                  </summary>
                  <div className="mt-2">{cards}</div>
                </details>
              ) : (
                <div key="all">{cards}</div>
              );
            })}
          </div>
        )}
      </main>
    </>
  );
}

import { Suspense } from "react";
import { redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { db } from "@/lib/db";
import OrgLogo from "../OrgLogo";
import { AREAS } from "@/lib/org-admin";
import { platformOverview } from "@/lib/platform";
import { TZ } from "@/lib/time";
import AppHeader from "../AppHeader";
import { card, PageTitle, PhoneLink } from "../ui";
import Link from "next/link";
import { formatCell } from "@/lib/phone";
import { AddOwner, AddStaff, FeatureSwitch, RemoveOwner, RemoveStaff } from "./PlatformTools";

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
  const tab = (await searchParams).tab === "staff" ? "staff" : "orgs";
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
            ] as const
          ).map(([key, label]) => (
            <Link
              key={key}
              href={key === "orgs" ? "/platform" : "/platform?tab=staff"}
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
          <div className="grid gap-3">
            {data.orgs.map((o) => (
              <details key={o.slug} className={`${card} group overflow-hidden`}>
                <summary className="flex cursor-pointer list-none items-center gap-3 p-4 [&::-webkit-details-marker]:hidden">
                  <OrgLogo src={o.logo} name={o.name} color={o.color} className="size-10 rounded-lg" />
                  <div className="min-w-0 flex-1">
                    <h2 className="font-semibold">{o.name}</h2>
                    <p className="text-xs text-zinc-500">
                      {o.owners.length} owner{o.owners.length === 1 ? "" : "s"} · {o.features.filter((f) => f.on).length} features
                      on · /login/{o.slug}
                    </p>
                  </div>
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
                  <div className="mb-4 flex flex-wrap items-center gap-2">
                    {o.owners.map((d) => (
                      <span
                        key={d.id}
                        className="inline-flex items-center gap-1 rounded-full bg-zinc-100 py-0.5 pr-1 pl-3 text-sm dark:bg-zinc-800"
                      >
                        {d.name}
                        <RemoveOwner org={o.slug} orgName={o.name} coachId={d.id} name={d.name} />
                      </span>
                    ))}
                    {o.owners.length === 0 && <span className="text-sm text-red-600">None yet: add one.</span>}
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

                  <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                    Features ({o.features.filter((f) => f.on).length} on)
                  </h3>
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
                </div>
              </details>
            ))}
          </div>
        )}
      </main>
    </>
  );
}

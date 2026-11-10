import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { requireFeature } from "@/lib/features-server";
import { db } from "@/lib/db";
import { currentScenic } from "@/lib/contexts-server";
import { hostingRequests } from "@/lib/org-partnerships";
import { TZ, timeLabel } from "@/lib/time";
import { listPartners, partnerHours } from "@/lib/scenic-partners";
import { shortDate } from "@/lib/program-options";
import AppHeader from "../../../AppHeader";
import { FacilitiesNav } from "../ScenicNav";
import { DecideHostingButtons } from "../../../hosting/HostingButtons";
import { Chip, PageTitle, card } from "../../../ui";
import { PartnerButton } from "./PartnerEditor";

export default function PartnersPage() {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <Partners />
    </Suspense>
  );
}

// Scenic City Directors: every partner. A partner's contacts: their own. Sorted by name.
async function Partners() {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  await requireFeature("scenic-city", "hosting-partners");
  const scenic = await currentScenic(user);
  if (!scenic || scenic.role !== "Director") redirect("/org/scenic-city");
  const deps = { pool: db, now: () => new Date() };
  const { partners, isDirector } = await listPartners(deps, user, scenic.role === "Director");
  // Organizations asking to host Scenic City's games (Admins and Directors of Facilities, on the Director chip).
  const requests = isDirector ? ((await hostingRequests(deps, user, "scenic-city")) ?? []) : [];
  const waiting = requests.filter((r) => r.status === "pending");
  // Each site's availability (its courts' hours on every upcoming game day), shown when its card is opened.
  const avail = new Map(
    await Promise.all(partners.map(async (p) => [p.id, await partnerHours(deps, user, p.id)] as const)),
  );
  const hm = (t: string) => timeLabel(t).replace(":00 ", " ");

  return (
    <>
      <AppHeader user={user} context={scenic.key} tab="scenic-facilities" />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <FacilitiesNav user={user} current="all" />
        <div className="flex items-start justify-between gap-3">
          <PageTitle
            title="Hosting Sites"
            subtitle={isDirector ? "Schools and organizations, by name" : "Your schools and organizations"}
          />
          {isDirector && <PartnerButton />}
        </div>
        {waiting.length > 0 && (
          <section className={`${card} mb-4 overflow-hidden ring-amber-500/40`}>
            <h2 className="px-4 pt-4 pb-2 font-semibold">Organizations asking to host games ({waiting.length})</h2>
            <ul className="divide-y divide-zinc-100 border-t border-zinc-100 dark:divide-white/5 dark:border-white/5">
              {waiting.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0 text-sm">
                    <p className="font-semibold">{r.name}</p>
                    <p className="text-zinc-500">
                      Asked by {r.requestedBy} ·{" "}
                      {r.requestedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: TZ })}
                    </p>
                  </div>
                  <DecideHostingButtons id={r.id} name={r.name} />
                </li>
              ))}
            </ul>
          </section>
        )}
        <ul className="grid gap-3 sm:grid-cols-2">
          {partners.map((p) => {
            const h = avail.get(p.id);
            return (
              <li key={p.id}>
                {/* Tap to open: its availability on each upcoming game day; the ↗ opens its page (gyms, hours, contacts). */}
                <details className={`${card} group block p-4 hover:ring-scenic-navy/40`}>
                  <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="font-semibold">{p.name}</h2>
                      <span className="flex shrink-0 items-center gap-1">
                        {!p.approved && <Chip tone="amber">Not approved</Chip>}
                        {p.org && <Chip tone="blue">Hosting Site</Chip>}
                        {/* Its page (↗): gyms, hours and contacts. */}
                        <Link
                          href={`/org/scenic-city/partners/${p.id}`}
                          aria-label={`${p.name}: partner page`}
                          title="Partner page"
                          className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-zinc-600 ring-1 ring-zinc-950/15 hover:bg-zinc-100 dark:text-zinc-300 dark:ring-white/20 dark:hover:bg-white/10"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden className="size-4">
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                            />
                          </svg>
                        </Link>
                        <svg
                          viewBox="0 0 20 20"
                          fill="currentColor"
                          aria-hidden
                          className="size-5 text-zinc-400 transition-transform group-open:rotate-180"
                        >
                          <path d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" />
                        </svg>
                      </span>
                    </div>
                    <p className="text-sm text-zinc-500">
                      {p.kind} ·{" "}
                      {[p.hostsGames && "Hosting games", p.registersTeams && "Registering teams"].filter(Boolean).join(" · ")}
                    </p>
                    <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
                      {p.gyms} {p.gyms === 1 ? "gym" : "gyms"} · {p.courts} {p.courts === 1 ? "court" : "courts"}
                    </p>
                    <p className="truncate text-sm text-zinc-500">
                      {p.contacts.length ? p.contacts.map((c) => c.name).join(", ") : "No contacts yet"}
                    </p>
                  </summary>
                  <div className="mt-3 border-t border-zinc-100 pt-3 dark:border-white/5">
                    <p className="mb-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase">Availability</p>
                    {!h || !h.courts.length ? (
                      <p className="text-sm text-zinc-500">No courts yet.</p>
                    ) : !h.days.length ? (
                      <p className="text-sm text-zinc-500">No upcoming game days.</p>
                    ) : (
                      <ul className="space-y-1 text-sm">
                        {h.days.map((d) => {
                          const open = h.courts.filter((c) => h.hours[`${c.id}:${d.id}`]);
                          return (
                            <li key={d.id} className="flex gap-2">
                              <span className="w-24 shrink-0 text-zinc-500">{shortDate(d.day)}</span>
                              {open.length ? (
                                <span className="min-w-0 text-zinc-700 dark:text-zinc-200">
                                  {open
                                    .map((c) => {
                                      const w = h.hours[`${c.id}:${d.id}`];
                                      const where = c.name === "Whole gym" ? c.gym : `${c.gym} ${c.name}`;
                                      return `${where} ${hm(w.starts)}–${hm(w.ends)}`;
                                    })
                                    .join(" · ")}
                                </span>
                              ) : (
                                <span className="text-zinc-400">Not open</span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
        {!partners.length && (
          <p className="text-zinc-500">
            {isDirector
              ? "No partners yet."
              : "You're not a contact for a school or organization yet. A Scenic City Director can add you."}
          </p>
        )}
      </main>
    </>
  );
}

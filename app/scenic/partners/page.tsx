import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { requireFeature } from "@/lib/features-server";
import { db } from "@/lib/db";
import { currentScenic } from "@/lib/contexts-server";
import { hostingRequests } from "@/lib/org-partnerships";
import { TZ } from "@/lib/time";
import { listPartners } from "@/lib/scenic-partners";
import AppHeader from "../../AppHeader";
import { FacilitiesNav } from "../ScenicNav";
import { DecideHostingButtons } from "../../hosting/HostingButtons";
import { Chip, PageTitle, card } from "../../ui";
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
  if (!scenic || scenic.role !== "Director") redirect("/scenic");
  const deps = { pool: db, now: () => new Date() };
  const { partners, isDirector } = await listPartners(deps, user, scenic.role === "Director");
  // Organizations asking to host Scenic City's games (Admins and Directors of Facilities, on the Director chip).
  const requests = isDirector ? ((await hostingRequests(deps, user, "scenic-city")) ?? []) : [];
  const waiting = requests.filter((r) => r.status === "pending");

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
          {partners.map((p) => (
            <li key={p.id}>
              <Link href={`/scenic/partners/${p.id}`} className={`${card} block p-4 hover:ring-scenic-navy/40`}>
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-semibold">{p.name}</h2>
                  {!p.approved && <Chip tone="amber">Not approved</Chip>}
                  {p.org && <Chip tone="blue">Hosting Site</Chip>}
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
              </Link>
            </li>
          ))}
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

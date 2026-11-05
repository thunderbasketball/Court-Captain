import { Suspense } from "react";
import { redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { requireFeature } from "@/lib/features-server";
import { db } from "@/lib/db";
import { seesWho } from "@/lib/org-admin";
import { listCourts } from "@/lib/scenic-courts";
import { currentScenic } from "@/lib/contexts-server";
import AppHeader from "../../../AppHeader";
import { FacilitiesNav } from "../ScenicNav";
import { PageTitle, card } from "../../../ui";
import { CourtDivisions } from "./CourtDivisions";

export default function CourtsPage() {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <Courts />
    </Suspense>
  );
}

// Facilities → Courts (Admins and Directors of Facilities): every hosting site's gyms and courts; each court lists which
// divisions may play there. The Scheduler Grid only places a division's games on courts approved for it.
async function Courts() {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  await requireFeature("scenic-city", "hosting-partners");
  const scenic = await currentScenic(user);
  if (!scenic || scenic.role !== "Director") redirect("/");
  const list = await listCourts({ pool: db, now: () => new Date() }, user);
  if (!list) redirect("/org/scenic-city/game-days");
  const who = await seesWho(db, user, "scenic-city"); // Owners and Admins see who set a court

  return (
    <>
      <AppHeader user={user} context={scenic.key} tab="scenic-facilities" />
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-6">
        <FacilitiesNav user={user} current="courts" />
        <PageTitle
          title="Courts"
          subtitle="Pick which divisions can play on each court. A court with none picked takes every division. The Scheduler only places a division's games on courts approved for it."
        />
        {!list.gyms.length ? (
          <p className={`${card} px-4 py-3 text-sm text-zinc-500`}>No hosting sites have gyms yet.</p>
        ) : !list.divisions.length ? (
          <p className={`${card} px-4 py-3 text-sm text-zinc-500`}>
            No current League has divisions yet. Add them on the League&apos;s page first.
          </p>
        ) : (
          <div className="space-y-3">
            {list.gyms.map((g) => (
              <details key={g.key} className={`${card} group overflow-hidden`}>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
                  <span className="min-w-0">
                    <span className="font-semibold">
                      <span className="mr-1 inline-block text-zinc-400 transition group-open:rotate-90">›</span>
                      {g.name}
                    </span>
                    <span className="block text-xs text-zinc-500">
                      {g.host}
                      {g.address && ` · ${g.address}`}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-xs text-zinc-500">
                    {g.courts.length} court{g.courts.length === 1 ? "" : "s"}
                    <span className="block">
                      {g.courts.filter((c) => c.divisions.length).length
                        ? `${g.courts.filter((c) => c.divisions.length).length} limited`
                        : "All divisions"}
                    </span>
                  </span>
                </summary>
                <ul className="divide-y divide-zinc-100 border-t border-zinc-100 dark:divide-white/5 dark:border-white/5">
                  {g.courts.map((c) => (
                    <li key={c.key} className="px-4 py-3">
                      <CourtDivisions court={who ? c : { ...c, setBy: null }} divisions={list.divisions} />
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        )}
      </main>
    </>
  );
}

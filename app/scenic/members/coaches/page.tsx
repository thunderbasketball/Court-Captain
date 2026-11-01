import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { currentScenic } from "@/lib/contexts-server";
import { db } from "@/lib/db";
import { formatCell } from "@/lib/phone";
import { programCoaches } from "@/lib/scenic-members";
import AppHeader from "../../../AppHeader";
import { MembersNav } from "../../ScenicNav";
import { PageTitle, PhoneLink, card } from "../../../ui";

export default function ScenicCoachesPage({ searchParams }: PageProps<"/scenic/members/coaches">) {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <ScenicCoaches searchParams={searchParams} />
    </Suspense>
  );
}

// Members → Coaches: one tab per active program; the coaches of its registered teams, by last name, with their teams.
async function ScenicCoaches({ searchParams }: { searchParams: PageProps<"/scenic/members/coaches">["searchParams"] }) {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  const scenic = await currentScenic(user);
  if (!scenic) redirect("/");
  const asked = (await searchParams).program;
  const data = await programCoaches({ pool: db, now: () => new Date() }, user, typeof asked === "string" ? asked : null);
  if (!data) redirect("/scenic");

  return (
    <>
      <AppHeader user={user} context={scenic.key} tab="scenic-members" />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <MembersNav user={user} current="coaches" />
        <PageTitle title="Coaches" subtitle="The coaches of each program's registered teams" />
        {data.programs.length > 1 && (
          <div className="mb-4 flex flex-wrap gap-2">
            {data.programs.map((p) => (
              <Link
                key={p.id}
                href={`/scenic/members/coaches?program=${p.id}`}
                aria-current={p.id === data.current ? "page" : undefined}
                className={`rounded-full px-3 py-1.5 text-sm font-medium ring-1 ${
                  p.id === data.current
                    ? "bg-scenic-navy text-white ring-scenic-navy dark:bg-white dark:text-scenic-navy"
                    : "text-zinc-700 ring-zinc-950/15 dark:text-zinc-200 dark:ring-white/20"
                }`}
              >
                {p.name}
              </Link>
            ))}
          </div>
        )}
        {!data.current ? (
          <p className="text-sm text-zinc-500">No active programs.</p>
        ) : (
          <section className={`${card} p-4`}>
            <h2 className="mb-1 font-semibold">
              {data.programs.find((p) => p.id === data.current)?.name} · {data.coaches.length} coach
              {data.coaches.length === 1 ? "" : "es"}
            </h2>
            {!data.coaches.length && !data.noCoach.length && <p className="text-sm text-zinc-500">No teams registered yet.</p>}
            <ul className="divide-y divide-zinc-100 dark:divide-white/5">
              {data.coaches.map((c) => (
                <li key={c.id} className="py-2.5 text-sm">
                  <p className="font-medium">
                    {c.name} <PhoneLink cell={c.cell} label={formatCell(c.cell)} />
                  </p>
                  <p className="text-zinc-600 dark:text-zinc-300">{c.teams.map((t) => `${t.name} (${t.from})`).join(" · ")}</p>
                </li>
              ))}
            </ul>
            {data.noCoach.length > 0 && (
              <p className="mt-2 text-sm font-semibold text-red-600 dark:text-red-400">
                No coach yet: {data.noCoach.map((t) => `${t.name} (${t.from})`).join(" · ")}
              </p>
            )}
          </section>
        )}
      </main>
    </>
  );
}

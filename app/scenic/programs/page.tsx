import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { currentScenic } from "@/lib/contexts-server";
import { db } from "@/lib/db";
import { requireFeature } from "@/lib/features-server";
import { listPrograms } from "@/lib/scenic-programs";
import { dayLabel } from "@/lib/time";
import AppHeader from "../../AppHeader";
import { card, PageTitle } from "../../ui";
import { ProgramEditor } from "./ProgramTools";
import { RegBadge } from "./RegBadge";

export default function ProgramsPage() {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <Programs />
    </Suspense>
  );
}

// Scenic City programs (SPEC.md section 13, step 6b): soonest first, finished ones last. Everyone in Scenic City sees them;
// Directors of Programs (on the Director chip) add them.
async function Programs() {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  await requireFeature("scenic-city", "programs");
  const scenic = await currentScenic(user);
  if (!scenic) redirect("/");
  const data = await listPrograms({ pool: db, now: () => new Date() }, user);
  if (!data) redirect("/scenic");
  const manage = data.canManage && scenic.role === "Director";

  return (
    <>
      <AppHeader user={user} context={scenic.key} tab="programs" />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <div className="flex items-start justify-between gap-3">
          <PageTitle title="Programs" subtitle="Leagues, Circuits and Tournaments" />
          {manage && <ProgramEditor />}
        </div>
        {!data.programs.length && <p className="text-zinc-500">No programs yet.{manage && " Tap “+ New program”."}</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          {data.programs.map((p) => (
            <Link key={p.id} href={`/scenic/programs/${p.id}`} className={`${card} block p-4 hover:ring-scenic-navy/40`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-semibold tracking-wide text-scenic-navy uppercase dark:text-zinc-300">{p.kind}</p>
                  <h2 className="font-semibold">{p.name}</h2>
                </div>
                <RegBadge status={p.status} />
              </div>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                {dayLabel(p.startsOn)} – {dayLabel(p.endsOn)}
              </p>
              <p className="text-xs text-zinc-500">
                {p.divisions} division{p.divisions === 1 ? "" : "s"} · {p.teams} team{p.teams === 1 ? "" : "s"}
                {p.feeCents !== null && ` · $${(p.feeCents / 100).toFixed(2)} per team`}
              </p>
            </Link>
          ))}
        </div>
      </main>
    </>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { currentScenic } from "@/lib/contexts-server";
import { db } from "@/lib/db";
import { REC_LIMITED, money, optionName } from "@/lib/program-options";
import { requireFeature } from "@/lib/features-server";
import { listPrograms } from "@/lib/scenic-programs";
import { dayLabel } from "@/lib/time";
import AppHeader from "../../../AppHeader";
import { ProgramsNav } from "../ScenicNav";
import { card, PageTitle } from "../../../ui";
import { ProgramEditor, ProgramLogo } from "./ProgramTools";
import { RegBadge } from "./RegBadge";

import { PageFrame } from "../../../ui";
import { hasFeature } from "@/lib/features";

// Scenic City programs (SPEC.md section 13, step 6b): soonest first, finished ones last. Everyone in Scenic City sees them;
// Directors of Programs (on the Director chip) add them.
export async function ProgramsContent({
  embedded = false,
}: {
  embedded?: boolean; // inside a Home card: no header or page frame, and never sends you away
} = {}) {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  if (embedded) {
    if (!(await hasFeature(db, "scenic-city", "programs"))) return null;
  } else await requireFeature("scenic-city", "programs");
  const scenic = await currentScenic(user);
  if (!scenic) {
    if (embedded) return null;
    redirect("/");
  }
  const data = await listPrograms({ pool: db, now: () => new Date() }, user);
  if (!data) {
    if (embedded) return null;
    redirect("/org/scenic-city");
  }
  const manage = data.canManage && scenic.role === "Director";

  return (
    <>
      {!embedded && <AppHeader user={user} context={scenic.key} tab="programs" />}
      <PageFrame embedded={embedded} className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <ProgramsNav current="all" />
        <div className="flex items-start justify-between gap-3">
          <PageTitle title="Programs" subtitle="Leagues, Circuits and Tournaments" />
          {manage && <ProgramEditor />}
        </div>
        {!data.programs.length && <p className="text-zinc-500">No programs yet.{manage && " Tap “+ New program”."}</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          {data.programs.map((p) => (
            <Link key={p.id} href={`/org/scenic-city/programs/${p.id}`} className={`${card} block p-4 hover:ring-scenic-navy/40`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-3">
                  <ProgramLogo src={p.logo} />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold tracking-wide text-scenic-navy uppercase dark:text-zinc-300">{p.kind}</p>
                    <h2 className="font-semibold">{p.name}</h2>
                  </div>
                </div>
                <RegBadge status={p.status} />
              </div>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                {dayLabel(p.startsOn)} – {dayLabel(p.endsOn)}
              </p>
              <p className="text-xs text-zinc-500">
                {p.divisions} division{p.divisions === 1 ? "" : "s"} · {p.teams} team{p.teams === 1 ? "" : "s"}
                {p.kind === "League"
                  ? p.options.length > 0 && ` · ${p.options.map((o) => optionName(o.kind)).join(", ")}`
                  : p.feeCents !== null && ` · ${money(p.feeCents)} per team`}
              </p>
              {p.recLimited && <p className="text-xs font-medium text-amber-700 dark:text-amber-300">{REC_LIMITED}</p>}
            </Link>
          ))}
        </div>
      </PageFrame>
    </>
  );
}

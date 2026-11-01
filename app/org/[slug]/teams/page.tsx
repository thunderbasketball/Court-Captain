import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { orgPrograms } from "@/lib/org-leagues";
import { listOrgTeams, type OrgTeam } from "@/lib/org-teams";
import { orgInfo } from "@/lib/org-registry";
import { GRADE_CHOICES } from "@/lib/scenic-teams";
import AppHeader from "../../../AppHeader";
import { PageTitle, card } from "../../../ui";
import { NeedsCoach } from "./NeedsCoach";
import { RegisterAllButton } from "../../../leagues/LeagueButtons";
import { AddTeamButton } from "./TeamTools";

export default function OrgTeamsPage({ params }: PageProps<"/org/[slug]/teams">) {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <OrgTeams params={params} />
    </Suspense>
  );
}

const GROUP = {
  Boys: "bg-sky-50 ring-sky-200 dark:bg-sky-500/10 dark:ring-sky-500/20",
  Girls: "bg-pink-50 ring-pink-200 dark:bg-pink-500/10 dark:ring-pink-500/20",
} as const;

// A registered organization's teams (Team Management): Boys then Girls, by grade. Admins and Directors of Teams see all
// and add teams; a coach sees their own.
async function OrgTeams({ params }: { params: PageProps<"/org/[slug]/teams">["params"] }) {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  const { slug } = await params;
  const [o, list] = await Promise.all([orgInfo(db, slug), listOrgTeams({ pool: db, now: () => new Date() }, user, slug)]);
  if (!o || !list) notFound();
  const progs = await orgPrograms({ pool: db, now: () => new Date() }, user, slug);
  const day = (d: string) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const groups = (["Boys", "Girls"] as const)
    .map((g) => ({ gender: g, teams: list.teams.filter((t) => t.gender === g) }))
    .filter((g) => g.teams.length);

  return (
    <>
      <AppHeader user={user} context={`org:${slug}`} tab="org-teams" />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <div className="flex items-start justify-between gap-3">
          <PageTitle title="Teams" subtitle={list.canManage ? `${o.name}'s teams and coaches` : "Your teams"} />
          {list.canManage && <AddTeamButton org={slug} grades={GRADE_CHOICES} />}
        </div>
        {progs && progs.programs.length > 0 && (
          <section className={`${card} mb-4 p-4`}>
            <h2 className="font-semibold">{progs.league} programs</h2>
            <p className="mb-2 text-sm text-zinc-500">
              Register your teams: each goes into its division (gender, grade and level). Coaches can be added later.
            </p>
            <ul className="divide-y divide-zinc-100 dark:divide-white/5">
              {progs.programs.map((p) => (
                <li key={p.id} className="flex flex-wrap items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0 text-sm">
                    <p className="font-semibold">
                      {p.name} <span className="font-normal text-zinc-500">· {p.kind}</span>
                    </p>
                    <p className="text-zinc-500">
                      {day(p.startsOn)}–{day(p.endsOn)}
                      {p.feeCents !== null && ` · $${(p.feeCents / 100).toFixed(0)} per team, paid later`}
                    </p>
                    <p className="text-zinc-500">
                      {p.registered} of {p.registered + p.unregistered} teams registered
                      {p.status === "open" ? ` · open until ${day(p.regCloses)}` : " · registration opens soon"}
                    </p>
                  </div>
                  {p.status === "open" && p.unregistered > 0 && (
                    <RegisterAllButton org={slug} programId={p.id} program={p.name} count={p.unregistered} />
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
        {!list.teams.length && <p className="text-sm text-zinc-500">No teams yet. Tap + Add.</p>}
        <div className="space-y-4">
          {groups.map((g) => (
            <section key={g.gender} className={`rounded-2xl p-3 ring-1 ${GROUP[g.gender]}`}>
              <h2 className="mb-2 px-1 text-sm font-semibold">
                {g.gender} ({g.teams.length})
              </h2>
              <ul className="space-y-2">
                {g.teams.map((t) => (
                  <li key={t.id}>
                    <TeamRow slug={slug} t={t} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </main>
    </>
  );
}

function TeamRow({ slug, t }: { slug: string; t: OrgTeam }) {
  const head = t.coaches.find((c) => c.role === "HeadCoach");
  return (
    <Link
      href={`/org/${slug}/teams/${t.id}`}
      className={`${card} flex items-center justify-between gap-3 p-3 hover:ring-thunder-blue/40`}
    >
      <span className="min-w-0">
        <span className="block font-semibold">{t.name}</span>
        {t.coaches.length ? (
          <span className="block text-sm text-zinc-500">
            {head ? `Head Coach: ${head.name}` : "No Head Coach yet"}
            {t.coaches.length > (head ? 1 : 0) && ` · ${t.coaches.length - (head ? 1 : 0)} asst.`}
          </span>
        ) : (
          <NeedsCoach />
        )}
      </span>
      <span className="shrink-0 text-right text-xs font-medium text-zinc-500">
        {t.grade} · {t.level}
      </span>
    </Link>
  );
}

import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { teamPrograms } from "@/lib/org-leagues";
import { COACH_ROLES, getOrgTeam } from "@/lib/org-teams";
import AppHeader from "../../../../AppHeader";
import { PageTitle, card } from "../../../../ui";
import { DateChips, ProgramButton, RegisterLeagueButton } from "../../../../leagues/LeagueButtons";
import { easternDate } from "@/lib/time";
import { NeedsCoach } from "../NeedsCoach";
import { AddCoachButton, DeleteTeamButton, RemoveCoachButton } from "../TeamTools";

export default function OrgTeamPage({ params }: PageProps<"/org/[slug]/teams/[id]">) {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <OrgTeam params={params} />
    </Suspense>
  );
}

// One team of a registered organization: its coaches (who added them). Admins and Directors of Teams add and remove
// coaches and delete the team; its coaches see it.
async function OrgTeam({ params }: { params: PageProps<"/org/[slug]/teams/[id]">["params"] }) {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  const { slug, id } = await params;
  const found = await getOrgTeam({ pool: db, now: () => new Date() }, user, slug, id);
  if (!found) notFound();
  const { team: t, canManage } = found;
  const today = easternDate(new Date());
  const progs = await teamPrograms({ pool: db, now: () => new Date() }, user, slug, t.id);
  const day = (d: string) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const roleName = (r: string) => COACH_ROLES.find((x) => x.key === r)?.name ?? r;
  const hasHead = t.coaches.some((c) => c.role === "HeadCoach");

  return (
    <>
      <AppHeader user={user} context={`org:${slug}`} tab="org-teams" />
      <main className="mx-auto w-full max-w-3xl flex-1 space-y-4 px-4 py-6">
        <Link href={`/org/${slug}/teams`} className="text-sm text-zinc-500 hover:underline">
          ← Teams
        </Link>
        <div className="flex items-start justify-between gap-3">
          <PageTitle title={t.name} subtitle={`${t.gender} · ${t.grade} · ${t.level} · added by ${t.createdBy}`} />
          {canManage && <DeleteTeamButton org={slug} id={t.id} name={t.name} />}
        </div>

        <section className={`${card} p-4`}>
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 className="font-semibold">Coaches</h2>
            {canManage && <AddCoachButton org={slug} teamId={t.id} hasHead={hasHead} />}
          </div>
          {!t.coaches.length && <NeedsCoach />}
          <ul className="divide-y divide-zinc-100 dark:divide-white/5">
            {t.coaches.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 py-2.5">
                <span>
                  <span className="block text-sm font-medium">{c.name}</span>
                  <span className="block text-xs text-zinc-500">
                    {roleName(c.role)} · added by {c.addedBy}
                  </span>
                </span>
                {canManage && <RemoveCoachButton org={slug} teamId={t.id} coachId={c.id} name={c.name} />}
              </li>
            ))}
          </ul>
        </section>

        {progs && (
          <section className={`${card} p-4`}>
            <h2 className="mb-1 font-semibold">{progs.league} programs</h2>
            {!progs.programs.length ? (
              <p className="text-sm text-zinc-500">No programs open for registration right now.</p>
            ) : (
              <ul className="divide-y divide-zinc-100 dark:divide-white/5">
                {progs.programs.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0 text-sm">
                      <p className="font-semibold">
                        {p.name} <span className="font-normal text-zinc-500">· {p.kind}</span>
                      </p>
                      <p className="text-zinc-500">
                        {day(p.startsOn)}–{day(p.endsOn)}
                        {p.feeCents !== null && ` · $${(p.feeCents / 100).toFixed(0)} fee, paid later`}
                      </p>
                      {p.registered ? (
                        <>
                          <p className="text-emerald-700 dark:text-emerald-400">
                            Registered: {p.registered.where} · by {p.registered.by}
                            {p.registered.paid ? " · Paid" : ""}
                          </p>
                          {p.registered.removedBy && (
                            <p className="font-semibold text-red-600 dark:text-red-400">
                              Taken out of this program by {p.registered.removedBy}
                            </p>
                          )}
                          {p.entry && (
                            <div className="mt-1.5">
                              <p className="text-xs text-zinc-500">
                                {p.entry.allSeason ? "ALL Season" : "Single Days"} · plays {Object.keys(p.entry.perDate).length}{" "}
                                date{Object.keys(p.entry.perDate).length === 1 ? "" : "s"}
                              </p>
                              <DateChips
                                org={slug}
                                teamId={t.id}
                                programId={p.id}
                                perDate={p.entry.perDate}
                                bracket={p.entry.bracket}
                                today={today}
                                removedBy={p.registered.removedBy}
                                off={p.registered.off}
                                teamOff={p.registered.teamOff}
                                canChange={progs.canRegister}
                              />
                            </div>
                          )}
                        </>
                      ) : p.status === "upcoming" ? (
                        <p className="text-zinc-500">Registration opens soon</p>
                      ) : !p.fits ? (
                        <p className="text-zinc-500">
                          No division for {t.gender} {t.grade} {t.level}
                        </p>
                      ) : (
                        <p className="text-zinc-500">Registration open until {day(p.regCloses)}</p>
                      )}
                    </div>
                    {progs.canRegister && p.status === "open" && (p.registered || p.fits) && (
                      <div className="flex shrink-0 gap-2">
                        {p.kind === "League" && (
                          <RegisterLeagueButton
                            org={slug}
                            teamId={t.id}
                            programId={p.id}
                            program={p.name}
                            options={p.options}
                            gameDates={p.gameDates}
                            today={today}
                            entry={p.entry}
                          />
                        )}
                        {(p.registered || p.kind !== "League") && (
                          <ProgramButton org={slug} teamId={t.id} programId={p.id} program={p.name} registered={!!p.registered} />
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </main>
    </>
  );
}

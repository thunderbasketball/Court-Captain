import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { teamPrograms } from "@/lib/org-leagues";
import { COACH_ROLES, getOrgTeam } from "@/lib/org-teams";
import AppHeader from "../../../../AppHeader";
import { Chip, card } from "../../../../ui";
import { DateChips, ProgramButton, RegisterLeagueButton } from "../../../../leagues/LeagueButtons";
import { easternDate } from "@/lib/time";
import { MustBeEntered } from "../../../../TeamRow";
import { listOrgRoster } from "@/lib/org-rosters";
import { AddPlayerButton, ImportPlayersButton, RemovePlayerButton } from "../RosterTools";
import { AddCoachButton, AltNameButton, DeleteTeamButton, RemoveCoachButton } from "../TeamTools";
import { followRename } from "@/lib/org-rename";

export default function OrgTeamPage({ params, searchParams }: PageProps<"/org/[slug]/teams/[id]">) {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <OrgTeam params={params} searchParams={searchParams} />
    </Suspense>
  );
}

// One team of a registered organization, laid out like Thunder's: Staff and Roster tabs (Uniforms and Practices come when
// the organization has those features). Staff: its coaches (who added them) and its league programs; Roster: its
// players. Admins and Directors of Teams change them; its coaches see them.
async function OrgTeam({
  params,
  searchParams,
}: {
  params: PageProps<"/org/[slug]/teams/[id]">["params"];
  searchParams: PageProps<"/org/[slug]/teams/[id]">["searchParams"];
}) {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  const { slug, id } = await params;
  await followRename(slug, (s) => `/org/${s}/teams/${id}`);
  const found = await getOrgTeam({ pool: db, now: () => new Date() }, user, slug, id);
  if (!found) notFound();
  const { team: t, canManage } = found;
  const tab = (await searchParams).tab === "roster" ? "roster" : "staff";
  const roster = await listOrgRoster({ pool: db, now: () => new Date() }, user, slug, t.id);
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
        <nav aria-label={`${t.name} tabs`} className="flex gap-1 overflow-x-auto border-b border-zinc-200 dark:border-white/10">
          {(
            [
              ["staff", "Staff", `/org/${slug}/teams/${t.id}`],
              ["roster", "Roster", `/org/${slug}/teams/${t.id}?tab=roster`],
            ] as const
          ).map(([key, label, href]) => (
            <Link
              key={key}
              href={href}
              aria-current={tab === key ? "page" : undefined}
              className={`shrink-0 border-b-2 px-3 py-2 text-sm font-semibold whitespace-nowrap ${
                tab === key
                  ? "border-thunder-orange text-zinc-900 dark:text-white"
                  : "border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
              } ${key === "roster" && !t.players ? "animate-pulse text-red-600! dark:text-red-400!" : ""}`}
            >
              {label}
            </Link>
          ))}
        </nav>

        <section className={`${card} p-5`}>
          <div className="flex items-start gap-3">
            <span
              className={`flex size-12 shrink-0 items-center justify-center rounded-xl text-base font-bold text-white ${
                t.gender === "Boys" ? "bg-thunder-blue" : "bg-pink-600"
              }`}
            >
              {t.name.split(" ")[0]}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <h1 className="text-2xl font-semibold tracking-tight">
                  {t.name}
                  {t.altName && <span className="text-base font-normal text-zinc-500"> · {t.altName}</span>}
                </h1>
                <Chip tone={t.level === "COMP" ? "orange" : "zinc"}>{t.level}</Chip>
              </div>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                {t.gender} · {t.grade} grade
              </p>
              <p className="mt-1 text-xs text-zinc-400">Created by {t.createdBy}</p>
              {!hasHead && <MustBeEntered what="COACH INFO" />}
              {!t.players && <MustBeEntered what="ROSTER" />}
            </div>
          </div>
          {canManage && (
            <div className="mt-3">
              <AltNameButton org={slug} id={t.id} alt={t.altName} />
            </div>
          )}
        </section>

        {tab === "roster" && roster && (
          <section className={`${card} overflow-hidden`}>
            <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-3">
              <h2 className="font-semibold">Players ({roster.players.length})</h2>
              {roster.canManage && (
                <div className="flex shrink-0 gap-2">
                  <ImportPlayersButton org={slug} teamId={t.id} />
                  <AddPlayerButton org={slug} teamId={t.id} />
                </div>
              )}
            </div>
            {!roster.players.length && (
              <p className="px-4 pb-4 text-sm text-zinc-500">
                {roster.canManage ? "No players yet. Tap “+ Add” (or Import)." : "No players on the roster yet."}
              </p>
            )}
            <ul className="divide-y divide-zinc-100 border-t border-zinc-100 dark:divide-white/5 dark:border-white/5">
              {roster.players.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {p.jersey && <span className="mr-1 text-zinc-500">#{p.jersey}</span>}
                      {p.first} <span className="font-semibold">{p.last}</span>
                    </span>
                    <span className="block text-xs text-zinc-400">
                      {p.grade === 0 ? "K" : `Grade ${p.grade}`} · added by {p.addedBy}
                    </span>
                  </span>
                  {roster.canManage && (
                    <RemovePlayerButton org={slug} teamId={t.id} playerId={p.id} name={`${p.first} ${p.last}`} />
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {tab === "staff" && (
          <>
            <section className={`${card} p-4`}>
              <div className="mb-2 flex items-center justify-between gap-3">
                <h2 className="font-semibold">Coaches</h2>
                {canManage && <AddCoachButton org={slug} teamId={t.id} hasHead={hasHead} />}
              </div>
              {!t.coaches.length && <p className="text-sm text-zinc-500">No coaches yet.</p>}
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
                                    {p.entry.allSeason ? "ALL Season" : "Single Days"} · plays{" "}
                                    {Object.keys(p.entry.perDate).length} date
                                    {Object.keys(p.entry.perDate).length === 1 ? "" : "s"}
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
                              <ProgramButton
                                org={slug}
                                teamId={t.id}
                                programId={p.id}
                                program={p.name}
                                registered={!!p.registered}
                              />
                            )}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
            {canManage && <DeleteTeamButton org={slug} id={t.id} name={t.name} />}
          </>
        )}
      </main>
    </>
  );
}

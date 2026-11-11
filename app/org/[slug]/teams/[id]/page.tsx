import { Suspense } from "react";
import { orgKey } from "@/lib/chat";
import { hasFeature } from "@/lib/features";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { seesWho } from "@/lib/org-admin";
import { db } from "@/lib/db";
import { teamPrograms } from "@/lib/org-leagues";
import { scheduledGames } from "@/lib/scenic-games";
import { LeagueGames, ScheduleList } from "../../../../LeagueGames";
import { COACH_ROLES, getOrgTeam } from "@/lib/org-teams";
import AppHeader from "../../../../AppHeader";
import { Chip, CollapseCard, card } from "../../../../ui";
import { DateChips, ProgramButton, RegisterLeagueButton } from "../../../../leagues/LeagueButtons";
import { easternDate } from "@/lib/time";
import { MustBeEntered } from "../../../../TeamRow";
import { HeadCoachEmailButton, WaitingCoachButton } from "../../../../CoachContactTools";
import { listOrgRoster } from "@/lib/org-rosters";
import { AddPlayerButton, ImportPlayersButton, RemovePlayerButton } from "../RosterTools";
import { AddCoachButton, AltNameButton, DeleteTeamButton, RemoveCoachButton } from "../TeamTools";
import { followRename } from "@/lib/org-rename";
import { ViewAsButton } from "../../../../ViewAsButton";
import { CardPanel, ChatIcon, EmailIcon, PanelIcon, TextIcon } from "../../../../CardIcons";
import ChatPanel from "../../../../ChatPanel";
import { canChangeOwnPractices, ownPracticeLocations, ownPracticesOn, upcomingOwnPractices } from "@/lib/team-practices";
import TeamPractices from "../../../../TeamPractices";
import NextSevenDays from "../../../../NextSevenDays";
import { takesAttendance } from "@/lib/event-attendance";
import { BookPracticesButton, BookPracticesPanel } from "../../../../BookPractices";

export default function OrgTeamPage({ params, searchParams }: PageProps<"/org/[slug]/teams/[id]">) {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <OrgTeam params={params} searchParams={searchParams} />
    </Suspense>
  );
}

// One team of a registered organization, laid out like Thunder's team page: the team card, Next 7 days, then cards that
// open when tapped (Staff, Players, Games, its League programs, and Practices with CourtFacility), with their icons on
// the title line. ?tab=staff|roster|games|programs|practices opens that card. Admins and Directors of Teams change
// them; its coaches see them.
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
  const who = await seesWho(db, user, slug); // Owners and Admins see who did it
  const asked = (await searchParams).tab;
  const opened = typeof asked === "string" ? asked : "";
  // Practices only with CourtFacility (own gym practices are part of it).
  const practicesOn = await ownPracticesOn(db, slug);
  const roster = await listOrgRoster({ pool: db, now: () => new Date() }, user, slug, t.id);
  const today = easternDate(new Date());
  const progs = await teamPrograms({ pool: db, now: () => new Date() }, user, slug, t.id);
  // Its League games (opponent, time and gym once scheduled): matchups are made for its copy in the League.
  const copy = (await db.query<{ id: string }>("select id::text from scenic_teams where org_team_id = $1", [t.id])).rows[0]?.id;
  const games = copy ? ((await scheduledGames(db, [copy]))[copy] ?? []) : [];
  const day = (d: string) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const roleName = (r: string) => COACH_ROLES.find((x) => x.key === r)?.name ?? r;
  const hasHead = t.coaches.some((c) => c.role === "HeadCoach");
  // Team chat (with Chat): the team's coaches and the Directors, opened right here (who can open it is checked again).
  const teamChat = (await hasFeature(db, slug, "chat")) && (canManage || t.coaches.some((c) => c.id === user.coachId));
  // Practices: its own-gym practices (a place the team found itself: any time and length, no limits).
  const ref = { org: slug, teamId: t.id };
  const own = await upcomingOwnPractices({ pool: db, now: () => new Date() }, ref, 12); // also for Next 7 days
  const canOwn = practicesOn && !user.actingBy && (await canChangeOwnPractices(db, user, ref));
  const published = games.filter((g) => g.published);

  return (
    <>
      <AppHeader user={user} context={`org:${slug}`} tab="org-teams" />
      <main className="mx-auto w-full max-w-3xl flex-1 space-y-4 px-4 py-6">
        <Link href={`/org/${slug}/teams`} className="text-sm text-zinc-500 hover:underline">
          ← Teams
        </Link>
        <section className={`${card} p-5`}>
          <div className="flex items-start gap-3">
            <span
              className={`flex size-12 shrink-0 items-center justify-center rounded-xl text-base font-bold text-white ${
                t.gender === "Boys" ? "bg-thunder-blue" : t.gender === "Coed" ? "bg-emerald-600" : "bg-pink-600"
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
                {t.gender} · {t.grade === "Pre-K" ? "Pre-K" : `${t.grade} grade`}
              </p>
              {who && <p className="mt-1 text-xs text-zinc-400">Created by {t.createdBy}</p>}
              {!hasHead && !t.waitingCoach && <MustBeEntered what="COACH INFO" />}
              {t.waitingCoach && <MustBeEntered what="COACH CELL" />}
              {(t.waitingCoach || t.coaches.some((c) => c.role === "HeadCoach" && !c.email)) && (
                <MustBeEntered what="COACH EMAIL" />
              )}
              {!t.players && <MustBeEntered what="ROSTER" />}
            </div>
          </div>
          {canManage && (
            <div className="mt-3">
              <AltNameButton org={slug} id={t.id} alt={t.altName} />
            </div>
          )}
        </section>

        <NextSevenDays
          games={published}
          practices={[]}
          own={own}
          now={new Date()}
          team={ref}
          staff={await takesAttendance(db, user, ref)}
          mine={[]}
          rsvps={{}}
        />

        <CollapseCard
          title="Staff"
          count={t.coaches.length}
          open={opened === "staff"}
          alert={!hasHead}
          actionPad="pr-56"
          action={
            <span className="flex items-center gap-1.5">
              <TextIcon cells={t.coaches.map((c) => c.cell)} label="Text coaches" />
              {teamChat && (
                <PanelIcon id={`chat-team-${t.id}`} label={`${t.name} team chat`}>
                  <ChatIcon />
                </PanelIcon>
              )}
              <EmailIcon emails={t.coaches.flatMap((c) => (c.email ? [c.email] : []))} label="Email coaches" />
              {canManage && <AddCoachButton org={slug} teamId={t.id} hasHead={hasHead} />}
            </span>
          }
        >
          <div className="px-4 pb-3">
            {teamChat && (
              <CardPanel id={`chat-team-${t.id}`} className="mb-3">
                <ChatPanel chatKey={orgKey(slug, `team-${t.id}`)} />
              </CardPanel>
            )}
            {!t.coaches.length && !t.waitingCoach && <p className="text-sm text-zinc-500">No coaches yet.</p>}
            {t.waitingCoach && (
              // Named without a cell yet (imported): adding it makes them the Head Coach.
              <div className="flex items-center justify-between gap-3 py-2.5">
                <span className="text-sm">
                  <span className="block font-medium">
                    {t.waitingCoach.first} {t.waitingCoach.last}
                  </span>
                  <span className="block text-xs text-zinc-500">Head Coach · no cell or email yet</span>
                </span>
                {canManage && (
                  <WaitingCoachButton org={slug} teamId={t.id} first={t.waitingCoach.first} last={t.waitingCoach.last} />
                )}
              </div>
            )}
            <ul className="divide-y divide-zinc-100 dark:divide-white/5">
              {t.coaches.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 py-2.5">
                  <span>
                    <span className="flex items-center gap-2 text-sm font-medium">
                      {c.name}
                      {who && !user.actingBy && c.id !== user.coachId && <ViewAsButton coachId={c.id} name={c.name} />}
                    </span>
                    <span className="block text-xs text-zinc-500">
                      {roleName(c.role)}
                      {who && ` · added by ${c.addedBy}`}
                    </span>
                    {c.role === "HeadCoach" && !c.email && (
                      <span className="mt-1 flex items-center gap-2">
                        <span className="text-xs font-semibold text-red-600 dark:text-red-400">No email yet</span>
                        {canManage && <HeadCoachEmailButton org={slug} teamId={t.id} name={c.name} />}
                      </span>
                    )}
                  </span>
                  {canManage && <RemoveCoachButton org={slug} teamId={t.id} coachId={c.id} name={c.name} />}
                </li>
              ))}
            </ul>
          </div>
        </CollapseCard>

        <CollapseCard
          title="Players"
          count={roster?.players.length ?? t.players}
          open={opened === "roster"}
          alert={!t.players}
          action={
            roster?.canManage && (
              <span className="flex items-center gap-1.5">
                <ImportPlayersButton org={slug} teamId={t.id} />
                <AddPlayerButton org={slug} teamId={t.id} />
              </span>
            )
          }
        >
          {roster && (
            <>
              {!roster.players.length && (
                <p className="px-4 pb-4 text-sm text-zinc-500">
                  {roster.canManage ? "No players yet. Tap the add icon (or import)." : "No players on the roster yet."}
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
                        {p.grade === 0 ? "K" : `Grade ${p.grade}`}
                        {who && ` · added by ${p.addedBy}`}
                      </span>
                    </span>
                    {roster.canManage && (
                      <RemovePlayerButton org={slug} teamId={t.id} playerId={p.id} name={`${p.first} ${p.last}`} />
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </CollapseCard>

        <CollapseCard title="Games" count={published.length} open={opened === "games"}>
          <div className="px-4 pb-4">
            {published.length ? (
              <ScheduleList games={published} practices={[]} today={today} />
            ) : (
              <p className="text-sm text-zinc-500">The game schedule shows here once it&apos;s published.</p>
            )}
          </div>
        </CollapseCard>

        {progs && (
          <CollapseCard title={`${progs.league} programs`} count={progs.programs.length} open={opened === "programs"}>
            <div className="px-4 pb-3">
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
                              Registered: {p.registered.where}
                              {who && ` · by ${p.registered.by}`}
                              {p.registered.paid ? " · Paid" : ""}
                            </p>
                            {p.registered.removedBy && (
                              <p className="font-semibold text-red-600 dark:text-red-400">
                                Taken out of this program{who && ` by ${p.registered.removedBy}`}
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
                                  off={
                                    who
                                      ? p.registered.off
                                      : Object.fromEntries(Object.keys(p.registered.off).map((k) => [k, "-"]))
                                  }
                                  teamOff={p.registered.teamOff}
                                  canChange={progs.canRegister}
                                  who={who}
                                />
                                <LeagueGames games={games.filter((g) => g.programId === p.id)} today={today} />
                              </div>
                            )}
                          </>
                        ) : p.status === "upcoming" ? (
                          <p className="text-zinc-500">Registration opens soon</p>
                        ) : p.recClosed ? (
                          <p className="text-zinc-500">REC here is only for organizations Scenic City picked</p>
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
            </div>
          </CollapseCard>
        )}

        {practicesOn && (
          <CollapseCard
            title="Practices"
            count={own.length}
            open={opened === "practices"}
            action={canOwn ? <BookPracticesButton teamId={t.id} /> : undefined}
          >
            {canOwn && (
              <BookPracticesPanel
                org={slug}
                teamId={t.id}
                choices={null}
                own={{ locations: await ownPracticeLocations({ pool: db }, ref), today }}
                scheduleHref={null}
              />
            )}
            <TeamPractices
              org={slug}
              teamId={t.id}
              booked={[]}
              own={own}
              canChange={canOwn}
              locations={[]}
              today={today}
              who={who}
              empty={canOwn ? "No practices yet. Tap the calendar to add one." : "No practices yet."}
              addHere={false}
            />
          </CollapseCard>
        )}
        {canManage && <DeleteTeamButton org={slug} id={t.id} name={t.name} />}
      </main>
    </>
  );
}

import { orgKey } from "@/lib/chat";
import { hasFeature } from "@/lib/features";
import { notFound, redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { seesWho } from "@/lib/org-admin";
import { db } from "@/lib/db";
import { teamPrograms } from "@/lib/org-leagues";
import { scheduledGames } from "@/lib/scenic-games";
import { LeagueGames, ScheduleList } from "../../../../LeagueGames";
import { getOrgTeam } from "@/lib/org-teams";
import AppHeader from "../../../../AppHeader";
import TeamPage, { type TeamStaffRow } from "../../../../TeamPage";
import { DateChips, ProgramButton, RegisterLeagueButton } from "../../../../leagues/LeagueButtons";
import { easternDate } from "@/lib/time";
import { HeadCoachEmailButton, StaffEdit, WaitingCoachButton } from "../../../../CoachContactTools";
import { listOrgRoster } from "@/lib/org-rosters";
import { AddPlayerButton, ImportPlayersButton, RemovePlayerButton } from "../RosterTools";
import { AddCoachButton, AltNameButton, DeleteTeamButton, RemoveCoachButton } from "../TeamTools";
import { followRename } from "@/lib/org-rename";
import { canChangeOwnPractices, ownPracticeLocations, ownPracticesOn, upcomingOwnPractices } from "@/lib/team-practices";
import TeamPractices from "../../../../TeamPractices";
import NextSevenDays from "../../../../NextSevenDays";
import { takesAttendance } from "@/lib/event-attendance";
import { listPlays, orgLibrary } from "@/lib/playbook";
import PlaybookCard from "../../../../PlaybookCard";
import { playbookPanel } from "@/lib/play-kinds";
import { AddIcon } from "../../../../CardIcons";
import { teamScrimmages } from "@/lib/scrimmages";
import { BookPracticesButton, BookPracticesPanel } from "../../../../BookPractices";

// One team of a registered organization, laid out like Thunder's team page: the team card, Next 7 days, then cards that
// open when tapped (Staff, Players, Games, its League programs, and Practices with CourtFacility), with their icons on
// the title line. ?tab=staff|roster|games|programs|practices opens that card. Admins and Directors of Teams change
// them; its coaches see them.
export async function OrgTeamView({
  slug,
  id,
  searchParams = Promise.resolve({}),
  embedded = false,
}: {
  slug: string;
  id: string;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
  embedded?: boolean; // inside its row on the Teams list: no header, no ← Teams
}) {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  if (!embedded) await followRename(slug, (s) => `/org/${s}/teams/${id}`);
  const found = await getOrgTeam({ pool: db, now: () => new Date() }, user, slug, id);
  if (!found) {
    if (embedded) return null;
    notFound();
  }
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
  const hasHead = t.coaches.some((c) => c.role === "HeadCoach");
  // Team chat (CourtPlayers): the team's coaches and the Directors, opened right here (who can open it is checked again).
  const teamChat = (await hasFeature(db, slug, "team-chat")) && (canManage || t.coaches.some((c) => c.id === user.coachId));
  // Practices: its own-gym practices (a place the team found itself: any time and length, no limits).
  const ref = { org: slug, teamId: t.id };
  const own = await upcomingOwnPractices({ pool: db, now: () => new Date() }, ref, 12); // also for Next 7 days
  const canOwn = practicesOn && (await canChangeOwnPractices(db, user, ref));
  const published = games.filter((g) => g.published);
  // Its scrimmages (another of the organization's teams, an outside team, or TBD), on Next 7 days and Games.
  const scrims = (await teamScrimmages({ pool: db, now: () => new Date() }, slug, [t.id]))[t.id] ?? [];
  // Its playbook (CourtPlaybook): its coaches and the Directors of Teams; null for anyone else.
  const plays = await listPlays({ pool: db, now: () => new Date() }, user, ref);
  const library = plays ? await orgLibrary({ pool: db, now: () => new Date() }, user, slug, t.id) : null; // to copy from

  const split = (name: string) => {
    const at = name.indexOf(" ");
    return at < 0 ? { first: name, last: "" } : { first: name.slice(0, at), last: name.slice(at + 1) };
  };
  const players = roster?.players ?? [];
  return (
    <>
      {!embedded && <AppHeader user={user} context={`org:${slug}`} tab="org-teams" />}
      <TeamPage
        embedded={embedded}
        back={canManage && !embedded ? `/org/${slug}?open=teams#teams` : null}
        opened={opened}
        team={{
          id: t.id,
          name: t.name,
          altName: t.altName,
          gender: t.gender,
          grades: t.grade === "Pre-K" ? "Pre-K" : `${t.grade} Grade`,
          level: t.level,
          practiceLocations: [],
          createdBy: who ? t.createdBy : null,
        }}
        musts={[
          ...(!hasHead && !t.waitingCoach ? (["COACH INFO"] as const) : []),
          ...(t.waitingCoach ? (["COACH CELL"] as const) : []),
          ...(t.waitingCoach || t.coaches.some((c) => c.role === "HeadCoach" && !c.email) ? (["COACH EMAIL"] as const) : []),
          ...(!t.players ? (["ROSTER"] as const) : []),
        ]}
        edit={
          canManage && (
            <div className="mt-3">
              <AltNameButton org={slug} id={t.id} alt={t.altName} />
            </div>
          )
        }
        next7={
          <NextSevenDays
            games={published}
            practices={[]}
            own={own}
            scrims={scrims}
            now={new Date()}
            team={ref}
            staff={await takesAttendance(db, user, ref)}
            mine={[]}
            rsvps={{}}
          />
        }
        staff={{
          list: t.coaches.map((c) => ({ coachId: c.id, ...split(c.name), role: c.role, cell: c.cell, email: c.email, addedBy: who ? c.addedBy : null })),
          waiting: t.waitingCoach && {
            ...t.waitingCoach,
            tool: canManage && <WaitingCoachButton org={slug} teamId={t.id} first={t.waitingCoach.first} last={t.waitingCoach.last} />,
          },
          chatKey: teamChat ? orgKey(slug, `team-${t.id}`) : null,
          add: canManage && <AddCoachButton org={slug} teamId={t.id} hasHead={hasHead} />,
          remove: (c: TeamStaffRow) => canManage && <RemoveCoachButton org={slug} teamId={t.id} coachId={c.coachId} name={`${c.first} ${c.last}`.trim()} />,
          headEmail: (c: TeamStaffRow) => canManage && <HeadCoachEmailButton org={slug} teamId={t.id} name={`${c.first} ${c.last}`.trim()} />,
          edit: (c: TeamStaffRow) => who && (
              <StaffEdit org={slug} teamId={t.id} coachId={c.coachId} role={c.role} first={c.first} last={c.last} cell={c.cell} email={c.email} />
            ),
          viewAs: who && !user.actingBy,
          me: user.coachId,
        }}
        roster={{
          rows: players.map((p) => ({
            key: p.id,
            number: p.jersey,
            first: p.first,
            last: p.last,
            right: p.grade === 0 ? "K" : `Grade ${p.grade}`,
            more: (
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-zinc-400">{who && `Added by ${p.addedBy}`}</span>
                {roster?.canManage && <RemovePlayerButton org={slug} teamId={t.id} playerId={p.id} name={`${p.first} ${p.last}`} />}
              </div>
            ),
          })),
          alert: !t.players,
          cells: [],
          emails: [],
          chatKey: null,
          add: roster?.canManage && (
            <>
              <ImportPlayersButton org={slug} teamId={t.id} />
              <AddPlayerButton org={slug} teamId={t.id} />
            </>
          ),
          empty: roster?.canManage ? "No players yet. Tap the add icon (or import)." : "No players on the roster yet.",
        }}
        gamesCount={published.length + scrims.length}
        games={
          published.length + scrims.length ? (
            <ScheduleList games={published} practices={[]} scrims={scrims} today={today} />
          ) : (
            <p className="text-sm text-zinc-500">The game schedule shows here once it&apos;s published.</p>
          )
        }
        programs={
          progs && {
            title: `${progs.league} programs`,
            count: progs.programs.length,
            body: (
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
            ),
          }
        }
        practices={
          practicesOn
            ? {
                count: own.length,
                action: canOwn ? <BookPracticesButton teamId={t.id} /> : undefined,
                body: (
                  <>
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
                  </>
                ),
              }
            : null
        }
        playbook={
          plays && {
            count: plays.length,
            action: <AddIcon id={playbookPanel(t.id)} label="Add a play" />,
            body: <PlaybookCard org={slug} teamId={t.id} plays={plays} library={library ?? []} />,
          }
        }
        footer={canManage && <DeleteTeamButton org={slug} id={t.id} name={t.name} />}
      />
    </>
  );
}

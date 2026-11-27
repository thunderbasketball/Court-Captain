import { wrongBirthdate } from "@/lib/roster-match";
import { teamCart } from "../../../../cart/teamCart";
import InCartNote from "../../../../cart/InCartNote";
import { inCarts } from "@/lib/cart";
import { HeaderOutline, TeamOutline } from "../../../../PageOutline";
import type { SessionUser } from "@/lib/auth/service";
import { Suspense } from "react";
import PaidNotice from "../../../../PaidNotice";
import { orgKey } from "@/lib/chat";
import { hasFeature } from "@/lib/features";
import { notFound, redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { seesWho } from "@/lib/org-admin";
import { db } from "@/lib/db";
import { teamPrograms } from "@/lib/org-leagues";
import { scheduledGames } from "@/lib/scenic-games";
import { currentContexts } from "@/lib/contexts-server";
import { leagueRosters } from "@/lib/roster-snapshot";
import { MissingNumbers, PlayerNumber } from "../../../../roster-numbers/RosterNumbers";
import LeagueRosterCards from "../../../../league-roster/LeagueRosterCards";
import { teamRequests } from "@/lib/schedule-requests";
import ScheduleRequests from "../../../../ScheduleRequests";
import { LeagueGames, ScheduleList } from "../../../../LeagueGames";
import { getOrgTeam } from "@/lib/org-teams";
import AppHeader from "../../../../AppHeader";
import TeamPage, { type TeamStaffRow } from "../../../../TeamPage";
import { DateChips, ProgramButton, RegisterLeagueButton } from "../../../../leagues/LeagueButtons";
import { easternDate } from "@/lib/time";
import { HeadCoachEmailButton, StaffEdit, WaitingCoachButton } from "../../../../CoachContactTools";
import { listOrgRoster } from "@/lib/org-rosters";
import { AddPlayerButton, ImportPlayersButton, PlayerBirthdate, PlayerInfo, RemovePlayerButton } from "../RosterTools";
import { AddCoachButton, AddCoachPanel, DeleteTeamButton, TeamEditButton, RemoveCoachButton, type StaffSpot } from "../TeamTools";
import { followRename } from "@/lib/org-rename";
import { canChangeOwnPractices, ownPracticeLocations, ownPracticesOn, upcomingOwnPractices } from "@/lib/team-practices";
import TeamPractices from "../../../../TeamPractices";
import HowPracticesWork from "../../../../HowPracticesWork";
import NextSevenDays from "../../../../NextSevenDays";
import { takesAttendance } from "@/lib/event-attendance";
import { listFormations, listPlays, orgLibrary } from "@/lib/playbook";
import PlaybookCard from "../../../../PlaybookCard";
import { playbookPanel } from "@/lib/play-kinds";
import { AddIcon } from "../../../../CardIcons";
import { teamScrimmages } from "@/lib/scrimmages";
import { BookPracticesButton, BookPracticesPanel } from "../../../../BookPractices";
import { deleteBlock } from "@/lib/schedule-removal";
import { RequestRemovalButton } from "../../../../ScheduleRemoval";

// One team of a registered organization, laid out like Thunder's team page: the team card, Next 10 days, then cards that
// open when tapped (Staff, Players, Games, its League programs, and Practices with CourtFacility), with their icons on
// the title line. ?tab=staff|roster|games|register|programs|practices opens that card. Admins and Directors of Teams change
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
  // Its team chip in the header when they're on its staff (like a Thunder team), else the organization's.
  const teamChip = `orgteam:${slug}:${found.team.id}`;
  const body = <TeamBody user={user} slug={slug} found={found} searchParams={searchParams} embedded={embedded} />;
  if (embedded) return body;
  const headerContext = (await currentContexts(user)).contexts.some((c) => c.key === teamChip) ? teamChip : `org:${slug}`;
  // Who may see it is settled above; the header and the team then each show as soon as they're ready.
  return (
    <>
      <Suspense fallback={<HeaderOutline />}>
        <AppHeader user={user} context={headerContext} tab="org-teams" />
      </Suspense>
      <Suspense fallback={<TeamOutline />}>{body}</Suspense>
    </>
  );
}

async function TeamBody({
  user,
  slug,
  found,
  searchParams,
  embedded,
}: {
  user: SessionUser;
  slug: string;
  found: NonNullable<Awaited<ReturnType<typeof getOrgTeam>>>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  embedded: boolean;
}) {
  const { team: t, canManage } = found;
  const deps = { pool: db, now: () => new Date() };
  const ref = { org: slug, teamId: t.id };
  // Everything below is read side by side (one after another made the page slow).
  // Its copy in the League (matchups and schedule requests are made for it), and its schedule requests (its coaches).
  const copyOf = db
    .query<{ id: string }>("select id::text from scenic_teams where org_team_id = $1", [t.id])
    .then((r) => r.rows[0]?.id ?? null);
  const requestsOf = copyOf.then((copy) => teamRequests(deps, user, copy));
  const [who, sp, practicesOn, roster, progs, games, chatOn, own, mayChangeOwn, scrimsByTeam, plays, staffTakes] = await Promise.all([
    seesWho(db, user, slug), // Owners and Admins see who did it
    searchParams,
    ownPracticesOn(db, slug), // Practices only with CourtFacility (own gym practices are part of it)
    listOrgRoster(deps, user, slug, t.id),
    teamPrograms(deps, user, slug, t.id),
    // Its League games (opponent, time and gym once scheduled): matchups are made for its copy in the League.
    copyOf.then(async (copy) => (copy ? ((await scheduledGames(db, [copy]))[copy] ?? []) : [])),
    hasFeature(db, slug, "team-chat"),
    upcomingOwnPractices(deps, ref, 12), // its own-gym practices (a place the team found itself), also for Next 10 days
    canChangeOwnPractices(db, user, ref),
    // Its scrimmages (another of the organization's teams, an outside team, or TBD), on Next 10 days and Games.
    teamScrimmages(deps, slug, [t.id]),
    // Its playbook (CourtPlaybook): its coaches and the Directors of Teams; null for anyone else.
    listPlays(deps, user, ref),
    takesAttendance(db, user, ref),
  ]);
  // Typed-in rosters (no CourtPlayers) ask each player's birthdate; with CourtPlayers it comes from registrations.
  const typedRoster = !(await hasFeature(db, slug, "player-registration"));
  const noNumber = typedRoster ? (roster?.players ?? []).filter((p) => !p.jersey) : []; // every player needs a uniform number
  const wrong = (p: { birthdate: string | null; grade: number }) => typedRoster && wrongBirthdate(p, easternDate(new Date())); // can't be right
  const wrongDates = (roster?.players ?? []).filter(wrong).length;
  const noBirthdate = typedRoster ? (roster?.players ?? []).filter((p) => !p.birthdate).length : 0;
  const asked = sp.tab;
  const opened = typeof asked === "string" ? asked : "";
  const today = easternDate(new Date());
  const day = (d: string) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const hasHead = t.coaches.some((c) => c.role === "HeadCoach");
  // The staff spots this person may fill or empty (checked again on the server), the same on every organization's teams.
  const myRoles = user.actingBy ? [] : t.coaches.filter((c) => c.id === user.coachId).map((c) => c.role);
  const spots: StaffSpot[] = canManage
    ? ["HeadCoach", "AsstCoach", "Manager", "TeamParent"]
    : myRoles.includes("HeadCoach")
      ? ["AsstCoach", "Manager", "TeamParent"]
      : myRoles.includes("AsstCoach")
        ? ["Manager", "TeamParent"]
        : [];
  // Team chat (CourtPlayers): the team's coaches and the Directors, opened right here (who can open it is checked again).
  const teamChat = chatOn && (canManage || t.coaches.some((c) => c.id === user.coachId));
  const canOwn = practicesOn && mayChangeOwn;
  // Whose cart it's in (not paid for yet): shown to whoever may register it or add dates.
  const carts = progs?.canRegister || progs?.canAddDates ? await inCarts(db, new Date(), user, { orgTeamId: t.id }) : [];
  const [copy, requests] = await Promise.all([copyOf, requestsOf]); // already loading beside the rest
  const leagueRosterList = await leagueRosters({ pool: db, now: () => new Date() }, user, copy); // locked at its 1st game in a League
  const schedule = requests && requests.length ? requests : null;
  const published = games.filter((g) => g.published);
  const scrims = scrimsByTeam[t.id] ?? [];
  const [library, formations, ownLocations] = await Promise.all([
    plays ? orgLibrary(deps, user, slug, t.id) : null, // to copy from
    plays ? listFormations(deps, user, ref) : null, // its own Base Formations
    canOwn ? ownPracticeLocations(deps, ref) : [],
  ]);

  const split = (name: string) => {
    const at = name.indexOf(" ");
    return at < 0 ? { first: name, last: "" } : { first: name.slice(0, at), last: name.slice(at + 1) };
  };
  const players = roster?.players ?? [];
  // Why it can't be deleted now (registered, or on an event's schedule), for Delete team and Current Registrations.
  const block = canManage ? await deleteBlock(db, "org", t.id, new Date()) : null;
  const onSchedule = block?.why === "scheduled" ? block : null;
  // Its programs: what it's registered for (the programs card), and the rest (the Register team card, under its name).
  const registeredIn = progs?.programs.filter((p) => p.registered) ?? [];
  const toRegister = progs?.programs.filter((p) => !p.registered) ?? [];
  const programRows = (list: NonNullable<typeof progs>["programs"]) => (
  <ul className="divide-y divide-zinc-100 dark:divide-white/5">
  {list.map((p) => (
    <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
      <div className="min-w-0 text-sm">
        <p className="font-semibold">
          {p.name} <span className="font-normal text-zinc-500">· {p.kind}</span>
        </p>
        <p className="text-zinc-500">
          {day(p.startsOn)}–{day(p.endsOn)}
          {p.feeCents !== null && ` · $${(p.feeCents / 100).toFixed(0)} fee`}
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
                {schedule ? (
                  <p className="text-xs text-zinc-500">
                    {p.entry.allSeason ? "ALL Season" : "Single Days"} · dates and sit-outs in Schedule requests below
                  </p>
                ) : (
                  <>
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
                  canChange={!!progs?.canRegister}
                  who={who}
                />
                  </>
                )}
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
        <InCartNote list={carts.filter((c) => c.programId === p.id)} />
      </div>
      {/* Directors and Admins register and withdraw; the team's coaches add dates (and a 2nd Game) once it's registered. */}
      {(progs?.canRegister || (progs?.canAddDates && p.registered && p.kind === "League")) && p.status === "open" && (p.registered || p.fits) && (
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
              paid={p.registered ? p.registered.paid : undefined}
              noCart={!p.registered && carts.some((c) => c.programId === p.id && !c.mine)}
            />
          )}
          {progs?.canRegister && (p.registered || p.kind !== "League") && !(p.registered && onSchedule?.programId === p.id) && (
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
      {/* On this event's schedule: no Withdraw; it asks the Scheduler to take it off (TBD in its games). */}
      {p.registered && onSchedule?.programId === p.id && progs?.canRegister && (
        <div className="w-full">
          <RequestRemovalButton programId={onSchedule.programId} teamId={onSchedule.teamId} requested={onSchedule.requested} />
        </div>
      )}
    </li>
  ))}
</ul>
  );
  return (
    <>
      <Suspense fallback={null}>
        <PaidNotice />
      </Suspense>
      <TeamPage
        org={slug}
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
          ...(noBirthdate ? (["PLAYER BIRTHDATES"] as const) : []),
          ...(wrongDates ? (["WRONG BIRTHDATES"] as const) : []),
          ...(noNumber.length ? (["PLAYER NUMBERS"] as const) : []),
        ]}
        edit={
          canManage && (
            <div className="mt-3">
              <TeamEditButton
                org={slug}
                id={t.id}
                team={{ gender: t.gender, grades: t.grades, level: t.level, altName: t.altName, changedBy: who ? t.changedBy : null }}
                remove={<DeleteTeamButton org={slug} id={t.id} name={t.name} block={block} />}
              />
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
            staff={staffTakes}
            mine={[]}
            rsvps={{}}
          />
        }
        staff={{
          list: t.coaches.map((c) => ({
            coachId: c.id,
            ...split(c.name),
            role: c.role,
            cell: c.cell,
            email: c.email,
            addedBy: who ? c.addedBy : null,
            verified: c.verified,
          })),
          waiting: t.waitingCoach && {
            ...t.waitingCoach,
            tool: canManage && <WaitingCoachButton org={slug} teamId={t.id} first={t.waitingCoach.first} last={t.waitingCoach.last} />,
          },
          chatKey: teamChat ? orgKey(slug, `team-${t.id}`) : null,
          add: spots.length > 0 && <AddCoachButton teamId={t.id} />,
          addPanel: spots.length > 0 && <AddCoachPanel org={slug} teamId={t.id} hasHead={hasHead} roles={spots} />,
          remove: (c: TeamStaffRow) => spots.some((x) => x === c.role) && <RemoveCoachButton org={slug} teamId={t.id} coachId={c.coachId} name={`${c.first} ${c.last}`.trim()} />,
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
            right: (
              <>
                {p.grade === 0 ? "K" : `Grade ${p.grade}`}
                {typedRoster && !p.jersey && <span className="font-semibold text-red-600 dark:text-red-400"> · no number</span>}
                {typedRoster && !p.birthdate && <span className="font-semibold text-red-600 dark:text-red-400"> · no birthdate</span>}
                {wrong(p) && <span className="font-semibold text-red-600 dark:text-red-400"> · check birthdate</span>}
              </>
            ),
            more: (
              <div className="space-y-2">
                {typedRoster && roster?.canManage && <PlayerInfo key={`${p.first} ${p.last} ${p.grade}`} org={slug} teamId={t.id} player={p} />}
                {typedRoster && roster?.canManage && <PlayerNumber key={p.jersey ?? ""} org={slug} teamId={t.id} id={p.id} number={p.jersey} />}
                {typedRoster && (
                  <PlayerBirthdate org={slug} teamId={t.id} playerId={p.id} birthdate={p.birthdate} grade={p.grade} canEdit={!!roster?.canManage} />
                )}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-zinc-400">
                    {who && `Added by ${p.addedBy}`}
                    {who && p.birthdateBy && ` · birthdate by ${p.birthdateBy}`}
                  </span>
                  {roster?.canRemove && <RemovePlayerButton org={slug} teamId={t.id} playerId={p.id} name={`${p.first} ${p.last}`} />}
                </div>
              </div>
            ),
          })),
          alert: !t.players || noBirthdate > 0 || wrongDates > 0 || noNumber.length > 0, // flashes until it has players, each with a birthdate and number
          note: typedRoster && (
            <MissingNumbers org={slug} teamId={t.id} players={noNumber} taken={players.flatMap((p) => (p.jersey ? [p.jersey] : []))} canEdit={!!roster?.canManage} />
          ),
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
        cart={embedded ? null : await teamCart(user, slug)}
        leagueRosters={
          copy && leagueRosterList.length
            ? {
                count: leagueRosterList.reduce((n, r) => n + r.players.filter((x) => !x.removedBy).length, 0),
                body: <LeagueRosterCards rosters={leagueRosterList} teamId={copy} who={who} />,
              }
            : null
        }
        gamesCount={published.length + scrims.length}
        games={
          <>
            {published.length + scrims.length ? (
            <ScheduleList games={published} practices={[]} scrims={scrims} today={today} />
          ) : (
            <p className="text-sm text-zinc-500">The game schedule shows here once it&apos;s published.</p>
          )}
          </>
        }
        register={
          // Register Team (under its name, above Current Registrations): programs it can still register for.
          progs?.canRegister && toRegister.length
            ? {
                title: "Register Team",
                count: toRegister.filter((p) => p.status === "open" && p.fits && !p.recClosed).length,
                body: <div className="px-4 pb-3">{programRows(toRegister)}</div>,
              }
            : null
        }
        programs={
          // Current Registrations: what it's registered in (division, Paid, its games), then its Schedule requests.
          registeredIn.length
            ? {
                title: "Current Registrations",
                count: registeredIn.length,
                body: (
                  <div className="space-y-3 px-4 pb-3">
                    {programRows(registeredIn)}
                    {schedule && copy && <ScheduleRequests teamId={copy} days={schedule} />}
                  </div>
                ),
              }
            : null
        }
        practices={
          practicesOn
            ? {
                count: own.length,
                action: canOwn ? <BookPracticesButton teamId={t.id} /> : undefined,
                body: (
                  <>
                    <div className="px-4 pb-3">
                      <HowPracticesWork gyms={false} own />
                    </div>
                    {canOwn && (
                      <BookPracticesPanel
                        org={slug}
                        teamId={t.id}
                        choices={null}
                        own={{ locations: ownLocations, today }}
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
            body: <PlaybookCard org={slug} teamId={t.id} plays={plays} library={library ?? []} formations={formations ?? []} />,
          }
        }
      />
    </>
  );
}

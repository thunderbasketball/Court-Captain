import { Suspense } from "react";
import { HeaderOutline, TeamOutline } from "../../../../PageOutline";
import type { SessionUser } from "@/lib/auth/service";
import { notFound, redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { hasFeature } from "@/lib/features";
import { HeadCoachEmailButton, StaffEdit, WaitingCoachButton } from "../../../../CoachContactTools";
import { requireFeature } from "@/lib/features-server";
import { db } from "@/lib/db";
import { gradesText } from "@/lib/event-names";
import { gradeLabel } from "@/lib/grades";
import { formatCell } from "@/lib/phone";
import { currentContexts } from "@/lib/contexts-server";
import { teamGymChoices, upcomingForTeam } from "@/lib/practice/schedule";
import { BookPracticesButton, BookPracticesPanel } from "../../../../BookPractices";
import { canChangeOwnPractices, ownPracticeLocations, upcomingOwnPractices } from "@/lib/team-practices";
import TeamPractices from "../../../../TeamPractices";
import HowPracticesWork from "../../../../HowPracticesWork";
import { canEvaluate, listEvaluations } from "@/lib/evaluations";
import { listRoster, rosterCandidates } from "@/lib/rosters";
import { parentSlots } from "@/lib/player-parents";
import PlayerParents from "../../players/PlayerParents";
import { canUnlockUniforms, listUniforms, uniformsMissing } from "@/lib/uniforms";
import { listFormations, listPlays, orgLibrary } from "@/lib/playbook";
import PlaybookCard from "../../../../PlaybookCard";
import { playbookPanel } from "@/lib/play-kinds";
import { AddIcon } from "../../../../CardIcons";
import { getTeam, personOptions, rosterParentOptions } from "@/lib/teams";
import EligibleChip, { bornLabel } from "../../../../EligibleChip";
import { rosterIssue, schoolYearOf } from "@/lib/eligibility";
import { orgGradeRules } from "@/lib/grade-rules";
import { ViewAsButton } from "../../../../ViewAsButton";
import { MAX_GROUP_TEXT } from "@/lib/group-text";
import AppHeader from "../../../../AppHeader";
import SubCard from "../../../../SubCard";
import { PracticeContent } from "../../practice/content";
import SharedTeamPage, { type TeamStaffRow } from "../../../../TeamPage";
import { Chip, EmailLink, PhoneLink } from "../../../../ui";
import AvailablePlayers from "./AvailablePlayers";
import UniformsBoard from "./UniformsBoard";
import HowUniformsWork from "../../uniforms/HowUniformsWork";
import { AddPlayersButton, RemovePlayerButton } from "./RosterTools";
import { scheduledGames } from "@/lib/scenic-games";
import { leagueRosters } from "@/lib/roster-snapshot";
import { leaguePrograms } from "@/lib/scenic-team-page";
import LeagueRosterCards from "../../../../league-roster/LeagueRosterCards";
import { teamRequests } from "@/lib/schedule-requests";
import LeagueRegistrations from "../../../../LeagueRegistrations";
import { easternDate } from "@/lib/time";
import { ScheduleList } from "../../../../LeagueGames";
import { teamScrimmages } from "@/lib/scrimmages";
import NextSevenDays from "../../../../NextSevenDays";
import { myPlayers, rsvpsFor, takesAttendance } from "@/lib/event-attendance";
import { AddStaffButton, AddStaffPanel, DeleteTeamButton, RemoveStaffButton, TeamEditForm } from "./TeamEditor";
import { hasArea, isThunderAdmin, seesWho } from "@/lib/org-admin";
import { deleteBlock } from "@/lib/schedule-removal";

// A Thunder team's page: on its own address, or (`embedded`) inside its row on the Teams list (no header, no ← Teams).
export async function ThunderTeamView({
  id,
  searchParams = Promise.resolve({}),
  embedded = false,
}: {
  id: string;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
  embedded?: boolean;
}) {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  if (embedded) {
    if (!(await hasFeature(db, "thunder", "team-building"))) return null;
  } else await requireFeature("thunder", "team-building");
  const deps = { pool: db, now: () => new Date() };
  const team = await getTeam(deps, user, id);
  if (!team) {
    if (embedded) return null;
    notFound();
  }
  // Shown as the role the person switched to: a team chip shows the team as that role sees it,
  // even for the Director; otherwise the Director sees everything.
  const { active } = await currentContexts(user);
  const asDirector = hasArea(user, "teams") && !(active?.key === `team:${team.id}` && team.myRoles.length > 0);
  const body = <TeamBody user={user} team={team} asDirector={asDirector} searchParams={searchParams} embedded={embedded} />;
  if (embedded) return body;
  // Who may see it is settled above; the header and the team then each show as soon as they're ready.
  return (
    <>
      <Suspense fallback={<HeaderOutline />}>
        <AppHeader user={user} tab="teams" context={asDirector ? "director" : `team:${team.id}`} />
      </Suspense>
      <Suspense fallback={<TeamOutline />}>{body}</Suspense>
    </>
  );
}

async function TeamBody({
  user,
  team,
  asDirector,
  searchParams,
  embedded,
}: {
  user: SessionUser;
  team: NonNullable<Awaited<ReturnType<typeof getTeam>>>;
  asDirector: boolean;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  embedded: boolean;
}) {
  const deps = { pool: db, now: () => new Date() };
  const canEditTeam = asDirector && team.canEditTeam;
  const canEditStaff = asDirector || team.myRoles.includes("HeadCoach") || team.myRoles.includes("AsstCoach"); // an assistant: Manager, Team Parent
  const ref = { org: "thunder" as const, teamId: team.id };
  const canBook = asDirector || team.myRoles.some((r) => r !== "TeamParent");
  // Its copy in the League (matchups and schedule requests are made for it), and its schedule requests (its coaches).
  const copyOf = db
    .query<{ id: string }>("select id::text from scenic_teams where thunder_team_id = $1", [team.id])
    .then((r) => r.rows[0]?.id ?? null);
  const requestsOf = copyOf.then((copy) => teamRequests(deps, user, copy));
  // Everything below is read side by side (one after another made the page slow); each piece is explained where it's used.
  const [
    options,
    practices,
    roster,
    candidates,
    mayEvaluate,
    { rules: gradeRules },
    who,
    games,
    own,
    scrimsByTeam,
    canOwn,
    myKids,
    [uniformsOn, chatOn],
    missingUniforms,
    plays,
    staffTakes,
    gymChoices,
    sp,
  ] = await Promise.all([
    // Only the Director picks from the full user and volunteer lists; a head coach adds people by cell number.
    asDirector ? personOptions(deps, user) : null,
    upcomingForTeam(deps, team.id),
    listRoster(deps, user, team.id),
    asDirector ? rosterCandidates(deps, user, team.id) : [],
    canEvaluate(db, user, team.id),
    orgGradeRules(db, "thunder", new Date()), // set in the organization's gear
    // Who did it (Created by, Added by, Rostered by, booked by) shows only to Owners and Admins.
    seesWho(db, user, "thunder"),
    // Its Scenic City League games (opponent, time and gym once scheduled): matchups are made for its copy there.
    copyOf.then(async (copy) => (copy ? ((await scheduledGames(db, [copy]))[copy] ?? []) : [])),
    // Its own-gym practices (a place the team found itself: any time and length, no limits), with the booked ones.
    upcomingOwnPractices(deps, ref, 12),
    // Its scrimmages (another Thunder team, an outside team, or TBD), on Next 10 days and Games.
    teamScrimmages(deps, "thunder", [team.id]),
    canChangeOwnPractices(db, user, ref),
    // Staff whose own children are on the team answer ✓ / ✗ for them in Next 10 days (as their parent).
    myPlayers(db, user, ref), // shown while viewing as them too (view only)
    Promise.all([hasFeature(db, "thunder", "uniforms"), hasFeature(db, "thunder", "chat")]),
    uniformsMissing(deps, team.id), // Uniforms: its title flashes red while anything is missing
    // Its playbook (CourtPlaybook): its coaches and the Directors of Teams; null for anyone else.
    listPlays(deps, user, ref),
    takesAttendance(db, user, ref),
    canBook ? teamGymChoices(deps, user, team.id) : null,
    searchParams,
  ]);
  const scrims = scrimsByTeam[team.id] ?? [];
  const players = roster ?? [];
  const schoolYear = schoolYearOf(easternDate(new Date())); // for each player's grade eligibility
  const issue = rosterIssue(team.grades, players, schoolYear, gradeRules); // "1 Too old": the Players card's title turns red
  // Every parent's cell and email once, for one group text or email to the team's families. A group text holds 19
  // numbers at most: more than that, one cell per player (the first parent with one); still more, it splits into texts.
  const allParentCells = [...new Set(players.flatMap((p) => p.parents.flatMap((g) => (g.cell ? [g.cell] : []))))];
  const onePerPlayer = allParentCells.length > MAX_GROUP_TEXT;
  const parentCells = onePerPlayer
    ? [...new Set(players.flatMap((p) => p.parents.flatMap((g) => (g.cell ? [g.cell] : [])).slice(0, 1)))]
    : allParentCells;
  const parentEmails = [...new Set(players.flatMap((p) => p.parents.flatMap((g) => (g.email ? [g.email.toLowerCase()] : []))))];
  const [copy, requests] = await Promise.all([copyOf, requestsOf]); // already loading beside the rest
  const leagueRosterList = await leagueRosters({ pool: db, now: () => new Date() }, user, copy); // locked at its 1st game in a League
  const regs = copy ? await leaguePrograms(db, copy) : []; // what it's registered in
  const published = games.filter((g) => g.published); // the Games card: only once its League's schedule is published
  // Owners and Admins: 👁 View as on the team's staff and on players' parents who have a login (matched by cell), even
  // while on the team's own chip; who they may view is checked again when they tap it.
  const admin = isThunderAdmin(user) && !user.actingBy;
  // One page: the team's card on top, then Staff, Players, Available players, Uniforms and Practices as cards that open
  // when tapped (no tabs). An old link with ?tab=roster (or uniforms, practices, staff) opens that card.
  const requested = sp.tab;
  const week = typeof sp.week === "string" ? sp.week : undefined; // the Full schedule's week
  const opened = typeof requested === "string" ? requested : "";
  // The second round: what needs the first (players, practices, plays, Uniforms on), again side by side.
  const [parentLogins, available, uniformsAndUnlock, library, formations, ownLocations, rsvps, parentOptions, parentsOf] = await Promise.all([
    admin
      ? db
          .query<{ cell: string; coach_id: string }>("select cell, coach_id from users where active and cell = any($1)", [allParentCells])
          .then((r): Record<string, string> => Object.fromEntries(r.rows.map((u) => [u.cell, u.coach_id])))
      : ({} as Record<string, string>),
    // Available players: still eligible (not on any team), for the coaches to star and evaluate.
    mayEvaluate
      ? listEvaluations(deps, user, team.id).then((l) => (l ?? []).filter((c) => c.registered && !c.rosteredOn.length))
      : null,
    uniformsOn ? Promise.all([listUniforms(deps, user, team.id), canUnlockUniforms(db, user, team.id)]) : null,
    plays ? orgLibrary(deps, user, "thunder", team.id) : null, // to copy from
    plays ? listFormations(deps, user, ref) : null, // its own Base Formations
    canOwn ? ownPracticeLocations(deps, ref) : [],
    rsvpsFor(
      db,
      ref,
      [
        ...practices.map((p) => ({ kind: "slot" as const, id: p.id })),
        ...own.map((p) => ({ kind: "own" as const, id: p.id })),
        ...published.map((g) => ({ kind: "game" as const, id: g.id })),
        ...scrims.map((x) => ({ kind: "scrimmage" as const, id: x.id })),
      ],
      myKids.map((p) => p.player),
    ),
    canEditStaff ? rosterParentOptions(deps, team.id) : [],
    // Its staff (any role) and the Directors add a player's missing parent.
    asDirector || team.myRoles.length ? parentSlots(db, user, players.map((p) => p.registrantId)) : null,
  ]);
  const [uniforms, canUnlock] = uniformsAndUnlock ?? [null, false];
  // Each player's uniform number (with Uniforms), shown before their name on the Roster.
  const number = new Map((uniforms ?? []).flatMap((u) => (u.number ? [[u.registrantId, u.number] as const] : [])));

  return (
    <>
      <SharedTeamPage
        embedded={embedded}
        back={asDirector && !embedded ? "/org/thunder?open=teams#teams" : null}
        opened={opened}
        team={{
          id: team.id,
          name: team.name,
          altName: team.altName,
          gender: team.gender,
          grades: gradesText(team.grades),
          level: team.level,
          practiceLocations: team.practiceLocations,
          createdBy: who ? team.createdBy : null,
        }}
        musts={[
          ...(!team.staff.some((x) => x.role === "HeadCoach") && !team.waitingCoach ? (["COACH INFO"] as const) : []),
          ...(team.waitingCoach ? (["COACH CELL"] as const) : []),
          ...(team.waitingCoach || team.staff.some((x) => x.role === "HeadCoach" && !x.email) ? (["COACH EMAIL"] as const) : []),
          ...(!players.length ? (["ROSTER"] as const) : []),
          ...(uniforms && players.some((p) => !number.get(p.registrantId)) ? (["PLAYER NUMBERS"] as const) : []),
        ]}
        edit={
          canEditTeam && (
            <TeamEditForm
              teamId={team.id}
              initial={{
                gender: team.gender,
                grades: team.grades,
                level: team.level,
                practiceLocations: team.practiceLocations.join(", "),
                altName: team.altName ?? "",
              }}
            />
          )
        }
        next7={
          <NextSevenDays
            games={published}
            practices={practices}
            own={own}
            scrims={scrims}
            now={new Date()}
            team={{ org: "thunder", teamId: team.id }}
            staff={staffTakes}
            mine={myKids}
            rsvps={rsvps}
          />
        }
        staff={{
          list: team.staff.map((s) => ({
            coachId: s.coachId,
            first: s.firstName,
            last: s.lastName,
            role: s.role,
            cell: s.cell,
            email: s.email,
            addedBy: who ? s.addedBy : null,
            verified: s.verified,
          })),
          waiting: team.waitingCoach && {
            ...team.waitingCoach,
            tool: asDirector && <WaitingCoachButton org="thunder" teamId={team.id} first={team.waitingCoach.first} last={team.waitingCoach.last} />,
          },
          chatKey: chatOn ? `team-${team.id}` : null,
          add: canEditStaff && <AddStaffButton teamId={team.id} canSetHead={asDirector} filledRoles={team.staff.map((s) => s.role)} />,
          addPanel: canEditStaff && (
            <AddStaffPanel
              teamId={team.id}
              gender={team.gender}
              grades={team.grades}
              canSetHead={asDirector}
              filledRoles={team.staff.map((s) => s.role)}
              users={options?.users ?? []}
              volunteers={options?.volunteers ?? []}
              parents={parentOptions}
            />
          ),
          remove: (s: TeamStaffRow) =>
            canEditStaff &&
            (asDirector || team.myRoles.includes("HeadCoach") || s.role === "Manager" || s.role === "TeamParent") &&
            (s.role !== "HeadCoach" || asDirector) && (
              <RemoveStaffButton teamId={team.id} coachId={s.coachId} role={s.role as never} label={`${s.first} ${s.last}`} />
            ),
          headEmail: (s: TeamStaffRow) => asDirector && <HeadCoachEmailButton org="thunder" teamId={team.id} name={`${s.first} ${s.last}`} />,
          edit: (s: TeamStaffRow) =>
            (who || isThunderAdmin(user)) && (
              <StaffEdit org="thunder" teamId={team.id} coachId={s.coachId} role={s.role} first={s.first} last={s.last} cell={s.cell} email={s.email} />
            ),
          viewAs: admin,
          me: user.coachId,
        }}
        roster={{
          rows: players.map((p) => ({
            key: p.registrantId,
            number: number.get(p.registrantId),
            first: p.firstName,
            last: p.lastName,
            chips: <EligibleChip teamGrades={team.grades} grade={p.grade} birthdate={p.birthdate} year={schoolYear} rules={gradeRules} />,
            right: (
              <>
                {uniforms && !number.get(p.registrantId) && <span className="font-semibold text-red-600 dark:text-red-400">no number · </span>}
                {gradeLabel(p.grade)}
                {bornLabel(p.birthdate)}
                {!p.registered && <span className="text-amber-700 dark:text-amber-400"> · not registered</span>}
              </>
            ),
            more: (
              <>
                {p.parents.map((g, i) => (
                  <span key={i} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                    <span className="text-zinc-600 dark:text-zinc-300">{g.name}</span>
                    {g.cell && parentLogins[g.cell] && parentLogins[g.cell] !== user.coachId && (
                      <ViewAsButton coachId={parentLogins[g.cell]} name={g.name} />
                    )}
                    {g.cell && <PhoneLink cell={g.cell} label={formatCell(g.cell)} />}
                    {g.email && <EmailLink email={g.email} />}
                    {!g.cell && !g.email && <span className="text-zinc-400">no cell or email</span>}
                  </span>
                ))}
                {p.registered && !p.parents.length && <span className="block text-xs text-zinc-400">No parent contact in registration</span>}
                {p.registered && <PlayerParents registrantId={p.registrantId} slots={parentsOf?.get(p.registrantId) ?? []} who={who} />}
                {!p.registered && <span className="block text-xs text-amber-700 dark:text-amber-400">No longer in registrations</span>}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-zinc-400">{who && `Rostered by ${p.rosteredBy}`}</span>
                  {asDirector && <RemovePlayerButton teamId={team.id} registrantId={p.registrantId} name={`${p.firstName} ${p.lastName}`} />}
                </div>
              </>
            ),
          })),
          alert: !players.length || !!issue || (!!uniforms && players.some((p) => !number.get(p.registrantId))),
          badge: issue && <Chip tone="red">{issue}</Chip>,
          cells: parentCells,
          emails: parentEmails,
          chatKey: chatOn ? `parents-${team.id}` : null,
          add: asDirector && <AddPlayersButton teamId={team.id} teamName={team.name} candidates={candidates} canSecond={hasArea(user, "players")} />,
          note: (
            <>
              {/* Every player needs a uniform number: set (or fixed) on this team's Uniforms card. */}
              {uniforms && players.some((p) => !number.get(p.registrantId)) && (
                <p className="mx-4 mb-3 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700 ring-1 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30">
                  {players.filter((p) => !number.get(p.registrantId)).length} without a uniform number: enter them in this team&apos;s Uniforms card below.
                </p>
              )}
              {onePerPlayer && (
            <p className="px-4 pb-3 text-xs text-zinc-500">
              💬 Text parents goes to one parent per player: a group text holds {MAX_GROUP_TEXT} numbers at most.
            </p>
              )}
            </>
          ),
          empty: asDirector ? "No players yet. Tap “+ Add players”." : "No players on the roster yet.",
          // Players still available (eligible, not on any team), for its coaches: ☆/★ interest and Evaluate.
          after: available && available.length > 0 && (
            <div className="border-t border-zinc-100 pt-3 dark:border-white/5">
              <div className="px-4 pb-3">
                <h3 className="font-semibold">Available players ({available.length})</h3>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  {team.gender} in {gradesText(team.grades)} and one grade below, not on a team yet. ★ marks your interest; only {team.name}
                  &apos;s coaches and the Director see your ratings.
                </p>
              </div>
              <AvailablePlayers teamId={team.id} teamName={team.name} cards={available} />
            </div>
          ),
        }}
        leagueRosters={
          copy && leagueRosterList.length
            ? {
                count: leagueRosterList.reduce((n, r) => n + r.players.filter((x) => !x.removedBy).length, 0),
                body: <LeagueRosterCards rosters={leagueRosterList} teamId={copy} who={who} />,
              }
            : null
        }
        programs={
          copy && regs.length
            ? {
                title: "Current Registrations",
                count: regs.length,
                body: (
                  // CourtPlayers: registrations are its Directors' (Add dates, a 2nd Game); its coaches make schedule requests.
                  <LeagueRegistrations user={user} teamId={copy} programs={regs} games={games} requests={requests} canAdd={asDirector} today={easternDate(new Date())} />
                ),
              }
            : null
        }
        gamesCount={published.length + scrims.length}
        games={
          <>
            {published.length + scrims.length ? (
            <ScheduleList games={published} practices={[]} scrims={scrims} today={easternDate(new Date())} />
          ) : (
            <p className="text-sm text-zinc-500">The game schedule shows here once it&apos;s published.</p>
          )}
          </>
        }
        uniforms={
          uniforms && {
            count: uniforms.length,
            alert: missingUniforms > 0,
            body: (
              <>
                <div className="px-4 pb-3">
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    A number for every player (unique on the team), and a size for players who ordered a uniform.
                    {uniforms.some((u) => u.late) && " ✱ Uniform added after registration."}
                  </p>
                  <div className="mt-2">
                    <HowUniformsWork />
                  </div>
                </div>
                <UniformsBoard teamId={team.id} rows={who ? uniforms : uniforms.map((r) => ({ ...r, updatedBy: null }))} who={who} canUnlock={canUnlock} />
              </>
            ),
          }
        }
        practices={{
          count: practices.length + own.length,
          action: canBook ? <BookPracticesButton teamId={team.id} /> : undefined,
          body: (
            <>
              <div className="px-4 pb-3">
                <HowPracticesWork gyms own={canOwn} />
              </div>
              {canBook && (
                <BookPracticesPanel
                  org="thunder"
                  teamId={team.id}
                  choices={gymChoices}
                  own={canOwn ? { locations: ownLocations, today: easternDate(new Date()) } : null}
                  scheduleHref={null}
                />
              )}
              <TeamPractices
                org="thunder"
                teamId={team.id}
                booked={practices}
                own={own}
                canChange={canOwn}
                canCancel={canBook}
                locations={ownLocations}
                today={easternDate(new Date())}
                who={who}
                empty="No practices yet."
                addHere={!canBook}
              />
              {/* The week's whole schedule at the team's gyms (every team's practices and open times), right here. */}
              <div className="px-4 pb-4">
                <SubCard title="Full schedule" open={!!week}>
                  <PracticeContent
                    embedded
                    searchParams={Promise.resolve({ team: team.id, ...(week ? { week } : {}) })}
                    weekHref={(w) => `/org/thunder/teams/${team.id}?tab=practices&week=${w}`}
                  />
                </SubCard>
              </div>
            </>
          ),
        }}
        playbook={
          plays && {
            count: plays.length,
            action: <AddIcon id={playbookPanel(team.id)} label="Add a play" />,
            body: <PlaybookCard org={"thunder"} teamId={team.id} plays={plays} library={library ?? []} formations={formations ?? []} />,
          }
        }
        footer={
          canEditTeam && (
            <DeleteTeamButton
              teamId={team.id}
              name={team.name}
              players={roster?.length ?? 0}
              practices={practices.length}
              block={await deleteBlock(db, "thunder", String(team.id), new Date())}
            />
          )
        }
      />
    </>
  );
}

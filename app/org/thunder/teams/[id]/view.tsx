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
import { canEvaluate, listEvaluations } from "@/lib/evaluations";
import { listRoster, rosterCandidates } from "@/lib/rosters";
import { listUniforms, uniformsMissing } from "@/lib/uniforms";
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
import { AddPlayersButton, RemovePlayerButton } from "./RosterTools";
import { scheduledGames } from "@/lib/scenic-games";
import { easternDate } from "@/lib/time";
import { ScheduleList } from "../../../../LeagueGames";
import { teamScrimmages } from "@/lib/scrimmages";
import NextSevenDays from "../../../../NextSevenDays";
import { myPlayers, rsvpsFor, takesAttendance } from "@/lib/event-attendance";
import { AddStaffButton, AddStaffPanel, DeleteTeamButton, RemoveStaffButton, TeamEditForm } from "./TeamEditor";
import { hasArea, isThunderAdmin, seesWho } from "@/lib/org-admin";

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
  const canEditTeam = asDirector && team.canEditTeam;
  const canEditStaff = asDirector || team.myRoles.includes("HeadCoach");
  // Only the Director picks from the full user and volunteer lists; a head coach adds people by cell number.
  const options = asDirector ? await personOptions(deps, user) : null;
  const [practices, roster, candidates, mayEvaluate] = await Promise.all([
    upcomingForTeam(deps, team.id),
    listRoster(deps, user, team.id),
    asDirector ? rosterCandidates(deps, user, team.id) : [],
    canEvaluate(db, user, team.id),
  ]);
  const players = roster ?? [];
  const schoolYear = schoolYearOf(easternDate(new Date())); // for each player's grade eligibility
  const { rules: gradeRules } = await orgGradeRules(db, "thunder", new Date()); // set in the organization's gear
  const issue = rosterIssue(team.grades, players, schoolYear, gradeRules); // "1 Too old": the Players card's title turns red
  // Who did it (Created by, Added by, Rostered by, booked by) shows only to Owners and Admins.
  const who = await seesWho(db, user, "thunder");
  // Every parent's cell and email once, for one group text or email to the team's families. A group text holds 19
  // numbers at most: more than that, one cell per player (the first parent with one); still more, it splits into texts.
  const allParentCells = [...new Set(players.flatMap((p) => p.parents.flatMap((g) => (g.cell ? [g.cell] : []))))];
  const onePerPlayer = allParentCells.length > MAX_GROUP_TEXT;
  const parentCells = onePerPlayer
    ? [...new Set(players.flatMap((p) => p.parents.flatMap((g) => (g.cell ? [g.cell] : [])).slice(0, 1)))]
    : allParentCells;
  const parentEmails = [...new Set(players.flatMap((p) => p.parents.flatMap((g) => (g.email ? [g.email.toLowerCase()] : []))))];
  // Its Scenic City League games (opponent, time and gym once scheduled): matchups are made for its copy there.
  const copy = (await db.query<{ id: string }>("select id::text from scenic_teams where thunder_team_id = $1", [team.id])).rows[0]
    ?.id;
  const games = copy ? ((await scheduledGames(db, [copy]))[copy] ?? []) : [];
  const published = games.filter((g) => g.published); // the Games card: only once its League's schedule is published
  const canBook = asDirector || team.myRoles.some((r) => r !== "TeamParent");
  // Owners and Admins: 👁 View as on the team's staff and on players' parents who have a login (matched by cell), even
  // while on the team's own chip; who they may view is checked again when they tap it.
  const admin = isThunderAdmin(user) && !user.actingBy;
  const parentLogins: Record<string, string> = admin
    ? Object.fromEntries(
        (
          await db.query<{ cell: string; coach_id: string }>("select cell, coach_id from users where active and cell = any($1)", [
            allParentCells,
          ])
        ).rows.map((u) => [u.cell, u.coach_id]),
      )
    : {};
  // Its own-gym practices (a place the team found itself: any time and length, no limits), with the booked ones.
  const own = await upcomingOwnPractices(deps, { org: "thunder", teamId: team.id }, 12);
  // Its scrimmages (another Thunder team, an outside team, or TBD), on Next 7 days and Games.
  const scrims = (await teamScrimmages({ pool: db, now: () => new Date() }, "thunder", [team.id]))[team.id] ?? [];
  const canOwn = await canChangeOwnPractices(db, user, { org: "thunder", teamId: team.id });
  // Staff whose own children are on the team answer ✓ / ✗ for them in Next 7 days (as their parent).
  const myKids = await myPlayers(db, user, { org: "thunder", teamId: team.id }); // shown while viewing as them too (view only)
  // One page: the team's card on top, then Staff, Players, Available players, Uniforms and Practices as cards that open
  // when tapped (no tabs). An old link with ?tab=roster (or uniforms, practices, staff) opens that card.
  const sp = await searchParams;
  const requested = sp.tab;
  const week = typeof sp.week === "string" ? sp.week : undefined; // the Full schedule's week
  const opened = typeof requested === "string" ? requested : "";
  // Available players: still eligible (not on any team), for the coaches to star and evaluate.
  const available = mayEvaluate
    ? ((await listEvaluations(deps, user, team.id)) ?? []).filter((c) => c.registered && !c.rosteredOn.length)
    : null;
  // Uniforms: its title flashes red while anything is missing.
  const [uniformsOn, chatOn] = await Promise.all([hasFeature(db, "thunder", "uniforms"), hasFeature(db, "thunder", "chat")]);
  const [uniforms, missingUniforms] = await Promise.all([
    uniformsOn ? listUniforms(deps, user, team.id) : null,
    uniformsMissing(deps, team.id),
  ]);
  // Its playbook (CourtPlaybook): its coaches and the Directors of Teams; null for anyone else.
  const plays = await listPlays(deps, user, { org: "thunder", teamId: team.id });
  const library = plays ? await orgLibrary(deps, user, "thunder", team.id) : null; // to copy from
  const formations = plays ? await listFormations(deps, user, { org: "thunder", teamId: team.id }) : null; // its own Base Formations
  // Each player's uniform number (with Uniforms), shown before their name on the Roster.
  const number = new Map((uniforms ?? []).flatMap((u) => (u.number ? [[u.registrantId, u.number] as const] : [])));

  return (
    <>
      {!embedded && <AppHeader user={user} tab="teams" context={asDirector ? "director" : `team:${team.id}`} />}
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
            staff={await takesAttendance(db, user, { org: "thunder", teamId: team.id })}
            mine={myKids}
            rsvps={await rsvpsFor(
              db,
              { org: "thunder", teamId: team.id },
              [
                ...practices.map((p) => ({ kind: "slot" as const, id: p.id })),
                ...own.map((p) => ({ kind: "own" as const, id: p.id })),
                ...published.map((g) => ({ kind: "game" as const, id: g.id })),
                ...scrims.map((x) => ({ kind: "scrimmage" as const, id: x.id })),
              ],
              myKids.map((p) => p.player),
            )}
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
              parents={await rosterParentOptions(deps, team.id)}
            />
          ),
          remove: (s: TeamStaffRow) =>
            canEditStaff &&
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
                {!p.registered && <span className="block text-xs text-amber-700 dark:text-amber-400">No longer in registrations</span>}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-zinc-400">{who && `Rostered by ${p.rosteredBy}`}</span>
                  {asDirector && <RemovePlayerButton teamId={team.id} registrantId={p.registrantId} name={`${p.firstName} ${p.lastName}`} />}
                </div>
              </>
            ),
          })),
          alert: !players.length || !!issue,
          badge: issue && <Chip tone="red">{issue}</Chip>,
          cells: parentCells,
          emails: parentEmails,
          chatKey: chatOn ? `parents-${team.id}` : null,
          add: asDirector && <AddPlayersButton teamId={team.id} teamName={team.name} candidates={candidates} canSecond={hasArea(user, "players")} />,
          note: onePerPlayer && (
            <p className="px-4 pb-3 text-xs text-zinc-500">
              💬 Text parents goes to one parent per player: a group text holds {MAX_GROUP_TEXT} numbers at most.
            </p>
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
        gamesCount={published.length + scrims.length}
        games={
          published.length + scrims.length ? (
            <ScheduleList games={published} practices={[]} scrims={scrims} today={easternDate(new Date())} />
          ) : (
            <p className="text-sm text-zinc-500">The game schedule shows here once it&apos;s published.</p>
          )
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
                </div>
                <UniformsBoard teamId={team.id} rows={who ? uniforms : uniforms.map((r) => ({ ...r, updatedBy: null }))} who={who} />
              </>
            ),
          }
        }
        practices={{
          count: practices.length + own.length,
          action: canBook ? <BookPracticesButton teamId={team.id} /> : undefined,
          body: (
            <>
              {canBook && (
                <BookPracticesPanel
                  org="thunder"
                  teamId={team.id}
                  choices={await teamGymChoices(deps, user, team.id)}
                  own={canOwn ? { locations: await ownPracticeLocations(deps, { org: "thunder", teamId: team.id }), today: easternDate(new Date()) } : null}
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
                locations={canOwn ? await ownPracticeLocations(deps, { org: "thunder", teamId: team.id }) : []}
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
        footer={canEditTeam && <DeleteTeamButton teamId={team.id} name={team.name} players={roster?.length ?? 0} practices={practices.length} />}
      />
    </>
  );
}

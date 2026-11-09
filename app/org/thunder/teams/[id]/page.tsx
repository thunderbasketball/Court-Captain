import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { hasFeature } from "@/lib/features";
import { MustBeEntered } from "../../../../TeamRow";
import { HeadCoachEmailButton, WaitingCoachButton } from "../../../../CoachContactTools";
import { requireFeature } from "@/lib/features-server";
import { db } from "@/lib/db";
import { gradesText } from "@/lib/event-names";
import { gradeLabel } from "@/lib/grades";
import { formatCell } from "@/lib/phone";
import { currentContexts } from "@/lib/contexts-server";
import { upcomingForTeam } from "@/lib/practice/schedule";
import { canEvaluate, listEvaluations } from "@/lib/evaluations";
import { listRoster, rosterCandidates } from "@/lib/rosters";
import { listUniforms, uniformsMissing } from "@/lib/uniforms";
import { TZ } from "@/lib/time";
import { getTeam, personOptions, roleLabel } from "@/lib/teams";
import RosterPlayerRow from "../RosterPlayerRow";
import { ViewAsButton } from "../../../../ViewAsButton";
import { GroupTextButton } from "../../../../Contacts";
import ChatPopup from "../../../../ChatPopup";
import { MAX_GROUP_TEXT } from "@/lib/group-text";
import AppHeader from "../../../../AppHeader";
import { Chip, CollapseCard, EmailLink, PersonRow, PhoneLink, card } from "../../../../ui";
import AvailablePlayers from "./AvailablePlayers";
import UniformsBoard from "./UniformsBoard";
import { AddPlayersButton, RemovePlayerButton } from "./RosterTools";
import { scheduledGames } from "@/lib/scenic-games";
import { easternDate } from "@/lib/time";
import { ScheduleList } from "../../../../LeagueGames";
import { AddStaffButton, DeleteTeamButton, RemoveStaffButton, TeamEditForm } from "./TeamEditor";
import { hasArea, isThunderAdmin, seesWho } from "@/lib/org-admin";

export default function TeamPage({ params, searchParams }: PageProps<"/org/thunder/teams/[id]">) {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <Team params={params} searchParams={searchParams} />
    </Suspense>
  );
}

const roleTone = { HeadCoach: "green", AsstCoach: "amber", Manager: "blue", TeamParent: "zinc" } as const;

async function Team({
  params,
  searchParams,
}: {
  params: PageProps<"/org/thunder/teams/[id]">["params"];
  searchParams: PageProps<"/org/thunder/teams/[id]">["searchParams"];
}) {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  await requireFeature("thunder", "team-building");
  const { id } = await params;
  const deps = { pool: db, now: () => new Date() };
  const team = await getTeam(deps, user, id);
  if (!team) notFound();
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
  // One page: the team's card on top, then Staff, Players, Available players, Uniforms and Practices as cards that open
  // when tapped (no tabs). An old link with ?tab=roster (or uniforms, practices, staff) opens that card.
  const requested = (await searchParams).tab;
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

  return (
    <>
      <AppHeader user={user} tab="teams" context={asDirector ? "director" : `team:${team.id}`} />
      <main className="mx-auto w-full max-w-xl flex-1 space-y-4 px-4 py-6">
        {asDirector && (
          <Link href="/org/thunder/teams" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
            ← Teams
          </Link>
        )}
        <section className={`${card} p-5`}>
          <div className="flex items-start gap-3">
            <span
              className={`flex size-12 shrink-0 items-center justify-center rounded-xl text-base font-bold text-white ${
                team.gender === "Boys" ? "bg-thunder-blue" : "bg-pink-600"
              }`}
            >
              {team.name.split(" ")[0]}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <h1 className="text-2xl font-semibold tracking-tight">
                  {team.name}
                  {team.altName && <span className="font-normal text-zinc-500"> · {team.altName}</span>}
                </h1>
                <Chip tone={team.level === "COMP" ? "orange" : "zinc"}>{team.level}</Chip>
              </div>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                {team.gender} · {gradesText(team.grades)}
              </p>
              {team.practiceLocations.length > 0 && (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">Practices: {team.practiceLocations.join(", ")}</p>
              )}
              {who && <p className="mt-1 text-xs text-zinc-400">Created by {team.createdBy}</p>}
              {!team.staff.some((x) => x.role === "HeadCoach") && !team.waitingCoach && <MustBeEntered what="COACH INFO" />}
              {team.waitingCoach && <MustBeEntered what="COACH CELL" />}
              {(team.waitingCoach || team.staff.some((x) => x.role === "HeadCoach" && !x.email)) && (
                <MustBeEntered what="COACH EMAIL" />
              )}
              {!players.length && <MustBeEntered what="ROSTER" />}
            </div>
          </div>
          {/* Team chat (the team's staff + Directors; who may open it is checked in lib/chat), and text the team's
              parents from here too (the Roster tab has it with Email parents). */}
          {(chatOn || parentCells.length > 0) && (
            <div className="mt-3 flex flex-wrap gap-2 sm:pl-16">
              {chatOn && (
                <ChatPopup
                  chatKey={`team-${team.id}`}
                  label={`${team.name} team chat`}
                  className="shrink-0 rounded-full px-4 py-2 text-sm font-semibold text-thunder-blue ring-1 ring-thunder-blue/30 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-500/10"
                >
                  🗨️ Team chat
                </ChatPopup>
              )}
              {parentCells.length > 0 && <GroupTextButton cells={parentCells} label="Text parents" />}
              {onePerPlayer && (
                <p className="w-full text-xs text-zinc-500">
                  One parent per player: a group text holds {MAX_GROUP_TEXT} numbers at most.
                </p>
              )}
            </div>
          )}
          {canEditTeam && (
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
          )}
        </section>
        <CollapseCard
          title="Staff"
          count={team.staff.length}
          open={opened === "staff"}
          alert={!team.staff.some((x) => x.role === "HeadCoach")}
          action={
            canEditStaff && (
              <AddStaffButton
                teamId={team.id}
                gender={team.gender}
                grades={team.grades}
                canSetHead={asDirector}
                filledRoles={team.staff.map((s) => s.role)}
                users={options?.users ?? []}
                volunteers={options?.volunteers ?? []}
              />
            )
          }
        >
          {!team.staff.length && !team.waitingCoach && <p className="px-4 pb-4 text-sm text-zinc-500">No staff yet.</p>}
          {team.waitingCoach && (
            // Named without a cell yet (imported): the Director adds it, which makes them the Head Coach.
            <div className="flex items-center justify-between gap-3 border-t border-zinc-100 px-4 py-3 dark:border-white/5">
              <span className="min-w-0 text-sm">
                <span className="block font-medium">
                  {team.waitingCoach.first} {team.waitingCoach.last}
                </span>
                <span className="block text-xs text-zinc-500">Head Coach · no cell or email yet</span>
              </span>
              {asDirector && (
                <WaitingCoachButton
                  org="thunder"
                  teamId={team.id}
                  first={team.waitingCoach.first}
                  last={team.waitingCoach.last}
                />
              )}
            </div>
          )}
          <ul className="divide-y divide-zinc-100 border-t border-zinc-100 dark:divide-white/5 dark:border-white/5">
            {team.staff.map((s) => (
              <PersonRow
                key={`${s.coachId}-${s.role}`}
                first={s.firstName}
                last={s.lastName}
                avatarTone={roleTone[s.role]}
                href={
                  asDirector && isThunderAdmin(user) ? (s.coachId === user.coachId ? "/me" : `/me/${s.coachId}`) : undefined
                }
                collapsed
                chips={
                  <>
                    <Chip tone={roleTone[s.role]}>{roleLabel(s.role)}</Chip>
                    {asDirector && isThunderAdmin(user) && s.coachId !== user.coachId && (
                      <ViewAsButton coachId={s.coachId} name={`${s.firstName} ${s.lastName}`} />
                    )}
                  </>
                }
              >
                <p>
                  <PhoneLink cell={s.cell} label={formatCell(s.cell)} />
                </p>
                {s.email ? (
                  <p className="truncate">
                    <EmailLink email={s.email} />
                  </p>
                ) : (
                  s.role === "HeadCoach" && (
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-semibold text-red-600 dark:text-red-400">No email yet</p>
                      {asDirector && (
                        <HeadCoachEmailButton org="thunder" teamId={team.id} name={`${s.firstName} ${s.lastName}`} />
                      )}
                    </div>
                  )
                )}
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs">{who && `Added by ${s.addedBy}`}</p>
                  {canEditStaff && (s.role !== "HeadCoach" || asDirector) && (
                    <RemoveStaffButton
                      teamId={team.id}
                      coachId={s.coachId}
                      role={s.role}
                      label={`${s.firstName} ${s.lastName}`}
                    />
                  )}
                </div>
              </PersonRow>
            ))}
          </ul>
        </CollapseCard>
        <CollapseCard
          title="Players"
          count={players.length}
          open={opened === "roster"}
          alert={!players.length}
          action={
            asDirector && (
              <AddPlayersButton
                teamId={team.id}
                teamName={team.name}
                candidates={candidates}
                canSecond={hasArea(user, "players")}
              />
            )
          }
        >
          {parentCells.length + parentEmails.length > 0 && (
            <div className="flex flex-wrap gap-2 px-4 pb-3">
              <GroupTextButton cells={parentCells} label="Text parents" />
              {onePerPlayer && (
                <p className="w-full text-xs text-zinc-500">
                  One parent per player: a group text holds {MAX_GROUP_TEXT} numbers at most.
                </p>
              )}
              {parentEmails.length > 0 && (
                <a
                  href={`mailto:?bcc=${parentEmails.map(encodeURIComponent).join(",")}`}
                  className="shrink-0 rounded-full px-4 py-2 text-sm font-semibold text-thunder-blue ring-1 ring-thunder-blue/30 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-500/10"
                >
                  ✉️ Email parents ({parentEmails.length})
                </a>
              )}
            </div>
          )}
          {!players.length && (
            <p className="px-4 pb-4 text-sm text-zinc-500">
              {asDirector ? "No players yet. Tap “+ Add players”." : "No players on the roster yet."}
            </p>
          )}
          <ul className="divide-y divide-zinc-100 border-t border-zinc-100 dark:divide-white/5 dark:border-white/5">
            {players.map((p) => (
              <RosterPlayerRow
                key={p.registrantId}
                className="px-4 py-2.5"
                line={
                  <>
                    <span className="min-w-0 truncate font-medium">
                      {p.firstName} <span className="font-semibold">{p.lastName}</span>
                    </span>
                    <span className="shrink-0 text-xs text-zinc-400">
                      {gradeLabel(p.grade)}
                      {!p.registered && <span className="text-amber-700 dark:text-amber-400"> · not registered</span>}
                    </span>
                  </>
                }
                more={
                  <>
                    {p.parents.map((g, i) => (
                      <span key={i} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                        <span className="text-zinc-600 dark:text-zinc-300">{g.name}</span>
                        {g.cell && <PhoneLink cell={g.cell} label={formatCell(g.cell)} />}
                        {g.email && <EmailLink email={g.email} />}
                        {!g.cell && !g.email && <span className="text-zinc-400">no cell or email</span>}
                      </span>
                    ))}
                    {p.registered && !p.parents.length && (
                      <span className="block text-xs text-zinc-400">No parent contact in registration</span>
                    )}
                    {!p.registered && (
                      <span className="block text-xs text-amber-700 dark:text-amber-400">No longer in registrations</span>
                    )}
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-zinc-400">{who && `Rostered by ${p.rosteredBy}`}</span>
                      {asDirector && (
                        <RemovePlayerButton teamId={team.id} registrantId={p.registrantId} name={`${p.firstName} ${p.lastName}`} />
                      )}
                    </div>
                  </>
                }
              />
            ))}
          </ul>
          {/* Players still available (eligible, not on any team), at the bottom when there are any: ☆/★ marks this team's
              interest, Evaluate opens their card. */}
          {available && available.length > 0 && (
            <div className="border-t border-zinc-100 pt-3 dark:border-white/5">
              <div className="px-4 pb-3">
                <h3 className="font-semibold">Available players ({available.length})</h3>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  {team.gender} in {gradesText(team.grades)} and one grade below, not on a team yet. ★ marks your interest; only{" "}
                  {team.name}
                  &apos;s coaches and the Director see your ratings.
                </p>
              </div>
              <AvailablePlayers teamId={team.id} teamName={team.name} cards={available} />
            </div>
          )}
        </CollapseCard>
        <CollapseCard title="Games" count={published.length} open={opened === "games"}>
          <div className="px-4 pb-4">
            {published.length ? (
              <ScheduleList games={published} practices={[]} today={easternDate(new Date())} />
            ) : (
              <p className="text-sm text-zinc-500">The game schedule shows here once it&apos;s published.</p>
            )}
          </div>
        </CollapseCard>
        {uniforms && (
          <CollapseCard title="Uniforms" count={uniforms.length} open={opened === "uniforms"} alert={missingUniforms > 0}>
            <div className="px-4 pb-3">
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                A number for every player (unique on the team), and a size for players who ordered a uniform.
                {uniforms.some((u) => u.late) && " ✱ Uniform added after registration."}
              </p>
            </div>
            <UniformsBoard teamId={team.id} rows={who ? uniforms : uniforms.map((r) => ({ ...r, updatedBy: null }))} who={who} />
          </CollapseCard>
        )}
        <CollapseCard
          title="Practices"
          count={practices.length}
          open={opened === "practices"}
          action={
            <Link
              href={`/org/thunder/practice?team=${team.id}`}
              className="shrink-0 rounded-full bg-thunder-blue px-3 py-1.5 text-sm font-semibold whitespace-nowrap text-white shadow-sm hover:bg-thunder-blue-dark"
            >
            {canBook ? "Book practices" : "View schedule"}
          </Link>
          }
        >
          {!practices.length && <p className="px-4 pb-4 text-sm text-zinc-500">No practices booked yet.</p>}
          <ul className="divide-y divide-zinc-100 border-t border-zinc-100 dark:divide-white/5 dark:border-white/5">
            {practices.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <Link
                  href={`/events/practice/${p.id}`}
                  className="font-semibold text-thunder-blue underline-offset-2 hover:underline dark:text-blue-400"
                >
                  {p.startsAt.toLocaleDateString("en-US", { timeZone: TZ, weekday: "short", month: "numeric", day: "numeric" })}{" "}
                  · {p.startsAt.toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" })}
                  <span className="block text-xs font-normal">✓ Attendance</span>
                </Link>
                <span className="text-right text-zinc-500">
                  {p.gym} {p.court}
                  {who && p.bookedBy && <span className="block text-xs text-zinc-400">by {p.bookedBy}</span>}
                </span>
              </li>
            ))}
          </ul>
        </CollapseCard>
        {canEditTeam && (
          <DeleteTeamButton teamId={team.id} name={team.name} players={roster?.length ?? 0} practices={practices.length} />
        )}
      </main>
    </>
  );
}

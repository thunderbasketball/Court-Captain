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
import { ViewAsButton } from "../../../../ViewAsButton";
import { GroupTextButton } from "../../../../Contacts";
import AppHeader, { type TeamTab } from "../../../../AppHeader";
import { Chip, EmailLink, PersonRow, PhoneLink, card } from "../../../../ui";
import AvailablePlayers from "./AvailablePlayers";
import UniformsBoard from "./UniformsBoard";
import { AddPlayersButton, RemovePlayerButton } from "./RosterTools";
import { scheduledGames } from "@/lib/scenic-games";
import { easternDate } from "@/lib/time";
import { LeagueGames } from "../../../../LeagueGames";
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
  // Every parent's cell and email once, for one group text or email to the team's families.
  const parentCells = [...new Set(players.flatMap((p) => p.parents.flatMap((g) => (g.cell ? [g.cell] : []))))];
  const parentEmails = [...new Set(players.flatMap((p) => p.parents.flatMap((g) => (g.email ? [g.email.toLowerCase()] : []))))];
  // Its Scenic City League games (opponent, time and gym once scheduled): matchups are made for its copy there.
  const copy = (await db.query<{ id: string }>("select id::text from scenic_teams where thunder_team_id = $1", [team.id])).rows[0]
    ?.id;
  const games = copy ? ((await scheduledGames(db, [copy]))[copy] ?? []) : [];
  const canBook = asDirector || team.myRoles.some((r) => r !== "TeamParent");
  // The team page is split into the Staff / Roster / Uniforms / Practices tabs: in the header for its staff, and on the
  // page for Admins and Directors (the same views as the coaches, with their own tools), to help support the team.
  const requested = (await searchParams).tab;
  const teamTab: TeamTab = requested === "roster" || requested === "uniforms" || requested === "practices" ? requested : "staff";
  const show = (t: TeamTab) => teamTab === t;
  // The Roster tab lists the players still available (eligible, not on any team) for the coaches to star and evaluate.
  const available =
    teamTab === "roster" && mayEvaluate
      ? ((await listEvaluations(deps, user, team.id)) ?? []).filter((c) => c.registered && !c.rosteredOn.length)
      : null;
  // Uniforms: their tab flashes red while anything is missing.
  const [uniforms, missingUniforms, uniformsOn] = await Promise.all([
    teamTab === "uniforms" ? listUniforms(deps, user, team.id) : null,
    uniformsMissing(deps, team.id),
    hasFeature(db, "thunder", "uniforms"),
  ]);
  const tabs: { key: TeamTab; label: string; alert?: boolean }[] = [
    { key: "staff", label: "Staff" },
    { key: "roster", label: "Roster", alert: !players.length },
    ...(uniformsOn ? [{ key: "uniforms" as const, label: "Uniforms", alert: missingUniforms > 0 }] : []),
    { key: "practices", label: "Practices" },
  ];

  return (
    <>
      <AppHeader
        user={user}
        tab="teams"
        context={asDirector ? "director" : `team:${team.id}`}
        teamTab={
          asDirector
            ? undefined
            : {
                teamId: team.id,
                tab: teamTab,
                alert: [...(missingUniforms ? ["uniforms" as const] : []), ...(players.length ? [] : ["roster" as const])],
              }
        }
      />
      <main className="mx-auto w-full max-w-xl flex-1 space-y-4 px-4 py-6">
        {asDirector && (
          <Link href="/org/thunder/teams" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
            ← Teams
          </Link>
        )}
        {asDirector && (
          <nav
            aria-label={`${team.name} tabs`}
            className="flex gap-1 overflow-x-auto border-b border-zinc-200 dark:border-white/10"
          >
            {tabs.map((t) => (
              <Link
                key={t.key}
                href={t.key === "staff" ? `/org/thunder/teams/${team.id}` : `/org/thunder/teams/${team.id}?tab=${t.key}`}
                aria-current={teamTab === t.key ? "page" : undefined}
                className={`shrink-0 border-b-2 px-3 py-2 text-sm font-semibold whitespace-nowrap ${
                  teamTab === t.key
                    ? "border-thunder-orange text-zinc-900 dark:text-white"
                    : "border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
                } ${t.alert ? "animate-pulse text-red-600! dark:text-red-400!" : ""}`}
              >
                {t.label}
              </Link>
            ))}
          </nav>
        )}

        {show("staff") && (
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
                <LeagueGames games={games} today={easternDate(new Date())} />
              </div>
            </div>
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
        )}
        {show("staff") && (
          <section className={`${card} overflow-hidden`}>
            <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-3">
              <h2 className="font-semibold">Staff ({team.staff.length})</h2>
              {canEditStaff && (
                <AddStaffButton
                  teamId={team.id}
                  gender={team.gender}
                  grades={team.grades}
                  canSetHead={asDirector}
                  filledRoles={team.staff.map((s) => s.role)}
                  users={options?.users ?? []}
                  volunteers={options?.volunteers ?? []}
                />
              )}
            </div>
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
                  under={
                    asDirector &&
                    isThunderAdmin(user) &&
                    s.coachId !== user.coachId && <ViewAsButton coachId={s.coachId} name={`${s.firstName} ${s.lastName}`} />
                  }
                  chips={<Chip tone={roleTone[s.role]}>{roleLabel(s.role)}</Chip>}
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
          </section>
        )}
        {show("roster") && (
          <section className={`${card} overflow-hidden`}>
            <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-3">
              <h2 className="font-semibold">Players ({players.length})</h2>
              {asDirector && (
                <AddPlayersButton
                  teamId={team.id}
                  teamName={team.name}
                  candidates={candidates}
                  canSecond={hasArea(user, "players")}
                />
              )}
            </div>
            {parentCells.length + parentEmails.length > 0 && (
              <div className="flex flex-wrap gap-2 px-4 pb-3">
                <GroupTextButton cells={parentCells} label="Text parents" />
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
                <li key={p.registrantId} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {p.firstName} <span className="font-semibold">{p.lastName}</span>
                    </span>
                    <span className="block text-xs text-zinc-400">
                      {gradeLabel(p.grade)}
                      {who && ` · Rostered by ${p.rosteredBy}`}
                      {!p.registered && <span className="text-amber-700 dark:text-amber-400"> · no longer in registrations</span>}
                    </span>
                    {p.parents.map((g, i) => (
                      <span key={i} className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-xs">
                        <span className="text-zinc-600 dark:text-zinc-300">{g.name}</span>
                        {g.cell && <PhoneLink cell={g.cell} label={formatCell(g.cell)} />}
                        {g.email && <EmailLink email={g.email} />}
                        {!g.cell && !g.email && <span className="text-zinc-400">no cell or email</span>}
                      </span>
                    ))}
                    {p.registered && !p.parents.length && (
                      <span className="mt-0.5 block text-xs text-zinc-400">No parent contact in registration</span>
                    )}
                  </span>
                  {asDirector && (
                    <RemovePlayerButton teamId={team.id} registrantId={p.registrantId} name={`${p.firstName} ${p.lastName}`} />
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
        {available && (
          <section className={`${card} overflow-hidden`}>
            <div className="px-4 pt-4 pb-3">
              <h2 className="font-semibold">Available players ({available.length})</h2>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                {team.gender} in {gradesText(team.grades)} and one grade below, not on a team yet. ★ marks your interest; only{" "}
                {team.name}
                &apos;s coaches and the Director see your ratings.
              </p>
            </div>
            <AvailablePlayers teamId={team.id} teamName={team.name} cards={available} />
          </section>
        )}
        {uniforms && (
          <section className={`${card} overflow-hidden`}>
            <div className="px-4 pt-4 pb-3">
              <h2 className="font-semibold">Uniforms ({uniforms.length})</h2>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                A number for every player (unique on the team), and a size for players who ordered a uniform.
                {uniforms.some((u) => u.late) && " ✱ Uniform added after registration."}
              </p>
            </div>
            <UniformsBoard teamId={team.id} rows={who ? uniforms : uniforms.map((r) => ({ ...r, updatedBy: null }))} who={who} />
          </section>
        )}
        {show("practices") && (
          <section className={`${card} overflow-hidden`}>
            <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-3">
              <h2 className="font-semibold">Practices ({practices.length})</h2>
              <Link
                href={`/org/thunder/practice?team=${team.id}`}
                className="shrink-0 rounded-full bg-thunder-blue px-3 py-1.5 text-sm font-semibold whitespace-nowrap text-white shadow-sm hover:bg-thunder-blue-dark"
              >
                {canBook ? "Book practices" : "View schedule"}
              </Link>
            </div>
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
          </section>
        )}
        {canEditTeam && show("staff") && (
          <DeleteTeamButton teamId={team.id} name={team.name} players={roster?.length ?? 0} practices={practices.length} />
        )}
      </main>
    </>
  );
}

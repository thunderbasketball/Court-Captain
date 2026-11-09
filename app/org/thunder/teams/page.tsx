import { Suspense } from "react";
import TeamsIncluded from "../../../TeamsIncluded";
import { redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { requireFeature } from "@/lib/features-server";
import { dmKey } from "@/lib/chat";
import { db } from "@/lib/db";
import { gradesText } from "@/lib/event-names";
import { gradeLabel } from "@/lib/grades";
import { listTeams, personOptions } from "@/lib/teams";
import AddTeamButton from "../../../AddTeam";
import { listThunderImports } from "@/lib/thunder-team-import";
import { thunderPrograms } from "@/lib/thunder-leagues";
import RegisterPrograms from "../../../RegisterPrograms";
import { TZ, easternDate } from "@/lib/time";
import { scheduledGames, type ScheduledGame } from "@/lib/scenic-games";
import { ScheduleList } from "../../../LeagueGames";
import { upcomingForTeams } from "@/lib/practice/schedule";
import { ImportTeamsButton, UndoImportButton } from "../../../TeamImport";
import { createTeam, importThunderTeams, previewThunderImport, undoThunderImport } from "./actions";
import { gradeSort } from "@/lib/team-names";
import AppHeader from "../../../AppHeader";
import { CollapseCard, PageTitle } from "../../../ui";
import TeamRow, { GradeGroups, TeamsTabs, teamTabs } from "../../../TeamRow";
import { ContactChip, GroupTextButton, TextTeamsButton } from "../../../Contacts";
import ChatLink from "../../../ChatLink";
import NotifyButton from "../../../NotifyButton";
import TeamRosterList from "./TeamRosterList";
import { hasArea, isThunderAdmin, seesWho } from "@/lib/org-admin";
import { ViewAsButton } from "../../../ViewAsButton";

export default function TeamsPage({ searchParams }: PageProps<"/org/thunder/teams">) {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <Teams searchParams={searchParams} />
    </Suspense>
  );
}

async function Teams({ searchParams }: { searchParams: PageProps<"/org/thunder/teams">["searchParams"] }) {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  await requireFeature("thunder", "team-building");
  if (!hasArea(user, "teams")) redirect("/");
  const who = await seesWho(db, user, "thunder"); // Owners and Admins see who did it

  const teams = await listTeams({ pool: db, now: () => new Date() }, user);
  // Who can be a Head Coach: app users, and registration volunteers (their login is made when added).
  const people = await personOptions({ pool: db, now: () => new Date() }, user);
  const imports = (await listThunderImports({ pool: db, now: () => new Date() }, user)) ?? [];
  const when = (d: Date) =>
    d.toLocaleString("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  // Tabs: one per level and gender it has teams for (youngest grade first), then Register (league programs).
  const progs = await thunderPrograms({ pool: db, now: () => new Date() }, user);
  const register = !!progs && progs.programs.length > 0;
  const tabs = teamTabs(teams, (await searchParams).view, register);
  // Each team's published Scenic City League games (matchups are made for its copy there), for the 📅 on its card.
  const copies = (
    await db.query<{ id: string; team: string }>(
      "select id::text, thunder_team_id::text as team from scenic_teams where thunder_team_id = any($1::bigint[])",
      [teams.map((t) => t.id)],
    )
  ).rows;
  const games = await scheduledGames(db, copies.map((c) => c.id));
  const schedules: Record<string, ScheduledGame[]> = Object.fromEntries(
    copies.map((c) => [c.team, (games[c.id] ?? []).filter((g) => g.published)]),
  );
  const today = easternDate(new Date());
  const practices = await upcomingForTeams({ pool: db, now: () => new Date() }, teams.map((t) => t.id)); // and practices

  return (
    <>
      <AppHeader user={user} tab="teams" context="director" />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <div className="flex items-start justify-between gap-3">
          <PageTitle title={`Teams (${teams.length})`} subtitle="Thunder Basketball's teams and coaches" />
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {/* All coaches: text, chat and notify */}
            <TextTeamsButton
              teams={teams.map((t) => ({
                id: String(t.id),
                name: t.name,
                gender: t.gender,
                level: t.level,
                grade: Math.min(...t.grades.map(gradeSort)),
                headCells: t.staff.filter((s) => s.role === "HeadCoach").map((s) => s.cell),
              }))}
            />
            <ChatLink chatKey="coaches" label="Chat with all coaches" size="md" popup />
            <NotifyButton audience={{ roles: ["coach"] }} to="all coaches" size="md" />
            <ImportTeamsButton
              preview={previewThunderImport}
              add={importThunderTeams}
              example={
                "Gender,Grade,Level,Coach First,Coach Last,Coach Cell,Alternate Name\nBoys,3rd/4th,REC,Sam,Lee,423-555-0101,Bolts\nGirls,5th,COMP,,,,"
              }
              help="One team per row with its Gender, Grade and Level (REC or COMP), and if you have them the Head Coach's name, cell and email and an Alternate name, in any order. Each team is named from its Head Coach (like 4G Epps; 4G TBD until a coach is added; the same name twice gets numbers: 4G Epps 1 and 2). A coach without a cell is fine: add it later on the team. Paste from a spreadsheet or choose a CSV file. Next you'll check which column is which, then see exactly what will be added (we clean up things like 3 & 4 or R)."
            />
            <AddTeamButton people={[...people.users, ...people.volunteers]} create={createTeam} href="/org/thunder/teams/" />
          </div>
        </div>
        <TeamsTabs base="/org/thunder/teams" current={tabs.current} groups={tabs.groups} register={register} />
        {!teams.length && <p className="text-zinc-500">No teams yet. Tap “+ Add” (or Import) to create some.</p>}
        {tabs.group && (
          <GradeGroups
            teams={tabs.group.teams}
            grade={(t) => (t.grades.length ? gradeLabel(t.grades[t.grades.length - 1]) : "No grade")}
            row={(t) => (
            <TeamRow
              key={t.id}
              href={`/org/thunder/teams/${t.id}`}
              name={t.name}
              altName={t.altName}
              gender={t.gender as "Boys" | "Girls"}
              level={t.level}
              sub={[...(t.grades.length > 1 ? [gradesText(t.grades)] : []), ...t.practiceLocations].join(" · ")}
              hasCoach={!!t.headCoach}
              waitingCoach={t.waitingCoach && `${t.waitingCoach.first} ${t.waitingCoach.last}`}
              needsEmail={t.staff.some((p) => p.role === "HeadCoach" && !p.email)}
              players={t.players.length}
              people={t.staff.map((p) => (
                <ContactChip
                  key={p.role}
                  person={p}
                  about={t.name}
                  extra={
                    isThunderAdmin(user) &&
                    p.coachId !== user.coachId && <ViewAsButton coachId={p.coachId} name={`${p.first} ${p.last}`} />
                  }
                  chatKey={
                    (p.role === "HeadCoach" || p.role === "AsstCoach") && p.coachId !== user.coachId
                      ? dmKey(user.coachId, p.coachId)
                      : undefined
                  }
                />
              ))}
              lead={t.staff.length > 0 && <GroupTextButton small cells={t.staff.map((p) => p.cell)} label="Text coaches" />}
              roster={{ count: t.players.length, list: <TeamRosterList team={t} who={who} /> }}
              schedule={{
                items: (schedules[t.id] ?? []).length + (practices[t.id] ?? []).length,
                list: <ScheduleList games={schedules[t.id] ?? []} practices={practices[t.id] ?? []} today={today} />,
              }}
              chat={t.staff.length > 0 ? { chatKey: `staff-${user.coachId}-${t.id}`, label: `Chat with ${t.name} staff` } : undefined}
              notify={t.staff.length > 0 ? { teams: [t.id] } : undefined}
            />
            )}
          />
        )}
        {tabs.current === "register" && progs && <RegisterPrograms org="thunder" progs={progs} />}
        {imports.length > 0 && (
          <div className="mt-4">
            <CollapseCard title="Recent imports" count={imports.length}>
              <ul className="divide-y divide-zinc-100 px-4 pb-2 dark:divide-white/5">
                {imports.map((i) => (
                  <li key={i.id} className="flex items-start justify-between gap-3 py-2 text-sm">
                    <TeamsIncluded
                      names={i.names}
                      summary={
                        <>
                          {when(i.importedAt)} · {i.teams} team{i.teams === 1 ? "" : "s"}
                          {who && ` · by ${i.importedBy}`}
                          {i.left < i.teams && ` · ${i.left} still here`}
                        </>
                      }
                    />
                    {i.left > 0 && (
                      <UndoImportButton
                        undo={undoThunderImport.bind(null, i.id)}
                        teams={i.left}
                        when={when(i.importedAt)}
                        note="Teams with players or booked practices are kept (remove those first)."
                      />
                    )}
                  </li>
                ))}
              </ul>
            </CollapseCard>
          </div>
        )}
      </main>
    </>
  );
}

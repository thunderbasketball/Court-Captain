import { Suspense } from "react";
import TeamsIncluded from "../../../TeamsIncluded";
import { redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { requireFeature } from "@/lib/features-server";
import { hasFeature } from "@/lib/features";
import { dmKey } from "@/lib/chat";
import { db } from "@/lib/db";
import { gradesText } from "@/lib/event-names";
import { gradeLabel } from "@/lib/grades";
import { listTeams, personOptions } from "@/lib/teams";
import { AddTeamPanel } from "../../../AddTeam";
import { listThunderImports } from "@/lib/thunder-team-import";
import { thunderPrograms } from "@/lib/thunder-leagues";
import RegisterPrograms from "../../../RegisterPrograms";
import { TZ, easternDate } from "@/lib/time";
import { rosterIssue, schoolYearOf } from "@/lib/eligibility";
import { orgGradeRules } from "@/lib/grade-rules";
import { scheduledGames, type ScheduledGame } from "@/lib/scenic-games";
import { ScheduleList } from "../../../LeagueGames";
import { upcomingForTeams } from "@/lib/practice/schedule";
import { ImportTeamsPanel, UndoImportButton } from "../../../TeamImport";
import { createTeam, importThunderTeams, previewThunderImport, undoThunderImport } from "./actions";
import { gradeSort } from "@/lib/team-names";
import AppHeader from "../../../AppHeader";
import { CollapseCard, PageTitle } from "../../../ui";
import TeamWarningsCard from "../../../warnings/TeamWarningsCard";
import TeamRow, { TeamsByLevel, teamMix } from "../../../TeamRow";
import { ContactChip, GroupTextButton, TextTeamsPanel } from "../../../Contacts";
import ChatPanel from "../../../ChatPanel";
import PageMenus, { MEGAPHONE_BTN, MegaphoneIcon, PLUS_BTN, PlusIcon } from "../../../PageMenus";
import { NotifyPanel } from "../../../NotifyButton";
import TeamRosterList from "./TeamRosterList";
import { hasArea, isThunderAdmin, seesWho } from "@/lib/org-admin";
import { ViewAsButton } from "../../../ViewAsButton";

import { PageFrame } from "../../../ui";

export async function TeamsContent({
  searchParams = Promise.resolve({}),
  embedded = false,
}: {
  searchParams?: PageProps<"/org/thunder/teams">["searchParams"];
  embedded?: boolean; // inside a Home card: no header or page frame, and never sends you away
} = {}) {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  if (embedded) {
    if (!(await hasFeature(db, "thunder", "team-building"))) return null;
  } else await requireFeature("thunder", "team-building");
  if (!hasArea(user, "teams")) {
    if (embedded) return null;
    redirect("/");
  }
  const who = await seesWho(db, user, "thunder"); // Owners and Admins see who did it

  const teams = await listTeams({ pool: db, now: () => new Date() }, user);
  // Who can be a Head Coach: app users, and registration volunteers (their login is made when added).
  const people = await personOptions({ pool: db, now: () => new Date() }, user);
  const imports = (await listThunderImports({ pool: db, now: () => new Date() }, user)) ?? [];
  const when = (d: Date) =>
    d.toLocaleString("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  // Cards: REC and COMP (Boys and Girls in each, by grade; youngest first), then Register (league programs).
  const progs = await thunderPrograms({ pool: db, now: () => new Date() }, user);
  const register = !!progs && progs.programs.length > 0;
  const view = (await searchParams).view;
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
  const schoolYear = schoolYearOf(today); // each roster's grade eligibility (a red name and badge when off)
  const { rules: gradeRules } = await orgGradeRules(db, "thunder", new Date()); // set in the organization's gear
  const practices = await upcomingForTeams({ pool: db, now: () => new Date() }, teams.map((t) => t.id)); // and practices

  return (
    <>
      {!embedded && <AppHeader user={user} tab="teams" context="director" />}
      <PageFrame embedded={embedded} className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        {/* Phone-sized: 📣 opens Text, Chat and Alert coaches; + opens Add a team and Import teams, right under the title. */}
        <PageMenus
          slot={embedded ? "card-slot-teams" : undefined}
          title={<PageTitle title={`Teams (${teams.length})`} subtitle={teamMix(teams) || "Thunder Basketball's teams and coaches"} />}
          menus={[
            {
              key: "coaches",
              icon: <MegaphoneIcon />,
              label: "Coaches: text, chat or alert",
              className: MEGAPHONE_BTN,
              items: [
                {
                  key: "text",
                  label: "💬 Text coaches",
                  panel: (
                    <TextTeamsPanel
                      teams={teams.map((t) => ({
                        id: String(t.id),
                        name: t.name,
                        gender: t.gender,
                        level: t.level,
                        grade: Math.min(...t.grades.map(gradeSort)),
                        headCells: t.staff.filter((s) => s.role === "HeadCoach").map((s) => s.cell),
                      }))}
                    />
                  ),
                },
                { key: "chat", label: "🗨️ Chat with coaches", panel: <ChatPanel chatKey="coaches" /> },
                { key: "alert", label: "🔔 Alert coaches", panel: <NotifyPanel audience={{ roles: ["coach"] }} to="all coaches" /> },
              ],
            },
            {
              key: "add",
              icon: <PlusIcon />,
              label: "Add or import teams",
              className: PLUS_BTN,
              items: [
                {
                  key: "add",
                  label: "＋ Add a team",
                  panel: (
                    <AddTeamPanel people={[...people.users, ...people.volunteers]} create={createTeam} href="/org/thunder/teams/" />
                  ),
                },
                {
                  key: "import",
                  label: "⇪ Import teams",
                  panel: (
                    <ImportTeamsPanel
                      preview={previewThunderImport}
                      add={importThunderTeams}
                      example={
                  "Gender,Grade,Level,Coach First,Coach Last,Coach Cell,Alternate Name\nBoys,3rd/4th,REC,Sam,Lee,423-555-0101,Bolts\nGirls,5th,COMP,,,,"
                }
                      help="One team per row with its Gender, Grade and Level (REC or COMP), and if you have them the Head Coach's name, cell and email and an Alternate name, in any order. Each team is named from its Head Coach (like 4G Epps; 4G TBD until a coach is added; the same name twice gets numbers: 4G Epps 1 and 2). A coach without a cell is fine: add it later on the team. Paste from a spreadsheet or choose a CSV file. Next you'll check which column is which, then see exactly what will be added (we clean up things like 3 & 4 or R)."
                    />
                  ),
                },
              ],
            },
          ]}
        />
        {/* Warnings: the ones this organization turned on (its gear), streamed so the teams show first. */}
        {teams.length > 0 && (
          <div className="mb-3">
            <Suspense fallback={null}>
              <TeamWarningsCard org="thunder" base="/org/thunder" />
            </Suspense>
          </div>
        )}
        {!teams.length && <p className="text-zinc-500">No teams yet. Tap “+” to add or import some.</p>}
        {(teams.length > 0 || register) && (
          <TeamsByLevel
            teams={teams}
            view={view}
            register={register && progs ? { count: progs.programs.length, body: <RegisterPrograms org="thunder" progs={progs} bare /> } : null}
            grade={(t) => (t.grades.length ? gradeLabel(t.grades[t.grades.length - 1]) : "No grade")}
            warn={(t) => !!rosterIssue(t.grades, t.players, schoolYear, gradeRules)}
            row={(t) => (
            <TeamRow
              key={t.id}
              href={`/org/thunder/teams/${t.id}`}
              name={t.name}
              issue={rosterIssue(t.grades, t.players, schoolYear, gradeRules)}
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
              roster={{ count: t.players.length, list: <TeamRosterList team={t} who={who} rules={gradeRules} /> }}
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
      </PageFrame>
    </>
  );
}

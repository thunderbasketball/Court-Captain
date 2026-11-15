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
import { easternDate } from "@/lib/time";
import { rosterIssue, schoolYearOf } from "@/lib/eligibility";
import { orgGradeRules } from "@/lib/grade-rules";
import { scheduledGames, type ScheduledGame } from "@/lib/scenic-games";
import { ScheduleList } from "../../../LeagueGames";
import { teamScrimmages } from "@/lib/scrimmages";
import { upcomingForTeams } from "@/lib/practice/schedule";
import { upcomingOwnForTeams } from "@/lib/team-practices";
import { ImportTeamsPanel } from "../../../TeamImport";
import { createTeam, importThunderTeams, previewThunderImport, undoThunderImport } from "./actions";
import { gradeSort } from "@/lib/team-names";
import AppHeader from "../../../AppHeader";
import TeamsList, { IMPORT_EXAMPLE, IMPORT_HELP } from "../../../TeamsList";
import TeamRow, { teamMix, teamNeeds } from "../../../TeamRow";
import { ContactChip, GroupTextButton } from "../../../Contacts";
import TeamRosterList from "./TeamRosterList";
import { ThunderTeamView } from "./[id]/view";
import RosterBoardButton from "../players/RosterBoardButton";
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
  // Cards: REC and COMP (Boys and Girls in each, by grade; youngest first), then Register (league programs).
  const progs = await thunderPrograms({ pool: db, now: () => new Date() }, user);
  const register = !!progs && progs.programs.length > 0;
  const sp = await searchParams;
  const view = sp.view;
  // Teams whose page is open right in their row (↗; `?team=<id>,…`): only those are built.
  const openTeams = new Set(typeof sp.team === "string" ? sp.team.split(",") : []);
  // Roster players needs player registrations (CourtPlayers); Directors of Teams (checked again on the server).
  const rosterBoard = (await hasFeature(db, "thunder", "player-registration")) && hasArea(user, "teams");
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
  const scrims = await teamScrimmages({ pool: db, now: () => new Date() }, "thunder", teams.map((t) => t.id)); // and scrimmages
  const practices = await upcomingForTeams({ pool: db, now: () => new Date() }, teams.map((t) => t.id)); // and practices
  const own = await upcomingOwnForTeams({ pool: db, now: () => new Date() }, "thunder", teams.map((t) => String(t.id))); // and own-gym ones

  return (
    <>
      {!embedded && <AppHeader user={user} tab="teams" context="director" />}
      <PageFrame embedded={embedded} className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <TeamsList
          slot={embedded ? "card-slot-teams" : undefined}
          count={teams.length}
          subtitle={teamMix(teams) || "Thunder Basketball's teams and coaches"}
          coaches={{
            text: teams.map((t) => ({
              id: String(t.id),
              name: t.name,
              gender: t.gender,
              level: t.level,
              grade: Math.min(...t.grades.map(gradeSort)),
              headCells: t.staff.filter((s) => s.role === "HeadCoach").map((s) => s.cell),
            })),
            chatKey: "coaches",
            alert: { roles: ["coach"] },
          }}
          add={{
            add: <AddTeamPanel people={[...people.users, ...people.volunteers]} create={createTeam} href="/org/thunder/teams/" />,
            import: (
              <ImportTeamsPanel
                preview={previewThunderImport}
                add={importThunderTeams}
                example={IMPORT_EXAMPLE}
                help={IMPORT_HELP}
              />
            ),
          }}
          warnings={{ org: "thunder", base: "/org/thunder" }}
          empty="No teams yet. Tap “+” to add or import some."
          teams={teams}
          view={view}
          register={register && progs ? { count: progs.programs.length, body: <RegisterPrograms org="thunder" progs={progs} bare /> } : null}
          grade={(t) => (t.grades.length ? gradeLabel(t.grades[t.grades.length - 1]) : "No grade")}
          warn={(t) =>
            !!rosterIssue(t.grades, t.players, schoolYear, gradeRules) ||
            teamNeeds({
              hasCoach: !!t.headCoach,
              waitingCoach: t.waitingCoach,
              needsEmail: t.staff.some((p) => p.role === "HeadCoach" && !p.email),
              players: t.players.length,
            })
          }
          // Roster players (with player registration): the grade's roster board, on its card's title line.
          gradeAction={
            rosterBoard
              ? (list) => {
                  const t = list[0];
                  const g = t.grades[t.grades.length - 1];
                  return g && (t.gender === "Boys" || t.gender === "Girls") ? <RosterBoardButton gender={t.gender} grade={g} /> : null;
                }
              : undefined
          }
            row={(t) => (
            <TeamRow
              key={t.id}
              href={`/org/thunder/teams/${t.id}`}
              page={{ id: String(t.id), content: openTeams.has(String(t.id)) ? <ThunderTeamView id={String(t.id)} embedded /> : null }}
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
                items: (schedules[t.id] ?? []).length + (practices[t.id] ?? []).length + (own[t.id] ?? []).length + (scrims[t.id] ?? []).length,
                list: (
                  <ScheduleList games={schedules[t.id] ?? []} practices={practices[t.id] ?? []} own={own[t.id] ?? []} scrims={scrims[t.id] ?? []} today={today} />
                ),
              }}
              chat={t.staff.length > 0 ? { chatKey: `staff-${user.coachId}-${t.id}`, label: `Chat with ${t.name} staff` } : undefined}
              notify={t.staff.length > 0 ? { teams: [t.id] } : undefined}
            />
            )}
          imports={{
            list: imports,
            who,
            undo: (id) => undoThunderImport.bind(null, id),
            note: "Teams with players or booked practices are kept (remove those first).",
          }}
        />
      </PageFrame>
    </>
  );
}

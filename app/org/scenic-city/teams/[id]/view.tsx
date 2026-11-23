import type { ReactNode } from "react";
import { notFound, redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { seesWho } from "@/lib/org-admin";
import { scheduledGames } from "@/lib/scenic-games";
import { leagueTeamPage } from "@/lib/scenic-team-page";
import { teamRequests } from "@/lib/schedule-requests";
import { easternDate } from "@/lib/time";
import { LeagueGames, ScheduleList } from "../../../../LeagueGames";
import NextSevenDays from "../../../../NextSevenDays";
import ScheduleRequests from "../../../../ScheduleRequests";
import TeamPage, { type TeamStaffRow } from "../../../../TeamPage";
import { leagueRoster, mayManageLeagueTeam } from "@/lib/league-roster";
import { leagueStaff } from "@/lib/scenic-team-page";
import { AddLeaguePlayer, AddLeagueStaff, RemoveLeaguePlayer, RemoveLeagueStaff } from "./LeagueTeamTools";
import { Chip } from "../../../../ui";

const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

// A League team's page (Solo teams and outside clubs' teams), like every organization's team page: its card (with
// `edit`: Edit and Delete, from the Teams list), Current Registrations (dates, Brackets, Paid, its games) with Schedule
// requests, Next 10 days, Staff, Games. On its own page, or opened inside its row on the Teams list (`embedded`). Who may
// see it is checked in lib/scenic-team-page.
export async function LeagueTeamView({ id, opened = "", embedded = false, edit }: { id: string; opened?: string; embedded?: boolean; edit?: ReactNode }) {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  const page = await leagueTeamPage(db, user, id);
  if (!page) {
    if (embedded) return null;
    notFound();
  }
  const deps = { pool: db, now: () => new Date() };
  const [who, games, requests, players, manage, kept, staffBy] = await Promise.all([
    seesWho(db, user, "scenic-city"),
    scheduledGames(db, [id]).then((g) => g[id] ?? []),
    teamRequests(deps, user, id), // its coaches (and the Scheduler) only
    leagueRoster(db, id),
    mayManageLeagueTeam(db, user, id), // its coach, Scenic City's Directors of Teams: roster and staff
    db.query("select 1 from scenic_teams where id = $1 and org_team_id is null and thunder_team_id is null", [id]).then((r) => !!r.rowCount),
    leagueStaff(db, [id]), // its whole staff, from where it's kept (Thunder's, its organization's, or here)
  ]);
  const today = easternDate(new Date());
  const published = games.filter((g) => g.published);
  const t = page.team;
  const schedule = requests && requests.length ? requests : null;

  return (
    <>
      <TeamPage
        embedded={embedded}
        back={page.manage && !embedded ? "/org/scenic-city/teams" : null}
        edit={edit}
        team={{ id: t.id, name: t.name, altName: t.altName, gender: t.gender, grades: t.grades, level: t.level, practiceLocations: [], createdBy: who ? t.createdBy : null }}
        musts={[
          ...(page.head ? [] : ["COACH INFO" as const]),
          ...(kept && !players.length ? ["ROSTER" as const] : []),
          ...(kept && players.some((p) => !p.birthdate) ? ["PLAYER BIRTHDATES" as const] : []),
        ]}
        next7={<NextSevenDays games={published} practices={[]} own={[]} now={new Date()} team={{ org: "scenic-city", teamId: t.id }} staff={false} mine={[]} rsvps={{}} />}
        opened={opened}
        staff={{
          list: (staffBy[id] ?? []).map((m, i) => ({
            coachId: m.coachId ?? `staff-${i}`, // other staff kept here have no login
            first: m.first,
            last: m.last,
            role: m.role,
            cell: m.cell,
            email: m.email,
            addedBy: null,
            verified: m.verified,
          })),
          waiting: null,
          chatKey: null,
          // Its other staff (Assistant Coach, Manager, Team Parent): its coach or a Director of Teams adds and removes them.
          addPanel: manage && kept ? <AddLeagueStaff teamId={t.id} /> : undefined,
          remove: (s: TeamStaffRow) =>
            manage && kept && s.role !== "HeadCoach" ? <RemoveLeagueStaff teamId={t.id} role={s.role} name={`${s.first} ${s.last}`} /> : null,
          headEmail: () => null,
          viewAs: false,
          me: user.coachId,
        }}
        roster={{
          rows: players.map((p) => ({
            key: p.id,
            number: p.jersey,
            first: p.first,
            last: p.last,
            right: (
              <span className="text-xs text-zinc-500">
                {p.grade !== null && `${p.grade === 0 ? "K" : `Grade ${p.grade}`} · `}
                {p.birthdate ? `Born ${Number(p.birthdate.slice(5, 7))}/${Number(p.birthdate.slice(8, 10))}/${p.birthdate.slice(0, 4)}` : <span className="font-medium text-red-600 dark:text-red-400">no birthdate</span>}
              </span>
            ),
            more: (
              <div className="space-y-1 text-sm text-zinc-600 dark:text-zinc-300">
                <p>{p.birthdate ? `Born ${day(p.birthdate)}, ${p.birthdate.slice(0, 4)}` : "No birthdate"}</p>
                {who && <p className="text-xs text-zinc-500">Added by {p.addedBy}</p>}
                {manage && <RemoveLeaguePlayer id={p.id} name={`${p.first} ${p.last}`} />}
              </div>
            ),
          })),
          alert: kept && (!players.length || players.some((p) => !p.birthdate)),
          cells: [],
          emails: [],
          chatKey: null,
          note: manage ? <AddLeaguePlayer teamId={t.id} /> : undefined,
          empty: kept ? "No players yet." : `${t.from}: its roster is kept on its own team page.`,
        }}
        gamesCount={published.length}
        games={
          published.length ? (
            <ScheduleList games={published} practices={[]} scrims={[]} today={today} />
          ) : (
            <p className="text-sm text-zinc-500">The game schedule shows here once it&apos;s published.</p>
          )
        }
        programs={
          page.programs.length
            ? {
                title: "Current Registrations",
                count: page.programs.length,
                body: (
                  <div className="space-y-3 px-4 pb-3">
                    {page.programs.map((p) => (
                      <div key={p.id} className="space-y-1 text-sm">
                        <p className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold">{p.name}</span>
                          <Chip tone={p.paid ? "green" : "amber"}>{p.paid ? "Paid" : "Unpaid"}</Chip>
                          {p.out && <span className="text-xs font-medium text-red-600 dark:text-red-400">Taken out by the League</span>}
                        </p>
                        <p className="text-zinc-500">{p.division}</p>
                        {p.entry && (
                          <p className="text-zinc-600 dark:text-zinc-300">
                            {p.entry.allSeason
                              ? "ALL Season"
                              : Object.entries(p.entry.perDate)
                                  .sort(([a], [b]) => a.localeCompare(b))
                                  .map(([d, gg]) => `${day(d)} ${gg}GG`)
                                  .join(", ")}
                            {p.entry.bracket && <span className="font-medium text-violet-700 dark:text-violet-300"> · Brackets</span>}
                          </p>
                        )}
                        <LeagueGames games={games.filter((g) => g.programId === p.id)} today={today} />
                      </div>
                    ))}
                    {schedule && <ScheduleRequests teamId={t.id} days={schedule} />}
                  </div>
                ),
              }
            : null
        }
      />
    </>
  );
}

import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { currentScenic } from "@/lib/contexts-server";
import { db } from "@/lib/db";
import { requireFeature } from "@/lib/features-server";
import { shortDate } from "@/lib/program-options";
import { dayGrid, gameLength, gridBlocks, type DayGrid } from "@/lib/scenic-grid";
import { gameDaySchedule, type DateTeam, type ScheduleDay } from "@/lib/scenic-programs";
import AppHeader from "../../../AppHeader";
import { PageTitle, TeamName, card } from "../../../ui";
import { TeamOffButton } from "../programs/ProgramTools";
import { MatchupBoard } from "./MatchupBoard";
import { GamePlace, HomeAway } from "../../../LeagueGames";
import type { ScheduledGame } from "@/lib/scenic-games";
import { GameLengthInput } from "./GameLengthInput";
import { GridBoard } from "./GridBoard";
import { SimulationToggle } from "./SimulationToggle";
import { simulatedTeams } from "@/lib/dev-teams";

export default function SchedulerPage({ searchParams }: PageProps<"/org/scenic-city/scheduler">) {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <Scheduler searchParams={searchParams} />
    </Suspense>
  );
}

const weekday = (iso: string, long = false) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(long ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// Inside each Game Day: Teams (who plays), Matchups and Grid (coming next).
const VIEWS = [
  { key: "teams", label: "Teams" },
  { key: "matchups", label: "Matchups" },
  { key: "grid", label: "Grid" },
] as const;
type View = (typeof VIEWS)[number]["key"];
const href = (day: string, view: View) => `/org/scenic-city/scheduler?day=${day}${view === "teams" ? "" : `&view=${view}`}`;

// Scenic City's Scheduler (Admins and Directors of Scheduling, on the Director chip; SPEC.md section 13, step 7).
// A tab for each upcoming Game Day (the next one first picked), and inside it Teams, Matchups and Grid.
async function Scheduler({ searchParams }: { searchParams: PageProps<"/org/scenic-city/scheduler">["searchParams"] }) {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  await requireFeature("scenic-city", "programs");
  const scenic = await currentScenic(user);
  if (!scenic || scenic.role !== "Director") redirect("/");
  const s = await gameDaySchedule({ pool: db, now: () => new Date() }, user);
  if (!s) redirect("/org/scenic-city");
  const q = await searchParams;
  // Only a listed Game Day or view is used; anything else falls back to the next Game Day's Teams.
  const day = s.days.find((d) => d.date === q.day) ?? s.days.find((d) => d.date >= s.today) ?? s.days[0];
  const view: View = VIEWS.find((v) => v.key === q.view)?.key ?? "teams";
  const grid = day && view === "grid" ? await dayGrid({ pool: db, now: () => new Date() }, user, day.date) : null;
  const length = day ? await gameLength({ pool: db, now: () => new Date() }, user, day.date) : null;

  return (
    <>
      <AppHeader user={user} context={scenic.key} tab="scheduler" />
      <main className="mx-auto w-full max-w-3xl flex-1 space-y-4 px-4 py-6">
        <PageTitle title="Scheduler" subtitle="Each Game Day across every League: its teams, matchups and grid." />
        <SimulationToggle teams={await simulatedTeams(db)} />
        {!day ? (
          <p className={`${card} px-4 py-3 text-sm text-zinc-500`}>
            No upcoming Game Days. A Director of Programs adds them on each League&apos;s page.
          </p>
        ) : (
          <>
            <nav
              aria-label="Game Days"
              className="-mx-4 flex gap-1 overflow-x-auto border-b border-zinc-200 px-4 dark:border-white/10"
            >
              {s.days.map((d) => (
                <Link
                  key={d.date}
                  href={href(d.date, view)}
                  aria-current={d.date === day.date ? "page" : undefined}
                  className={`shrink-0 border-b-2 px-3 py-2 text-center text-sm font-semibold whitespace-nowrap ${
                    d.date === day.date
                      ? "border-scenic-navy text-zinc-900 dark:border-white dark:text-white"
                      : "border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
                  }`}
                >
                  {weekday(d.date)}
                  <span className="block text-[11px] font-normal">
                    {d.programs.some((p) => p.bracket) ? "Brackets" : plural(d.playing, "team")}
                  </span>
                </Link>
              ))}
            </nav>
            <section className={`${card} overflow-hidden`}>
              <div className="flex items-start justify-between gap-3 px-4 pt-4">
                <div className="min-w-0">
                  <h2 className="font-semibold">{weekday(day.date, true)}</h2>
                  <p className="text-xs text-zinc-500">
                    {day.programs.map((p) => (p.bracket ? `${p.programName} Brackets` : p.programName)).join(" · ")}
                  </p>
                </div>
                <p className="shrink-0 text-right text-xs text-zinc-500">
                  {plural(day.playing, "team")}
                  {day.games > 0 && <span className="block">{plural(day.games, "game")} guaranteed</span>}
                </p>
              </div>
              {length && (
                <GameLengthInput day={day.date} label={weekday(day.date)} minutes={length.minutes} setBy={length.setBy} />
              )}
              <nav aria-label="Game Day views" className="mx-4 mt-3 flex rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800">
                {VIEWS.map((v) => (
                  <Link
                    key={v.key}
                    href={href(day.date, v.key)}
                    aria-current={v.key === view ? "page" : undefined}
                    className={`flex-1 rounded-md py-1.5 text-center text-sm font-semibold ${
                      v.key === view
                        ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-white"
                        : "text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
                    }`}
                  >
                    {v.label}
                  </Link>
                ))}
              </nav>
              <div className="px-4 py-3">
                {view === "teams" ? (
                  <Teams day={day} />
                ) : view === "matchups" ? (
                  <Matchups day={day} />
                ) : grid ? (
                  <Grid day={day} grid={grid} />
                ) : (
                  <p className="py-6 text-center text-sm text-zinc-500">This Game Day&apos;s grid isn&apos;t available.</p>
                )}
              </div>
            </section>
          </>
        )}
      </main>
    </>
  );
}

// A League's teams that day, grouped by division in the League's order (Boys then Girls, youngest first).
function byDivision(teams: DateTeam[]): [string, DateTeam[]][] {
  const groups = new Map<string, DateTeam[]>();
  for (const t of teams) groups.set(t.divisionName, [...(groups.get(t.divisionName) ?? []), t]);
  return [...groups];
}

// Teams: each League's teams that day by division (each with its grade group and where it's from) with 1GG/2GG;
// Remove/Restore as on the program page.
function Teams({ day }: { day: ScheduleDay }) {
  return (
    <div className="space-y-3">
      {day.programs.map((p) => (
        <div key={`${p.programId}-${p.key}`}>
          <Link
            href={`/org/scenic-city/programs/${p.programId}`}
            className={`text-xs font-semibold tracking-wide uppercase hover:underline ${
              p.bracket ? "text-violet-800 dark:text-violet-300" : "text-scenic-navy dark:text-zinc-300"
            }`}
          >
            {p.programName}
            {p.bracket && ` · Brackets ${p.bracketDays.map(shortDate).join(", ")}`}
          </Link>
          {p.bracket && <p className="text-xs text-zinc-500">One event: teams play until they lose</p>}
          {p.teams.length ? (
            byDivision(p.teams).map(([division, teams]) => {
              const playing = teams.filter((t) => !t.removedBy && !t.out).length;
              return (
                <div key={division} className="mt-2 overflow-hidden rounded-lg ring-1 ring-zinc-200 dark:ring-white/10">
                  <h3 className="flex items-center justify-between gap-3 bg-zinc-50 px-3 py-1.5 text-sm font-semibold dark:bg-white/5">
                    {division}
                    <span className="text-xs font-normal text-zinc-500">{plural(playing, "team")}</span>
                  </h3>
                  <ul className="divide-y divide-zinc-100 text-sm dark:divide-white/5">
                    {teams.map((t) => (
                      <li key={t.teamId} className="flex items-start gap-3 px-3 py-1.5">
                        <details className="group min-w-0 flex-1">
                          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
                            <span className={`min-w-0 ${t.removedBy || t.out ? "text-zinc-400 line-through" : ""}`}>
                              <span className="mr-1 inline-block text-zinc-400 transition group-open:rotate-90">›</span>
                              <TeamName name={t.name} className="font-medium" />{" "}
                              <span className="text-xs text-zinc-500">
                                {t.group} · {t.from}
                              </span>
                            </span>
                            <span
                              className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                t.note === "2GG"
                                  ? "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
                                  : t.note === "Bracket"
                                    ? "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300"
                                    : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                              }`}
                            >
                              {t.note}
                            </span>
                          </summary>
                          {!p.bracket && <TeamGames team={t} date={p.date} games={p.teamGames[t.teamId] ?? []} />}
                        </details>
                        {!t.removedBy && (
                          <TeamOffButton
                            programId={p.programId}
                            teamId={t.teamId}
                            name={t.name}
                            what={p.bracket ? "brackets" : p.date}
                            label={p.bracket ? "the Brackets" : shortDate(p.date)}
                            out={!!t.out}
                          />
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })
          ) : (
            <p className="mt-1 text-sm text-zinc-500">No teams yet.</p>
          )}
        </div>
      ))}
    </div>
  );
}

// Matchups: each League's divisions playing that day, expandable. Each has Create matchups (Admins and Directors of
// Scheduling; the page is theirs only), its games (a vs b, by grade group), pairs that also meet on another Game Day,
// and teams still short of their games guaranteed.
function Matchups({ day }: { day: ScheduleDay }) {
  const leagues = day.programs.filter((p) => !p.bracket);
  if (!leagues.length) return <p className="py-6 text-center text-sm text-zinc-500">The Brackets are set up separately.</p>;
  return (
    <div className="space-y-4">
      {leagues.map((p) => (
        <div key={p.programId}>
          {day.programs.length > 1 && (
            <Link
              href={`/org/scenic-city/programs/${p.programId}`}
              className="text-xs font-semibold tracking-wide text-scenic-navy uppercase hover:underline dark:text-zinc-300"
            >
              {p.programName}
            </Link>
          )}
          {!p.teams.length && <p className="mt-1 text-sm text-zinc-500">No teams yet.</p>}
          <div className="mt-1 space-y-2">
            {byDivision(p.teams).map(([division, teams]) => {
              const divisionId = teams[0].divisionId;
              const team = new Map(teams.map((t) => [t.teamId, t]));
              const games = p.matchups
                .filter((m) => m.divisionId === divisionId)
                .map((m) => ({ ...m, ta: team.get(m.a), tb: m.b ? team.get(m.b) : undefined }))
                .sort(
                  (x, y) =>
                    (x.ta?.groupGrade ?? 99) - (y.ta?.groupGrade ?? 99) || (x.ta?.name ?? "").localeCompare(y.ta?.name ?? ""),
                );
              const playing = teams.filter((t) => !t.removedBy && !t.out);
              const count = (id: string) => games.filter((m) => m.a === id || m.b === id).length;
              const short = games.length ? playing.filter((t) => count(t.teamId) < t.entry!.perDate[p.date]) : [];
              const status = !games.length
                ? "Not created"
                : `${games.length} matchup${games.length === 1 ? "" : "s"}${short.length ? ` · ${short.length} short` : ""}`;
              return (
                <details key={division} className="group overflow-hidden rounded-lg ring-1 ring-zinc-200 dark:ring-white/10">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 bg-zinc-50 px-3 py-2 dark:bg-white/5 [&::-webkit-details-marker]:hidden">
                    <span className="text-sm font-semibold">
                      <span className="mr-1 inline-block text-zinc-400 transition group-open:rotate-90">›</span>
                      {division}
                    </span>
                    <span
                      className={`shrink-0 text-xs ${games.length && !short.length ? "text-emerald-700 dark:text-emerald-300" : "text-zinc-500"}`}
                    >
                      {plural(playing.length, "team")} · {status}
                    </span>
                  </summary>
                  <div className="px-3 py-3">
                    <MatchupBoard
                      key={games.map((m) => m.id).join(",") || "none"}
                      programId={p.programId}
                      day={p.date}
                      divisionId={divisionId}
                      division={division}
                      teams={playing.map((t) => ({ id: t.teamId, name: t.name, group: t.group, need: t.entry!.perDate[p.date] }))}
                      initial={games.map((m) => ({
                        a: m.ta && !m.ta.removedBy && !m.ta.out ? m.a : null,
                        b: m.tb && !m.tb.removedBy && !m.tb.out ? m.b : null,
                        home: m.home,
                      }))}
                      otherDays={p.otherDays}
                    />
                    {games.length > 0 && <p className="mt-2 text-xs text-zinc-500">Last saved by {games[0].createdBy}</p>}
                  </div>
                </details>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// A team's matchups on each Game Day it plays in this League, by date (this day highlighted): its opponents, or
// "No matchup yet" for each game guaranteed without one; days it's out of say so.
function TeamGames({ team, date, games }: { team: DateTeam; date: string; games: ScheduledGame[] }) {
  const days = [...new Set([...Object.keys(team.entry?.perDate ?? {}), ...games.map((g) => g.date)])].sort();
  if (!days.length) return <p className="mt-1 ml-4 text-xs text-zinc-500">No Game Days.</p>;
  return (
    <ul className="mt-1.5 mb-1 ml-4 space-y-1 border-l-2 border-zinc-200 pl-3 text-xs dark:border-white/10">
      {days.map((d) => {
        const on = games.filter((g) => g.date === d);
        const missing = Math.max(0, (team.entry?.perDate[d] ?? 0) - on.length);
        const off = team.off[d];
        return (
          <li key={d} className={`flex gap-2 ${d === date ? "font-semibold" : ""}`}>
            <span className={`w-12 shrink-0 ${d === date ? "text-scenic-navy dark:text-white" : "text-zinc-500"}`}>
              {shortDate(d)}
            </span>
            <span className="min-w-0">
              {off ? (
                <span className="text-zinc-400">Out (by {off})</span>
              ) : (
                <>
                  {on.map((g) => (
                    <span key={g.opponent} className="mb-0.5 block">
                      <HomeAway home={g.home} /> vs <TeamName name={g.opponent} />{" "}
                      <span className="font-normal text-zinc-500">{g.opponentGroup}</span>
                      <GamePlace g={g} />
                    </span>
                  ))}
                  {Array.from({ length: missing }, (_, i) => (
                    <span key={i} className="block font-normal text-zinc-400 italic">
                      No matchup yet
                    </span>
                  ))}
                </>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// Grid: the game length at the top, then each gym open that Game Day (collapsed: host, courts, hours, games).
// Expanded: rows of game blocks from when the gym opens, a column per court; a court's blocks outside its hours are
// closed.
function Grid({ day, grid }: { day: ScheduleDay; grid: DayGrid }) {
  // The day's games (both teams still playing), each League's divisions in order, with their slot on the grid.
  const team = (t: DateTeam) => ({
    id: t.teamId,
    name: t.name,
    partnerId: t.partnerId,
    group: t.group,
    division: t.divisionName,
    from: t.from,
    grade: t.groupGrade,
  });
  const games = day.programs
    .filter((p) => !p.bracket)
    .flatMap((p) => {
      const byId = new Map(p.teams.map((t) => [t.teamId, t]));
      const inPlay = (id: string) => {
        const t = byId.get(id);
        return t && !t.removedBy && !t.out ? t : null;
      };
      return p.matchups.flatMap((m) => {
        const a = inPlay(m.a);
        const b = m.b ? inPlay(m.b) : null;
        // Both teams still playing (or one against TBD); the home side first.
        if (!a || (m.b && !b)) return [];
        const [home, away] = m.home === "b" ? [b, a] : [a, b];
        return [
          {
            id: m.id,
            home: home ? team(home) : null,
            away: away ? team(away) : null,
            league: day.programs.length > 1 ? p.programName : null,
            court: m.court,
            starts: m.starts,
          },
        ];
      });
    })
    // Youngest grade first (K, 1st, 2nd…), Boys before Girls (their division names start with it), then the grade group (COMP, REC) and the home team's name.
    .sort((x, y) => {
      const [p, q] = [(x.home ?? x.away)!, (y.home ?? y.away)!];
      return (
        p.grade - q.grade ||
        p.division.localeCompare(q.division) ||
        p.group.localeCompare(q.group) ||
        p.name.localeCompare(q.name)
      );
    });
  const gyms = grid.gyms.map((g) => {
    const opens = g.courts.reduce((m, c) => (c.starts < m ? c.starts : m), "23:59");
    const closes = g.courts.reduce((m, c) => (c.ends > m ? c.ends : m), "00:00");
    return { ...g, opens, closes, blocks: gridBlocks(opens, closes, grid.minutes) };
  });
  return (
    <div className="space-y-3">
      {!grid.gyms.length && (
        <p className="py-4 text-center text-sm text-zinc-500">
          No gyms are open this Game Day yet. Hosting sites add their hours under Facilities.
        </p>
      )}
      <GridBoard gyms={gyms} games={games} minutes={grid.minutes} />
    </div>
  );
}

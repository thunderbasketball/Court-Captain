import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { currentScenic } from "@/lib/contexts-server";
import { db } from "@/lib/db";
import { coachGroups, sharedCoaches } from "@/lib/coach-groups";
import { listBindings, type Binding } from "@/lib/scenic-bindings";
import { BindPicker, UnbindButton } from "./BindingsBoard";
import { seesWho } from "@/lib/org-admin";
import { requireFeature } from "@/lib/features-server";
import { shortDate } from "@/lib/program-options";
import { dayGrid, gameLength, gymBlocks, programGameLength, type DayGrid } from "@/lib/scenic-grid";
import { gameDaySchedule, type DateTeam, type ScheduleDay } from "@/lib/scenic-programs";
import AppHeader from "../../../AppHeader";
import { CoachBadge, LevelTag, PageTitle, TeamName, card, type CoachTag } from "../../../ui";
import { PublishSchedule, TeamOffButton } from "../programs/ProgramTools";
import { canPublish, schedulePublished } from "@/lib/public-league";
import { MatchupBoard } from "./MatchupBoard";
import { GamePlace, HomeAway } from "../../../LeagueGames";
import type { ScheduledGame } from "@/lib/scenic-games";
import { GameDayGear, ProgramGear } from "./GameLengthInput";
import { GridBoard } from "./GridBoard";
import { SimulationToggle } from "./SimulationToggle";
import { CreateAllMatchups } from "./CreateAllMatchups";
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
  { key: "bindings", label: "Bindings" },
] as const;
type View = (typeof VIEWS)[number]["key"];
const href = (program: string, day: string, view: View) =>
  `/org/scenic-city/scheduler?program=${program}&day=${day}${view === "teams" ? "" : `&view=${view}`}`;

// Scenic City's Scheduler (Admins and Directors of Scheduling, on the Director chip; SPEC.md section 13, step 7).
// A tab for each upcoming Game Day (the next one first picked), and inside it Teams, Matchups, Grid and Bindings.
async function Scheduler({ searchParams }: { searchParams: PageProps<"/org/scenic-city/scheduler">["searchParams"] }) {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  await requireFeature("scenic-city", "programs");
  const scenic = await currentScenic(user);
  if (!scenic || scenic.role !== "Director") redirect("/");
  const s = await gameDaySchedule({ pool: db, now: () => new Date() }, user);
  if (!s) redirect("/org/scenic-city");
  const who = await seesWho(db, user, "scenic-city"); // Owners and Admins see who did it
  const q = await searchParams;
  // Only a listed Game Day or view is used; anything else falls back to the next Game Day's Teams.
  // The program being scheduled (picked at the top; the soonest League first): only its Game Days and teams show.
  const programs = [
    ...new Map(
      s.days.flatMap((d) => d.programs.map((p) => [p.programId, { id: p.programId, name: p.programName }] as const)),
    ).values(),
  ];
  const program = programs.find((p) => p.id === q.program) ?? programs[0];
  const days = s.days
    .map((d) => {
      const mine = d.programs.filter((p) => p.programId === program?.id);
      return {
        ...d,
        programs: mine,
        playing: mine.reduce((n, p) => n + p.playing, 0),
        games: mine.reduce((n, p) => n + p.games, 0),
      };
    })
    .filter((d) => d.programs.length);
  const [sim, programLength] = await Promise.all([
    simulatedTeams(db),
    program ? programGameLength({ pool: db, now: () => new Date() }, user, program.id) : null,
  ]);
  const simOn = !!program && sim.teams > 0 && sim.programId === program.id;
  const publishing = program
    ? { can: await canPublish(db, user), by: (await schedulePublished(db, program.id))?.by ?? null }
    : { can: false, by: null };
  const day = days.find((d) => d.date === q.day) ?? days.find((d) => d.date >= s.today) ?? days[0];
  const view: View = VIEWS.find((v) => v.key === q.view)?.key ?? "teams";
  const grid = day && view === "grid" ? await dayGrid({ pool: db, now: () => new Date() }, user, day.date) : null;
  const length = day ? await gameLength({ pool: db, now: () => new Date() }, user, day.date) : null;
  const bound = day && view === "bindings" ? await listBindings({ pool: db, now: () => new Date() }, user) : null;

  return (
    <>
      <AppHeader user={user} context={scenic.key} tab="scheduler" />
      {/* Yellow while the program being scheduled is in Simulation mode. */}
      <div className={`flex flex-1 flex-col ${simOn ? "bg-amber-100 dark:bg-amber-950/40" : ""}`}>
        <main className="mx-auto w-full max-w-3xl flex-1 space-y-4 px-4 py-6">
          <PageTitle title="Scheduler" subtitle="Each Game Day across every League: its teams, matchups and grid." />
          {program && (
            <div>
              {/* Each program is its own tab (the soonest League first). */}
              <nav aria-label="Program" className="flex gap-1 overflow-x-auto border-b border-zinc-200 dark:border-white/10">
                {programs.map((p) => (
                  <Link
                    key={p.id}
                    href={`/org/scenic-city/scheduler?program=${p.id}`}
                    aria-current={p.id === program.id ? "page" : undefined}
                    className={`shrink-0 border-b-2 px-3 py-2 text-sm font-semibold ${
                      p.id === program.id
                        ? "border-thunder-orange text-zinc-900 dark:text-white"
                        : "border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
                    }`}
                  >
                    {p.name}
                  </Link>
                ))}
              </nav>
              <div className="mt-3 flex items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  {publishing.can && (
                    // Publish schedule: the League's games on the public League page (Directors of Programs or Scheduling).
                    <PublishSchedule programId={program.id} by={publishing.by} who={who} />
                  )}
                  {programLength && <span className="text-xs text-zinc-500">{programLength.minutes}-min games</span>}
                </div>
                {programLength && (
                  <ProgramGear
                    programId={program.id}
                    programName={program.name}
                    minutes={programLength.minutes}
                    setBy={who ? programLength.setBy : null}
                    simulation={
                      <SimulationToggle
                        teams={sim.teams}
                        inProgram={sim.programId}
                        inProgramName={sim.programName}
                        programId={program.id}
                        programName={program.name}
                      />
                    }
                  />
                )}
              </div>
            </div>
          )}
          {simOn && (
            <p className="rounded-xl border border-dashed border-amber-500 bg-amber-100 px-3 py-2 text-sm font-semibold text-amber-900 dark:border-amber-400/60 dark:bg-amber-500/15 dark:text-amber-200">
              Simulation mode · {sim.teams} (DEV) teams in {program!.name}. Turn it off in the gear.
            </p>
          )}
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
                {days.map((d) => (
                  <Link
                    key={d.date}
                    href={href(program!.id, d.date, view)}
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
                  <div className="flex shrink-0 items-start gap-1">
                    <p className="text-right text-xs text-zinc-500">
                      {plural(day.playing, "team")}
                      {day.games > 0 && <span className="block">{plural(day.games, "game")} guaranteed</span>}
                      {length && (
                        <span className="block">
                          {length.breaks ? "Custom times" : `${length.minutes}-min games`}
                          {length.override && (
                            <span className="font-semibold text-amber-700 dark:text-amber-300"> · override</span>
                          )}
                        </span>
                      )}
                    </p>
                    {length && (
                      <GameDayGear
                        day={day.date}
                        label={weekday(day.date)}
                        minutes={length.minutes}
                        programMinutes={length.programMinutes}
                        programName={length.programName}
                        override={length.override}
                        breaks={length.breaks}
                        opens={length.opens}
                        closes={length.closes}
                        setBy={who ? length.setBy : null}
                      />
                    )}
                  </div>
                </div>

                <nav aria-label="Game Day views" className="mx-4 mt-3 flex rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800">
                  {VIEWS.map((v) => (
                    <Link
                      key={v.key}
                      href={href(program!.id, day.date, v.key)}
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
                    <Teams day={day} coaches={coachTags(day)} who={who} />
                  ) : view === "matchups" ? (
                    <Matchups day={day} coaches={coachTags(day)} who={who} />
                  ) : view === "bindings" ? (
                    <Bindings day={day} coaches={coachTags(day)} bound={bound ?? []} who={who} />
                  ) : grid ? (
                    <Grid day={day} grid={grid} coaches={coachTags(day)} />
                  ) : (
                    <p className="py-6 text-center text-sm text-zinc-500">This Game Day&apos;s grid isn&apos;t available.</p>
                  )}
                </div>
              </section>
            </>
          )}
        </main>
      </div>
    </>
  );
}

// A League's teams that day, grouped by division in the League's order (Boys then Girls, youngest first).
function byDivision(teams: DateTeam[]): [string, DateTeam[]][] {
  const groups = new Map<string, DateTeam[]>();
  for (const t of teams) groups.set(t.divisionName, [...(groups.get(t.divisionName) ?? []), t]);
  return [...groups];
}

// Teams playing that day (every League) that share a coach, Head or Assistant: each group gets a color (in name order)
// and a tag on each of its teams naming who coaches which other teams.
function coachTags(day: ScheduleDay): Map<string, CoachTag> {
  const teams = day.programs.filter((p) => !p.bracket).flatMap((p) => p.teams.filter((t) => !t.removedBy && !t.out));
  const multi = coachGroups(teams)
    .map((list) => ({ list, people: sharedCoaches(list) }))
    .sort(
      (x, y) =>
        (x.people[0]?.name ?? "").localeCompare(y.people[0]?.name ?? "") || x.list[0].teamId.localeCompare(y.list[0].teamId),
    );
  const tags = new Map<string, CoachTag>();
  multi.forEach(({ list, people }, color) => {
    const name = people[0]?.name ?? "Their coach";
    const initials = name
      .split(/\s+/)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("")
      .slice(0, 3);
    for (const t of list)
      tags.set(t.teamId, {
        color,
        initials,
        // "Sam Lee (Asst) also coaches 3B Lee · Ann Fox also coaches 5G Fox"
        title:
          people
            .filter((c) => c.teams.includes(t.teamId))
            .map((c) => {
              const asst = !t.coaches.find((x) => x.key === c.key)?.head;
              const others = list.filter((x) => x !== t && c.teams.includes(x.teamId)).map((x) => x.name);
              if (c.key.startsWith("b:")) return `Bound by hand to ${others.join(", ")} (${c.name})`;
              return `${c.name}${asst ? " (Asst)" : ""} also coaches ${others.join(", ")}`;
            })
            .join(" · ") ||
          `Shares coaches with ${list
            .filter((x) => x !== t)
            .map((x) => x.name)
            .join(", ")}`,
      });
  });
  return tags;
}

// Bindings: every group of teams playing that day that are bound (they share a Head or Assistant Coach, or were bound
// by hand), with what binds them; then binding teams by hand (pick 2+ teams, an optional reason) and every binding made
// by hand (Unbind). Bound teams are all home or all away and never play at the same time.
function Bindings({
  day,
  coaches,
  bound,
  who,
}: {
  day: ScheduleDay;
  coaches: Map<string, CoachTag>;
  bound: Binding[];
  who: boolean;
}) {
  const teams = day.programs.filter((p) => !p.bracket).flatMap((p) => p.teams.filter((t) => !t.removedBy && !t.out));
  const byId = new Map(bound.map((b) => [`b:${b.id}`, b]));
  const groups = coachGroups(teams)
    .map((list) => ({ list, people: sharedCoaches(list) }))
    .sort((x, y) => (coaches.get(x.list[0].teamId)?.color ?? 0) - (coaches.get(y.list[0].teamId)?.color ?? 0));
  const role = (t: DateTeam, key: string) => (t.coaches.find((c) => c.key === key)?.head ? "Head Coach" : "Assistant Coach");
  const names = (b: Binding) => b.teams.map((t) => t.name).join(", ");
  return (
    <div className="space-y-4">
      <section>
        <h3 className="text-sm font-semibold">Bound teams playing this day ({groups.reduce((n, g) => n + g.list.length, 0)})</h3>
        {!groups.length && <p className="mt-1 text-sm text-zinc-500">No bound teams this day.</p>}
        <ul className="mt-2 space-y-2">
          {groups.map(({ list, people }) => (
            <li key={list[0].teamId} className="rounded-xl p-3 ring-1 ring-zinc-950/10 dark:ring-white/15">
              <ul className="flex flex-wrap gap-1.5">
                {list.map((t) => (
                  <li key={t.teamId} className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs dark:bg-white/10">
                    <TeamName name={t.name} className="font-semibold" /> <CoachBadge tag={coaches.get(t.teamId)} />{" "}
                    <LevelTag level={t.level} /> <span className="text-zinc-500">· {t.divisionName}</span>
                  </li>
                ))}
              </ul>
              <ul className="mt-2 space-y-1 text-sm">
                {people.map((c) => {
                  const on = list.filter((t) => c.teams.includes(t.teamId));
                  const b = byId.get(c.key);
                  return (
                    <li key={c.key} className="flex items-start justify-between gap-2">
                      {c.key.startsWith("b:") ? (
                        <span>
                          <span className="font-semibold">Bound by hand</span>
                          {b?.reason && <>: {b.reason}</>} · {on.map((t) => t.name).join(", ")}
                          {who && b && <span className="block text-xs text-zinc-500">by {b.setBy}</span>}
                        </span>
                      ) : (
                        <span>
                          <span className="font-semibold">{c.name}</span>:{" "}
                          {(["Head Coach", "Assistant Coach"] as const)
                            .map((r) => [r, on.filter((t) => role(t, c.key) === r).map((t) => t.name)] as const)
                            .filter(([, ts]) => ts.length)
                            .map(([r, ts]) => `${r} of ${ts.join(", ")}`)
                            .join(" · ")}
                        </span>
                      )}
                      {b && <UnbindButton id={b.id} teams={names(b)} />}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3 className="text-sm font-semibold">Bind teams by hand</h3>
        <p className="mb-2 text-xs text-zinc-500">
          Pick two or more teams playing this day. Bound teams are kept all home or all away (away: the same organization if
          possible), share one badge, and never play at the same time, on every Game Day until unbound.
        </p>
        <BindPicker
          teams={teams
            .map((t) => ({ id: t.teamId, name: t.name, division: t.divisionName, from: t.from }))
            .sort((a, b) => a.name.localeCompare(b.name))}
        />
      </section>
      <section>
        <h3 className="text-sm font-semibold">All bindings made by hand ({bound.length})</h3>
        {!bound.length && <p className="mt-1 text-sm text-zinc-500">None yet.</p>}
        <ul className="mt-1 divide-y divide-zinc-100 dark:divide-white/5">
          {bound.map((b) => (
            <li key={b.id} className="flex items-start justify-between gap-2 py-2 text-sm">
              <span>
                {names(b)}
                {b.reason && <span className="text-zinc-500"> · {b.reason}</span>}
                {who && <span className="block text-xs text-zinc-500">by {b.setBy}</span>}
              </span>
              <UnbindButton id={b.id} teams={names(b)} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

// Teams: each League's teams that day by division (each with its grade group and where it's from) with 1GG/2GG;
// Sit out / Back in as on the program page.
function Teams({ day, coaches, who }: { day: ScheduleDay; coaches: Map<string, CoachTag>; who: boolean }) {
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
                              <TeamName name={t.name} className="font-medium" /> <CoachBadge tag={coaches.get(t.teamId)} />{" "}
                              <LevelTag level={t.level} />{" "}
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
                          {!p.bracket && <TeamGames team={t} date={p.date} games={p.teamGames[t.teamId] ?? []} who={who} />}
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
function Matchups({ day, coaches, who }: { day: ScheduleDay; coaches: Map<string, CoachTag>; who: boolean }) {
  const leagues = day.programs.filter((p) => !p.bracket);
  if (!leagues.length) return <p className="py-6 text-center text-sm text-zinc-500">The Brackets are set up separately.</p>;
  return (
    <div className="space-y-4">
      <CreateAllMatchups
        day={day.date}
        programId={day.programs[0].programId}
        label={weekday(day.date)}
        created={leagues.some((p) => p.matchups.length > 0)}
      />
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
                      teams={playing.map((t) => ({
                        id: t.teamId,
                        name: t.name,
                        group: t.group,
                        level: t.level,
                        coach: coaches.get(t.teamId),
                        need: t.entry!.perDate[p.date],
                      }))}
                      // The home team always on the left (a TBD game whose team is away: TBD on the left).
                      initial={games.map((m) => {
                        const a = m.ta && !m.ta.removedBy && !m.ta.out ? m.a : null;
                        const b = m.tb && !m.tb.removedBy && !m.tb.out ? m.b : null;
                        return m.home === "b" ? { a: b, b: a, home: "a" as const } : { a, b, home: "a" as const };
                      })}
                      otherDays={p.otherDays}
                    />
                    {who && games.length > 0 && <p className="mt-2 text-xs text-zinc-500">Last saved by {games[0].createdBy}</p>}
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
function TeamGames({ team, date, games, who }: { team: DateTeam; date: string; games: ScheduledGame[]; who: boolean }) {
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
                <span className="text-zinc-400">Out{who && ` (by ${off})`}</span>
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
function Grid({ day, grid, coaches }: { day: ScheduleDay; grid: DayGrid; coaches: Map<string, CoachTag> }) {
  // The day's games (both teams still playing), each League's divisions in order, with their slot on the grid.
  const team = (t: DateTeam) => ({
    id: t.teamId,
    name: t.name,
    partnerId: t.partnerId,
    group: t.group,
    division: t.divisionName,
    from: t.from,
    grade: t.groupGrade,
    level: t.level,
    coach: coaches.get(t.teamId),
    people: t.coaches.map((c) => c.key),
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
            divisionId: m.divisionId,
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
    return { ...g, opens, closes, blocks: gymBlocks(grid, opens, closes) };
  });
  return (
    <div className="space-y-3">
      {!grid.gyms.length && (
        <p className="py-4 text-center text-sm text-zinc-500">
          No gyms are open this Game Day yet. Hosting sites add their hours under Facilities.
        </p>
      )}
      <GridBoard
        gyms={gyms}
        games={games}
        minutes={grid.minutes}
        divisions={Object.fromEntries(
          day.programs.flatMap((p) =>
            p.teams.map((t) => [t.divisionId, day.programs.length > 1 ? `${t.divisionName} (${p.programName})` : t.divisionName]),
          ),
        )}
      />
    </div>
  );
}

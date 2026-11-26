import { requestsOff, type AskedOff } from "@/lib/schedule-requests";
import type { SessionUser } from "@/lib/auth/service";
import { Suspense, cache } from "react";
import SubCard from "../../../SubCard";
import RemovalRequests from "./RemovalRequests";
import GamesToCorrect from "./GamesToCorrect";
import { gamesToCorrect } from "@/lib/schedule-corrections";
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
import { PublishToggle, TeamOffButton } from "../programs/ProgramTools";
import { canPublish, publishedLevels } from "@/lib/public-league";
import { timeLabel } from "@/lib/time";
import { MatchupBoard } from "./MatchupBoard";
import { GamePlace, HomeAway } from "../../../LeagueGames";
import type { ScheduledGame } from "@/lib/scenic-games";
import { GameDayGear, ProgramGear } from "./GameLengthInput";
import { GridBoard } from "./GridBoard";
import { CreateAllMatchups } from "./CreateAllMatchups";

import { PageFrame } from "../../../ui";
import { hasFeature } from "@/lib/features";

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
  { key: "grid", label: "Scheduling" },
  { key: "bindings", label: "Bindings" },
] as const;
type View = (typeof VIEWS)[number]["key"];

// Scenic City's Scheduler (Admins and Directors of Scheduling, on the Director chip; SPEC.md section 13, step 7).
// A tab for each upcoming Game Day (the next one first picked), and inside it Teams, Matchups, Grid and Bindings.
export async function SchedulerContent({
  searchParams = Promise.resolve({}),
  embedded = false,
  programId,
}: {
  searchParams?: PageProps<"/org/scenic-city/scheduler">["searchParams"];
  embedded?: boolean; // inside a Home card: no header or page frame, and never sends you away
  programId?: string; // only this program (its Scheduler card under Programs): no title or program tabs
} = {}) {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  if (embedded) {
    if (!(await hasFeature(db, "scenic-city", "programs"))) return null;
  } else await requireFeature("scenic-city", "programs");
  const scenic = await currentScenic(user);
  if (!scenic || scenic.role !== "Director") {
    if (embedded) return null;
    redirect("/");
  }
  const s = await gameDaySchedule({ pool: db, now: () => new Date() }, user);
  if (!s) {
    if (embedded) return null;
    redirect("/org/scenic-city");
  }
  const who = await seesWho(db, user, "scenic-city"); // Owners and Admins see who did it
  const q = await searchParams;
  // Only a listed Game Day or view is used; anything else falls back to the next Game Day's Teams.
  // The program being scheduled (picked at the top; the soonest League first): only its Game Days and teams show.
  const programs = [
    ...new Map(
      s.days.flatMap((d) => d.programs.map((p) => [p.programId, { id: p.programId, name: p.programName }] as const)),
    ).values(),
  ];
  const program = programId ? programs.find((p) => p.id === programId) : (programs.find((p) => p.id === q.program) ?? programs[0]);
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
  const programLength = program ? await programGameLength({ pool: db, now: () => new Date() }, user, program.id) : null;
  // Each Game Day (and the Brackets) publishes REC and COMP each on its own (Directors of Programs or Scheduling).
  const [mayPublish, published] = program ? await Promise.all([canPublish(db, user), publishedLevels(db, program.id)]) : [false, new Map<string, string>()];
  // Games to correct: a team's grade, level or gender changed after they were made (id → why).
  const wrong: Wrong = new Map((program ? await gamesToCorrect(db, { programId: program.id }, new Date()) : []).map((g) => [g.id, g.why.join("; ")]));
  const day = days.find((d) => d.date === q.day) ?? days.find((d) => d.date >= s.today) ?? days[0];
  const view: View = VIEWS.find((v) => v.key === q.view)?.key ?? "teams";

  return (
    <>
      {!embedded && <AppHeader user={user} context={scenic.key} tab="scheduler" />}
      <div className="flex flex-1 flex-col">
        <PageFrame embedded={embedded} className="mx-auto w-full max-w-3xl flex-1 space-y-4 px-4 py-6 lg:max-w-6xl">
          {!programId && <PageTitle title="Scheduler" subtitle="Each Game Day across every League: its teams, matchups and grid." />}
          {program && (
            <div>
              {!programId && (
                <>
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
                </>
              )}
              <div className={`${programId ? "" : "mt-3 "}flex items-center justify-between gap-3`}>
                <div className="flex flex-wrap items-center gap-2">
                  <a href={`/league/scenic-city?l=${program.id}`} target="_blank" className="text-sm text-thunder-blue hover:underline dark:text-blue-400">
                    Public page ↗
                  </a>
                  {programLength && <span className="text-xs text-zinc-500">{programLength.minutes}-min games</span>}
                </div>
                {programLength && (
                  <ProgramGear
                    programId={program.id}
                    programName={program.name}
                    minutes={programLength.minutes}
                    setBy={who ? programLength.setBy : null}
                  />
                )}
              </div>
            </div>
          )}
          {/* Teams asking to come off this League's schedule (Directors of Scheduling; flashes while any wait). */}
          {program && (
            <Suspense fallback={null}>
              <GamesToCorrect programId={program.id} />
              <RemovalRequests programId={program.id} />
            </Suspense>
          )}
          {!day ? (
            <p className={`${card} px-4 py-3 text-sm text-zinc-500`}>
              No upcoming Game Days. A Director of Programs adds them on each League&apos;s page.
            </p>
          ) : (
            <>
              {/* Each Game Day its own card (the next one open), holding Teams, Matchups, Grid and Bindings cards that open on
                  their own. Teams and Matchups are here already; each day's Grid and the Bindings load in the background. */}
              {days.map((d) => {
                const coaches = coachTags(d);
                const here = d.date === day.date;
                // REC and COMP, each with its own Publish toggle and numbers, tinted green once published, red until then.
                const levels = (["REC", "COMP"] as const).filter((l) => d.programs.some((p) => p.teams.some((t) => t.level === l)));
                const on = levels.length > 0 && levels.every((l) => published.has(`${d.date} ${l}`));
                const some = levels.some((l) => published.has(`${d.date} ${l}`));
                return (
                  // All published: green; none: red; some: plain (each level is tinted inside).
                  <details
                    key={d.date}
                    id={`day-${d.date}`}
                    className={`rounded-2xl shadow-sm ring-1 ${on ? "bg-emerald-50 ring-emerald-300 dark:bg-emerald-500/10 dark:ring-emerald-500/40" : some ? "bg-white ring-zinc-950/10 dark:bg-zinc-900 dark:ring-white/10" : "bg-red-50 ring-red-200 dark:bg-red-500/10 dark:ring-red-500/30"} group overflow-hidden`}
                    open={here}
                  >
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 select-none [&::-webkit-details-marker]:hidden">
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold">
                          {weekday(d.date, true)}
                        </span>
                        <span className="block text-xs text-zinc-500">
                          {d.programs.map((p) => (p.bracket ? `${p.programName} Brackets` : p.programName)).join(" · ")} ·{" "}
                          {d.programs.some((p) => p.bracket) ? "Brackets" : plural(d.playing, "team")}
                          {d.games > 0 && ` · ${plural(d.games, "game")} guaranteed`}
                        </span>
                        <span className="mt-2 grid gap-2 sm:grid-cols-2">
                          {levels.map((l) => {
                            const by = published.get(`${d.date} ${l}`);
                            const m = dayMetrics(d, l, wrong);
                            return (
                              <span
                                key={l}
                                className={`flex items-start gap-2 rounded-xl p-2 ring-1 ${
                                  by
                                    ? "bg-emerald-100/70 ring-emerald-300 dark:bg-emerald-500/15 dark:ring-emerald-500/40"
                                    : "bg-red-100/70 ring-red-200 dark:bg-red-500/15 dark:ring-red-500/40"
                                }`}
                              >
                                {mayPublish && program && (
                                  <PublishToggle programId={program.id} day={d.date} level={l} label={weekday(d.date)} on={!!by} left={m.left} />
                                )}
                                <span className="min-w-0 flex-1">
                                  <span className="block text-sm font-semibold">
                                    {l}{" "}
                                    <span className={`text-xs ${by ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}>
                                      {by ? `Published${who ? ` by ${by}` : ""}` : "Not published"}
                                    </span>
                                  </span>
                                  {m.chips.length > 0 && (
                                    <span className="mt-1 flex flex-wrap gap-1">
                                      {m.chips.map((c) => (
                                        <span key={c.text} className={`rounded-full px-2 py-0.5 text-xs font-medium ${CHIP[c.tone]}`}>
                                          {c.text}
                                        </span>
                                      ))}
                                    </span>
                                  )}
                                </span>
                              </span>
                            );
                          })}
                        </span>
                      </span>
                      <svg
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        aria-hidden
                        className="size-5 shrink-0 text-zinc-400 transition-transform [details[open]>summary_&]:rotate-180"
                      >
                        <path
                          fillRule="evenodd"
                          d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </summary>
                    <div className="space-y-2 border-t border-zinc-950/5 px-3 py-3 dark:border-white/5">
                      <Suspense fallback={null}>
                        <DayLength user={user} date={d.date} label={weekday(d.date)} who={who} />
                      </Suspense>
                      <SubCard title="Teams" count={d.playing} open={here && view === "teams"}>
                        <Teams day={d} coaches={coaches} who={who} />
                      </SubCard>
                      <SubCard title="Matchups" count={d.games || undefined} open={here && view === "matchups"}>
                        <Matchups day={d} coaches={coaches} who={who} published={levels.filter((l) => published.has(`${d.date} ${l}`))} wrong={wrong} />
                      </SubCard>
                      <SubCard title="Scheduling" open={here && view === "grid"}>
                        <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
                          <DayGridCard user={user} day={d} coaches={coaches} published={levels.filter((l) => published.has(`${d.date} ${l}`))} wrong={wrong} />
                        </Suspense>
                      </SubCard>
                      <SubCard title="Bindings" open={here && view === "bindings"}>
                        <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
                          <DayBindings user={user} day={d} coaches={coaches} who={who} />
                        </Suspense>
                      </SubCard>
                    </div>
                  </details>
                );
              })}
            </>
          )}
        </PageFrame>
      </div>
    </>
  );
}

// Scheduler View (Directors of Scheduling; the link by their name): one Game Day on the whole screen. A slim bar (League, Game
// Days, each level's numbers and Publish), then the day's lists at the left, which fold away, and every gym's courts side by
// side. A phone stacks them. The same rules, checks and saves as the Scheduler.
export async function SchedulerView({ searchParams }: { searchParams: PageProps<"/org/scenic-city/scheduler-view">["searchParams"] }) {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  await requireFeature("scenic-city", "programs");
  const s = await gameDaySchedule({ pool: db, now: () => new Date() }, user); // null: not a Director of Scheduling (or Admin)
  if (!s) redirect("/org/scenic-city");
  const [who, q] = await Promise.all([seesWho(db, user, "scenic-city"), searchParams]);
  const programs = [...new Map(s.days.flatMap((d) => d.programs.map((p) => [p.programId, { id: p.programId, name: p.programName }] as const))).values()];
  const program = programs.find((p) => p.id === q.program) ?? programs[0];
  const days = s.days
    .map((d) => {
      const mine = d.programs.filter((p) => p.programId === program?.id);
      return { ...d, programs: mine, playing: mine.reduce((n, p) => n + p.playing, 0), games: mine.reduce((n, p) => n + p.games, 0) };
    })
    .filter((d) => d.programs.length);
  const [mayPublish, published] = program ? await Promise.all([canPublish(db, user), publishedLevels(db, program.id)]) : [false, new Map<string, string>()];
  // Games to correct: a team's grade, level or gender changed after they were made (id → why).
  const wrong: Wrong = new Map((program ? await gamesToCorrect(db, { programId: program.id }, new Date()) : []).map((g) => [g.id, g.why.join("; ")]));
  const day = days.find((d) => d.date === q.day) ?? days.find((d) => d.date >= s.today) ?? days[0];
  const levelsOf = (d: ScheduleDay) => (["REC", "COMP"] as const).filter((l) => d.programs.some((p) => p.teams.some((t) => t.level === l)));
  const href = (program: string, date?: string) => `/org/scenic-city/scheduler-view?program=${program}${date ? `&day=${date}` : ""}`;
  const coaches = day ? coachTags(day) : new Map<string, CoachTag>();
  const levels = day ? levelsOf(day) : [];
  const done = day ? levels.filter((l) => published.has(`${day.date} ${l}`)) : [];
  return (
    <div className="flex flex-1 flex-col lg:h-dvh lg:flex-none lg:overflow-hidden">
      <header className="space-y-1.5 border-b border-zinc-950/10 bg-white px-3 py-2 dark:border-white/10 dark:bg-zinc-900">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <Link href="/org/scenic-city" className="text-sm font-medium text-thunder-blue hover:underline dark:text-blue-400">
            ← Home
          </Link>
          <h1 className="text-base font-semibold">Scheduler View</h1>
          {user.actingBy && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">Viewing as {user.firstName} · view only</span>}
          <nav aria-label="Program" className="flex gap-1 overflow-x-auto">
            {programs.map((p) => (
              <Link
                key={p.id}
                href={href(p.id)}
                aria-current={p.id === program?.id ? "page" : undefined}
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${p.id === program?.id ? "bg-scenic-navy text-white" : "text-zinc-500 ring-1 ring-zinc-950/10 dark:ring-white/15"}`}
              >
                {p.name}
              </Link>
            ))}
          </nav>
          {day && (
            <Suspense fallback={null}>
              <DayLength user={user} date={day.date} label={weekday(day.date)} who={who} />
            </Suspense>
          )}
        </div>
        {/* Game Days: green once all published, amber when some, red until then. */}
        <nav aria-label="Game Days" className="flex gap-2 overflow-x-auto p-1">
          {days.map((d) => {
            const ls = levelsOf(d);
            const n = ls.filter((l) => published.has(`${d.date} ${l}`)).length;
            const tone =
              ls.length > 0 && n === ls.length
                ? "bg-emerald-50 text-emerald-800 ring-emerald-300 dark:bg-emerald-500/15 dark:text-emerald-300"
                : n
                  ? "bg-amber-50 text-amber-900 ring-amber-300 dark:bg-amber-500/15 dark:text-amber-200"
                  : "bg-red-50 text-red-800 ring-red-200 dark:bg-red-500/15 dark:text-red-300";
            return (
              <Link
                key={d.date}
                href={href(program!.id, d.date)}
                aria-current={d.date === day?.date ? "page" : undefined}
                className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold ring-1 ${tone} ${d.date === day?.date ? "outline-2 outline-offset-1 outline-scenic-navy dark:outline-white" : ""}`}
              >
                {weekday(d.date)}
                {d.programs.some((p) => p.bracket) && " · Brackets"}
              </Link>
            );
          })}
        </nav>
        {day && levels.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {levels.map((l) => {
              const by = published.get(`${day.date} ${l}`);
              const m = dayMetrics(day, l, wrong);
              return (
                <span key={l} className={`flex flex-wrap items-center gap-1.5 rounded-xl px-2 py-1 ring-1 ${by ? "bg-emerald-50 ring-emerald-300 dark:bg-emerald-500/10" : "bg-red-50 ring-red-200 dark:bg-red-500/10"}`}>
                  {mayPublish && <PublishToggle programId={program!.id} day={day.date} level={l} label={weekday(day.date)} on={!!by} left={m.left} />}
                  <span className="text-sm font-semibold">{l}</span>
                  {m.chips.map((c) => (
                    <span key={c.text} className={`rounded-full px-2 py-0.5 text-xs font-medium ${CHIP[c.tone]}`}>
                      {c.text}
                    </span>
                  ))}
                </span>
              );
            })}
          </div>
        )}
      </header>
      {!day ? (
        <p className="p-4 text-sm text-zinc-500">No upcoming Game Days. A Director of Programs adds them on each League&apos;s page.</p>
      ) : (
        <main className="flex flex-col gap-3 p-3 lg:grid lg:min-h-0 lg:flex-1 lg:grid-cols-[auto_minmax(0,1fr)]">
          <details open className="group/list min-w-0 lg:min-h-0 lg:overflow-y-auto lg:open:w-[26rem]">
            <summary className="mb-2 cursor-pointer list-none text-sm font-semibold text-thunder-blue select-none dark:text-blue-400 [&::-webkit-details-marker]:hidden">
              <span className="group-open/list:hidden">» Lists</span>
              <span className="hidden group-open/list:inline">« Hide the lists</span>
            </summary>
            <div className="space-y-2">
              {program && (
                <Suspense fallback={null}>
                  <GamesToCorrect programId={program.id} />
                  <RemovalRequests programId={program.id} />
                </Suspense>
              )}
              <SubCard title="Matchups" count={day.games || undefined} open>
                <Matchups day={day} coaches={coaches} who={who} published={done} wrong={wrong} />
              </SubCard>
              <SubCard title="Teams" count={day.playing}>
                <Teams day={day} coaches={coaches} who={who} />
              </SubCard>
              <SubCard title="Bindings">
                <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
                  <DayBindings user={user} day={day} coaches={coaches} who={who} />
                </Suspense>
              </SubCard>
            </div>
          </details>
          <section aria-label="Gyms" className="min-w-0 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-zinc-950/10 lg:min-h-0 lg:overflow-y-auto dark:bg-zinc-900 dark:ring-white/10">
            <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
              <DayGridCard key={day.date} user={user} day={day} coaches={coaches} published={done} wrong={wrong} wide />
            </Suspense>
          </section>
        </main>
      )}
    </div>
  );
}

const CHIP = {
  good: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
  todo: "bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200",
  plain: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  bad: "bg-red-600 text-white",
} as const;

// A Game Day's numbers for a level, shown while its card is closed: matchups made of those needed (games guaranteed, two teams a game),
// games placed (a court and time), games still TBD, pairs that meet again, courts in use and the first and last start.
// `left`: what isn't done yet (asked about when publishing), or null. The Brackets have none until they're made.
type Wrong = Map<string, string>;
function dayMetrics(d: ScheduleDay, level: string, wrong: Wrong): { chips: { text: string; tone: keyof typeof CHIP }[]; left: string | null } {
  if (d.programs.every((p) => p.bracket)) return { chips: [], left: null };
  const plays = new Set(d.programs.flatMap((p) => p.teams.filter((t) => t.level === level).map((t) => t.teamId)));
  const list = d.programs.flatMap((p) => p.matchups).filter((m) => plays.has(m.a)); // REC never plays COMP
  const games = d.programs
    .filter((p) => !p.bracket)
    .flatMap((p) => p.teams.filter((t) => t.level === level && !t.removedBy && !t.out).map((t) => Number(t.entry?.perDate[p.date] ?? 0)))
    .reduce((n: number, g) => n + g, 0);
  const need = Math.max(Math.ceil(games / 2), list.length);
  const placed = list.filter((m) => m.court && m.starts);
  const tbd = list.filter((m) => !m.b).length;
  const again = list.filter((m) => m.before.length).length;
  const courts = new Set(placed.map((m) => m.court)).size;
  const times = placed.map((m) => m.starts!).sort();
  const chips: { text: string; tone: keyof typeof CHIP }[] = [
    { text: `${list.length} of ${need} matchups`, tone: list.length >= need && need > 0 ? "good" : "todo" },
    { text: `${placed.length} of ${need} scheduled`, tone: placed.length >= need && need > 0 ? "good" : "todo" },
    ...(tbd ? [{ text: `${tbd} TBD`, tone: "todo" as const }] : []),
    ...(again ? [{ text: `${plural(again, "repeat")}`, tone: "plain" as const }] : []),
    ...(courts ? [{ text: plural(courts, "court"), tone: "plain" as const }] : []),
    ...(times.length ? [{ text: `${timeLabel(times[0])} – ${timeLabel(times.at(-1)!)}`, tone: "plain" as const }] : []),
  ];
  const missing = need - placed.length;
  const bad = d.programs.flatMap((p) => p.matchups).filter((m) => wrong.has(m.id) && plays.has(m.a)).length;
  if (bad) chips.unshift({ text: `⚠ ${plural(bad, "game")} to correct`, tone: "bad" });
  const left = [
    ...(bad ? [`${plural(bad, "game")} need${bad === 1 ? "s" : ""} correcting (a team changed grade or level)`] : []),
    ...(missing > 0 ? [`${plural(missing, "game")} of ${need} ${missing === 1 ? "isn't" : "aren't"} scheduled yet`] : []),
  ];
  return { chips, left: left.length ? left.join(", and ") : null };
}

// A League's teams that day, grouped by division in the League's order (Boys then Girls, youngest first).
// A Game Day card's game length and its gear (loads with the day).
async function DayLength({ user, date, label, who }: { user: SessionUser; date: string; label: string; who: boolean }) {
  const length = await gameLength({ pool: db, now: () => new Date() }, user, date);
  if (!length) return null;
  return (
    <div className="flex items-center justify-end gap-1 text-xs text-zinc-500">
      <span>
        {length.breaks ? "Custom times" : `${length.minutes}-min games`}
        {length.override && <span className="font-semibold text-amber-700 dark:text-amber-300"> · override</span>}
      </span>
      <GameDayGear
        day={date}
        label={label}
        minutes={length.minutes}
        programMinutes={length.programMinutes}
        programName={length.programName}
        override={length.override}
        breaks={length.breaks}
        opens={length.opens}
        closes={length.closes}
        setBy={who ? length.setBy : null}
      />
    </div>
  );
}

// A Game Day's grid, loaded in the background.
async function DayGridCard({ user, day, coaches, published, wrong, wide = false }: { user: SessionUser; day: ScheduleDay; coaches: Map<string, CoachTag>; published: string[]; wrong: Wrong; wide?: boolean }) {
  const [grid, off] = await Promise.all([dayGrid({ pool: db, now: () => new Date() }, user, day.date), requestsOff(db, day.date)]);
  return grid ? (
    <Grid day={day} grid={grid} coaches={coaches} published={published} wrong={wrong} wide={wide} off={off} />
  ) : (
    <p className="py-6 text-center text-sm text-zinc-500">This Game Day&apos;s grid isn&apos;t available.</p>
  );
}

// The bound teams (loaded once a page view, shared by every Game Day card).
const boundFor = cache((user: SessionUser) => listBindings({ pool: db, now: () => new Date() }, user));
async function DayBindings({
  user,
  day,
  coaches,
  who,
}: {
  user: SessionUser;
  day: ScheduleDay;
  coaches: Map<string, CoachTag>;
  who: boolean;
}) {
  return <Bindings day={day} coaches={coaches} bound={(await boundFor(user)) ?? []} who={who} />;
}

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
          {p.bracket && <p className="text-xs text-zinc-500">Teams play until they lose</p>}
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
                              <span className="mr-1 inline-block text-zinc-400 transition [details[open]>summary_&]:rotate-90">›</span>
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
function Matchups({ day, coaches, who, published, wrong }: { day: ScheduleDay; coaches: Map<string, CoachTag>; who: boolean; published: string[]; wrong: Wrong }) {
  const leagues = day.programs.filter((p) => !p.bracket);
  if (!leagues.length) return <p className="py-6 text-center text-sm text-zinc-500">The Brackets are set up separately.</p>;
  return (
    <div className="space-y-4">
      <CreateAllMatchups
        day={day.date}
        programId={day.programs[0].programId}
        label={weekday(day.date)}
        levels={("REC COMP".split(" ") as ("REC" | "COMP")[]).flatMap((level) => {
          const ids = new Set(leagues.flatMap((p) => p.teams.filter((t) => t.level === level).map((t) => t.teamId)));
          return ids.size ? [{ level, created: leagues.some((p) => p.matchups.some((m) => ids.has(m.a))), published: published.includes(level) }] : [];
        })}
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
              const anywhere = new Map(p.teams.map((t) => [t.teamId, t]));
              const games = p.matchups
                .filter((m) => m.divisionId === divisionId)
                .map((m) => ({ ...m, ta: team.get(m.a), tb: m.b ? (team.get(m.b) ?? (m.fill ? anywhere.get(m.b) : undefined)) : undefined }))
                .sort(
                  (x, y) =>
                    (x.ta?.groupGrade ?? 99) - (y.ta?.groupGrade ?? 99) || (x.ta?.name ?? "").localeCompare(y.ta?.name ?? ""),
                );
              const playing = teams.filter((t) => !t.removedBy && !t.out);
              const count = (id: string) => games.filter((m) => (m.a === id || m.b === id) && m.fill !== id).length; // a fill-in game is an extra one
              const short = games.length ? playing.filter((t) => count(t.teamId) < t.entry!.perDate[p.date]) : [];
              const status = !games.length
                ? "Not created"
                : `${games.length} matchup${games.length === 1 ? "" : "s"}${short.length ? ` · ${short.length} short` : ""}`;
              return (
                <details key={division} className="group overflow-hidden rounded-lg ring-1 ring-zinc-200 dark:ring-white/10">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 bg-zinc-50 px-3 py-2 dark:bg-white/5 [&::-webkit-details-marker]:hidden">
                    <span className="text-sm font-semibold">
                      <span className="mr-1 inline-block text-zinc-400 transition [details[open]>summary_&]:rotate-90">›</span>
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
                      key={games.map((m) => `${m.id}:${m.b ?? ""}`).join(",") || "none"}
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
                      everyone={p.teams
                        .filter((t) => !t.removedBy && !t.out)
                        .map((t) => ({ id: t.teamId, name: t.name, group: t.group, level: t.level, coach: coaches.get(t.teamId), need: 0, division: t.divisionName }))}
                      // The home team always on the left (a TBD game whose team is away: TBD on the left).
                      initial={games.map((m) => {
                        const a = m.ta && !m.ta.removedBy && !m.ta.out ? m.a : null;
                        const b = m.tb && !m.tb.removedBy && !m.tb.out ? m.b : null; // a fill-in may be from another division
                        const own = { id: m.id, fill: b ? m.fill : null, placed: !!m.court, tbd: m.b === null, wrong: wrong.get(m.id) ?? null };
                        return m.home === "b" ? { ...own, a: b, b: a, home: "a" as const } : { ...own, a, b, home: "a" as const };
                      })}
                      otherDays={p.otherDays}
                      fills={p.fills}
                      published={published}
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
        const missing = Math.max(0, (team.entry?.perDate[d] ?? 0) - on.filter((g) => !g.extra).length);
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
function Grid({ day, grid, coaches, published, wrong, wide, off }: { day: ScheduleDay; grid: DayGrid; coaches: Map<string, CoachTag>; published: string[]; wrong: Wrong; wide: boolean; off: Map<string, AskedOff[]> }) {
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
    off: off.get(t.teamId) ?? [],
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
            level: a.level,
            wrong: wrong.get(m.id) ?? null,
            locked: !!m.court && published.includes(a.level), // published: it stays where it is
          },
        ];
      });
    })
    // The order they're placed in: REC first, youngest to oldest (K, 1st, 2nd…), then COMP, youngest to oldest; Boys before Girls
    // (their division names start with it), then the home team's name.
    .sort((x, y) => {
      const [p, q] = [(x.home ?? x.away)!, (y.home ?? y.away)!];
      return (
        Number(x.level === "COMP") - Number(y.level === "COMP") ||
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
        day={day.date}
        programId={day.programs[0].programId}
        gyms={gyms}
        games={games}
        minutes={grid.minutes}
        wide={wide}
        divisions={Object.fromEntries(
          day.programs.flatMap((p) =>
            p.teams.map((t) => [t.divisionId, day.programs.length > 1 ? `${t.divisionName} (${p.programName})` : t.divisionName]),
          ),
        )}
      />
    </div>
  );
}

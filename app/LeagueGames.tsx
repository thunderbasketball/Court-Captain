import type { ScheduledGame } from "@/lib/scenic-games";
import { shortDate } from "@/lib/program-options";
import type { ReactNode } from "react";
import type { TeamPractice } from "@/lib/practice/schedule";
import type { OwnPractice } from "@/lib/team-practices";
import { easternDate, localParts, timeLabel } from "@/lib/time";
import { TeamName } from "./ui";
import DirectionsLink from "./DirectionsLink";

// Where and when a League game is: "9:00 AM · East Hamilton High School · Main", or not set yet.
export function GamePlace({ g }: { g: ScheduledGame }) {
  return g.starts && g.gym ? (
    <span className="block font-normal text-emerald-800 dark:text-emerald-300">
      {timeLabel(g.starts)} · {g.gym}
      {g.court && ` · ${g.court}`}
      {g.address && <span className="text-zinc-500"> · {g.address}</span>}
      <DirectionsLink href={g.map} />
    </span>
  ) : (
    <span className="block font-normal text-zinc-400 italic">Time and gym not set yet</span>
  );
}

// Home or Away, as a small tag before the opponent.
export function HomeAway({ home }: { home: boolean }) {
  return (
    <span
      className={`rounded px-1 text-[10px] font-bold uppercase ${home ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" : "bg-zinc-100 text-zinc-600 dark:bg-white/10 dark:text-zinc-300"}`}
    >
      {home ? "Home" : "Away"}
    </span>
  );
}

// A team's League games by date (each with its opponent, time and gym), for its team card: collapsed to how many and the
// next one; tap to see them all. Past games are greyed.
export function LeagueGames({ games, today }: { games: ScheduledGame[]; today: string }) {
  if (!games.length) return null;
  const next = games.find((g) => g.date >= today);
  return (
    <details className="group mt-1.5">
      <summary className="cursor-pointer list-none text-xs [&::-webkit-details-marker]:hidden">
        <span className="font-semibold text-scenic-navy dark:text-zinc-200">
          <span className="mr-1 inline-block text-zinc-400 transition [details[open]>summary_&]:rotate-90">›</span>
          {games.length} game{games.length === 1 ? "" : "s"}
        </span>
        {next && (
          <span className="text-zinc-500">
            {" "}
            · next {shortDate(next.date)} vs <TeamName name={next.opponent} />
            {next.starts && next.gym && `, ${timeLabel(next.starts)} at ${next.gym}`}
          </span>
        )}
      </summary>
      <ul className="mt-1 space-y-1 border-l-2 border-zinc-200 pl-3 text-xs dark:border-white/10">
        {games.map((g, i) => (
          <li key={i} className={`flex gap-2 ${g.date < today ? "opacity-50" : ""}`}>
            <span className="w-12 shrink-0 text-zinc-500">{shortDate(g.date)}</span>
            <span className="min-w-0">
              <HomeAway home={g.home} />{" "}
              <span className="font-medium">
                vs <TeamName name={g.opponent} />
              </span>{" "}
              <span className="text-zinc-500">{g.opponentGroup}</span>
              {games.some((x) => x.programId !== g.programId) && <span className="text-zinc-500"> · {g.program}</span>}
              <GamePlace g={g} />
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

// One line of a team's schedule: its date and time for sorting, what shows, and (games and practices) which event it is,
// for attendance.
export type ScheduleItem = { date: string; time: string; node: ReactNode; event: { kind: "slot" | "own" | "game"; id: string } };

// A team's published League games, booked practices and own-gym practices, together by date and time.
export function scheduleItems(games: ScheduledGame[], practices: TeamPractice[], own: OwnPractice[] = []): ScheduleItem[] {
  const items: ScheduleItem[] = [
    ...games.map((g) => ({
      date: g.date,
      time: g.starts ?? "99:99",
      event: { kind: "game" as const, id: g.id },
      node: (
        <>
          <HomeAway home={g.home} />{" "}
          <span className="font-medium">
            vs <TeamName name={g.opponent} />
          </span>{" "}
          <span className="text-xs text-zinc-500">{g.opponentGroup}</span>
          {games.some((x) => x.programId !== g.programId) && <span className="text-xs text-zinc-500"> · {g.program}</span>}
          <GamePlace g={g} />
        </>
      ),
    })),
    ...practices.map((p) => {
      const t = localParts(p.startsAt);
      const time = `${String(t.hour).padStart(2, "0")}:${String(t.minute).padStart(2, "0")}`;
      return {
        date: easternDate(p.startsAt),
        time,
        event: { kind: "slot" as const, id: p.id },
        node: (
          <>
            <span className="rounded bg-blue-100 px-1 text-[10px] font-bold text-blue-800 uppercase dark:bg-blue-500/15 dark:text-blue-300">
              Practice
            </span>{" "}
            <span className="block text-zinc-600 dark:text-zinc-300">
              {timeLabel(time)} · {p.gym} · {p.court}
            </span>
          </>
        ),
      };
    }),
    ...own.map((p) => {
      const hm = (d: Date) => {
        const t = localParts(d);
        return `${String(t.hour).padStart(2, "0")}:${String(t.minute).padStart(2, "0")}`;
      };
      const time = hm(p.startsAt);
      return {
        date: easternDate(p.startsAt),
        time,
        event: { kind: "own" as const, id: p.id },
        node: (
          <>
            <span className="rounded bg-blue-100 px-1 text-[10px] font-bold text-blue-800 uppercase dark:bg-blue-500/15 dark:text-blue-300">
              Practice
            </span>{" "}
            <span className="block text-zinc-600 dark:text-zinc-300">
              {timeLabel(time)}–{timeLabel(hm(new Date(p.startsAt.getTime() + p.minutes * 60_000)))} · {p.location}
            </span>
          </>
        ),
      };
    }),
  ];
  return items.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
}

// A team card's schedule (Teams page, opened by its 📅): its published League games (opponent, time and gym; past ones
// greyed), booked practices (time, gym and court) and own-gym practices (time span and place), by date and time.
export function ScheduleList({
  games,
  practices,
  own = [],
  today,
  empty = "No games published or practices booked yet.",
}: {
  games: ScheduledGame[];
  practices: TeamPractice[];
  own?: OwnPractice[];
  today: string;
  empty?: string;
}) {
  const items = scheduleItems(games, practices, own);
  if (!items.length) return <p className="text-sm text-zinc-500">{empty}</p>;
  return (
    <ul className="divide-y divide-zinc-100 rounded-xl bg-zinc-50 px-3 text-sm dark:divide-white/5 dark:bg-white/5">
      {items.map((x, i) => (
        <li key={i} className={`flex gap-3 py-1.5 ${x.date < today ? "opacity-50" : ""}`}>
          <span className="w-14 shrink-0 text-zinc-500">{shortDate(x.date)}</span>
          <span className="min-w-0">{x.node}</span>
        </li>
      ))}
    </ul>
  );
}

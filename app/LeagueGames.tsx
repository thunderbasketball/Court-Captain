import type { ScheduledGame } from "@/lib/scenic-games";
import { shortDate } from "@/lib/program-options";
import { timeLabel } from "@/lib/time";
import { TeamName } from "./ui";

// Where and when a League game is: "9:00 AM · East Hamilton High School · Main", or not set yet.
export function GamePlace({ g }: { g: ScheduledGame }) {
  return g.starts && g.gym ? (
    <span className="block font-normal text-emerald-800 dark:text-emerald-300">
      {timeLabel(g.starts)} · {g.gym}
      {g.court && ` · ${g.court}`}
      {g.address && <span className="text-zinc-500"> · {g.address}</span>}
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
          <span className="mr-1 inline-block text-zinc-400 transition group-open:rotate-90">›</span>
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

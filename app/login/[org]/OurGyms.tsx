import type { HostDay, PublicGym } from "@/lib/public-org";
import { timeLabel } from "@/lib/time";
import GameShare from "../../GameShare";
import GameItem from "../../GameDetails";
import FinalScore from "../../FinalScore";
import DirectionsLink from "../../DirectionsLink";
import SubCard from "../../SubCard";
import { genderBg, genderOf } from "../../ui";

const weekday = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

// A hosting organization's public page: a card per gym (its address and Directions, and its games on the coming day of
// published games), the gyms with games first; when only one gym has games, its card is open.
export default function OurGyms({ gyms, day }: { gyms: PublicGym[]; day: HostDay | null }) {
  if (!gyms.length) return null;
  const games = day?.games ?? [];
  const gymOf = (x: (typeof games)[number]) => x.gym ?? "Gym to be set";
  // A game at a gym that isn't in the list (renamed since, or not set): its own card, so no game is lost.
  const extra = [...new Set(games.map(gymOf))].filter((n) => !gyms.some((g) => g.name === n)).map((name): PublicGym => ({ name, address: null, map: null }));
  const all = [...gyms, ...extra]
    .map((g) => ({ ...g, games: games.filter((x) => gymOf(x) === g.name) }))
    .sort((a, b) => Number(b.games.length > 0) - Number(a.games.length > 0) || a.name.localeCompare(b.name));
  const busy = all.filter((g) => g.games.length).length;
  return (
    <section id="gyms" className="scroll-mt-4 space-y-2">
      <h2 className="px-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase">Our gyms</h2>
      <div className="space-y-2">
        {all.map((g) => (
          <SubCard key={g.name} title={g.name} count={day && g.games.length ? `${g.games.length} game${g.games.length === 1 ? "" : "s"} ${weekday(day.date)}` : undefined} open={busy === 1 && g.games.length > 0}>
            {g.address && (
              <p className="mb-2 text-xs text-zinc-500">
                {g.address.replace(/, USA$/, "")}
                <DirectionsLink href={g.map} />
              </p>
            )}
            {g.games.length ? (
              <ul className="divide-y divide-zinc-100 text-sm dark:divide-white/5">
                {g.games.map((x, i) => (
                  <GameItem id={x.details ?? null} key={i} className={`flex flex-wrap gap-x-3 rounded-lg px-2 py-2 ${genderBg(genderOf(x.group))}`}>
                    <span className="w-16 shrink-0 font-medium tabular-nums">{x.starts ? timeLabel(x.starts) : "TBA"}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block">
                        <span className="font-medium">{x.away}</span> <span className="text-zinc-500">at</span> <span className="font-medium">{x.home}</span>
                      </span>
                      <span className="block text-xs text-zinc-500">
                        {x.group}
                        {x.court && ` · ${x.court}`}
                      </span>
                      <FinalScore final={x.final} first={x.away} second={x.home} firstIs="away" group={x.group} />
                    </span>
                    {x.hype && !x.final && <GameShare id={x.hype} v={`${x.starts ?? ""}`} text={`GAME DAY · ${x.group}: ${x.away} at ${x.home}`} />}
                  </GameItem>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-zinc-500">{day ? `No games here ${weekday(day.date)}.` : "No games posted yet."}</p>
            )}
          </SubCard>
        ))}
      </div>
    </section>
  );
}

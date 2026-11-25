// A League's gyms on its public view (no login): the League page's Gyms card, and in the League opened on an organization's
// page. No hooks, so server and client pages both use it.
import type { LeagueGym } from "@/lib/league-gyms";
import DirectionsLink from "./DirectionsLink";

const weekday = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

export default function LeagueGyms({ gyms }: { gyms: LeagueGym[] }) {
  if (!gyms.length) return <p className="text-sm text-zinc-600 dark:text-zinc-300">Gyms show here once they&apos;re set for the League&apos;s Game Days.</p>;
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(18rem,100%),1fr))] gap-2">
      {gyms.map((g) => (
        <li key={`${g.name}${g.address ?? ""}`} className="rounded-xl bg-white p-3 ring-1 ring-zinc-950/10 dark:bg-zinc-900 dark:ring-white/10">
          <span className="block font-semibold">{g.name}</span>
          {(g.address || g.map) && (
            <span className="block text-sm text-zinc-600 dark:text-zinc-300">
              {g.address?.replace(/, USA$/, "") ?? "Map"}
              <DirectionsLink href={g.map} />
            </span>
          )}
          <span className="mt-0.5 block text-xs text-zinc-500">
            {g.courts} {g.courts === 1 ? "court" : "courts"} · Hosted by {g.hosts.join(" and ")}
          </span>
          {g.days.length > 0 && (
            <span className="mt-1.5 flex flex-wrap gap-1.5">
              {g.days.map((d) => (
                <span key={d.date} className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-blue-600/20 ring-inset dark:bg-blue-500/10 dark:text-blue-300">
                  {weekday(d.date)} · {d.games} {d.games === 1 ? "game" : "games"}
                </span>
              ))}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

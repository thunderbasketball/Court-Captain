// A program's public Teams and Schedule (no login, no contact information): on the public League page and opened in
// place on the organization's login page. No hooks, so server and client pages both use them.
import type { PublicDay, PublicGroup } from "@/lib/public-league";
import { timeLabel } from "@/lib/time";
import { FollowStar } from "./FollowTeams";
import { card } from "./ui";

const weekday = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

// Teams by group ("5th Boys COMP"), each with its organization's abbreviation or Solo, and ☆ to follow it on this device.
export function ProgramTeams({ org, groups, wide = false }: { org: string; groups: PublicGroup[]; wide?: boolean }) {
  if (!groups.length) return <p className={`${card} p-5 text-sm text-zinc-600 dark:text-zinc-300`}>No teams registered yet.</p>;
  return (
    <div className={`grid gap-3 ${wide ? "sm:grid-cols-2" : ""}`}>
      {groups.map((g) => (
        <section key={g.label} className={`${card} overflow-hidden`}>
          <h3 className="border-b border-zinc-100 px-4 py-2.5 text-sm font-semibold dark:border-white/5">
            {g.label} <span className="font-normal text-zinc-500">· {g.teams.length}</span>
          </h3>
          <ul className="divide-y divide-zinc-100 text-sm dark:divide-white/5">
            {g.teams.map((t) => (
              <li key={t.id} className="flex items-center gap-2 px-4 py-2">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{t.name}</span> <span className="text-zinc-500">({t.tag})</span>
                </span>
                <FollowStar org={org} id={t.id} name={t.name} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

// Game days, the next one open (past ones closed), games by time then gym and court. null: not published yet.
export function ProgramSchedule({ days, today }: { days: PublicDay[] | null; today: string }) {
  if (days === null)
    return (
      <p className={`${card} p-5 text-sm text-zinc-600 dark:text-zinc-300`}>
        The schedule isn&apos;t posted yet. Check back soon.
      </p>
    );
  if (!days.length) return <p className={`${card} p-5 text-sm text-zinc-600 dark:text-zinc-300`}>No games scheduled yet.</p>;
  const next = days.find((d) => d.date >= today)?.date ?? days.at(-1)?.date;
  return (
    <div className="space-y-3">
      {days.map((d) => (
        <details key={d.date} className={`${card} group overflow-hidden`} open={d.date === next}>
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 font-semibold [&::-webkit-details-marker]:hidden">
            <span>
              {weekday(d.date)} <span className="font-normal text-zinc-500">· {d.games.length} games</span>
            </span>
            <span aria-hidden className="text-xs text-zinc-400 transition group-open:rotate-90">
              ▶
            </span>
          </summary>
          <ul className="divide-y divide-zinc-100 border-t border-zinc-100 text-sm dark:divide-white/5 dark:border-white/5">
            {d.games.map((g, i) => (
              <li key={i} className="flex gap-3 px-4 py-2.5">
                <span className="w-16 shrink-0 font-medium tabular-nums">{g.starts ? timeLabel(g.starts) : "TBA"}</span>
                <span className="min-w-0">
                  <span className="block">
                    <span className="font-medium">{g.away}</span> <span className="text-zinc-500">at</span>{" "}
                    <span className="font-medium">{g.home}</span>
                  </span>
                  <span className="block text-xs text-zinc-500">
                    {g.group}
                    {g.gym && ` · ${g.gym}${g.court ? `, ${g.court}` : ""}`}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </details>
      ))}
    </div>
  );
}

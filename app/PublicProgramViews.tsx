// A program's public Teams and Schedule (no login, no contact information): on the public League page and opened in
// place on the organization's login page. No hooks, so server and client pages both use them.
import type { PublicDay, PublicGroup } from "@/lib/public-league";
import { timeLabel } from "@/lib/time";
import FinalScore from "./FinalScore";
import { ShareToggle } from "./SharePanel";
import { groupKey } from "@/lib/share-keys";
import { FollowStar } from "./FollowTeams";
import { card } from "./ui";
import DirectionsLink from "./DirectionsLink";

const weekday = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

// "REC Schedule will be published soon."
export function ScheduleSoon({ levels, className = "" }: { levels: string[]; className?: string }) {
  if (!levels.length) return null;
  return <p className={`text-sm font-medium text-amber-700 dark:text-amber-300 ${className}`}>{levels.join(" and ")} Schedule will be published soon.</p>;
}

// Game days, the next one open (past ones closed), games by time then gym and court. null: not published yet.
export function ProgramSchedule({ days, today, soon }: { days: PublicDay[] | null; today: string; soon: string[] }) {
  if (days === null || !days.length)
    return soon.length ? (
      <div className={`${card} p-5`}>
        <ScheduleSoon levels={soon} />
      </div>
    ) : days ? (
      <p className={`${card} p-5 text-sm text-zinc-600 dark:text-zinc-300`}>No games scheduled yet.</p>
    ) : (
      <p className={`${card} p-5 text-sm text-zinc-600 dark:text-zinc-300`}>
        The schedule isn&apos;t posted yet. Check back soon.
      </p>
    );
  const next = days.find((d) => d.date >= today)?.date ?? days.at(-1)?.date;
  return (
    <div className="space-y-3">
      <ScheduleSoon levels={soon} className="px-1" />
      {days.map((d) => (
        <details key={d.date} className={`${card} group overflow-hidden`} open={d.date === next}>
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 font-semibold [&::-webkit-details-marker]:hidden">
            <span>
              {weekday(d.date)} <span className="font-normal text-zinc-500">· {d.games.length} games</span>
            </span>
            <span aria-hidden className="text-xs text-zinc-400 transition [details[open]>summary_&]:rotate-90">
              ▶
            </span>
          </summary>
          <ScheduleSoon levels={d.soon} className="border-t border-zinc-100 px-4 py-2 dark:border-white/5" />
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
                    <DirectionsLink href={g.map} />
                  </span>
                  <FinalScore final={g.final} first={g.away} second={g.home} firstIs="away" group={g.group} />
                </span>
              </li>
            ))}
          </ul>
        </details>
      ))}
    </div>
  );
}

const Arrow = () => (
  <span aria-hidden className="text-xs text-zinc-400 transition [details[open]>summary_&]:rotate-90">
    ▶
  </span>
);
const summaryCls = "flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden";

// A program by Division, then REC and COMP, then Grade (each a card that opens in place). A grade's card: Standings on top
// (its teams by Power Index, with wins, losses and PI; ☆ to follow), then its Schedule by date (once published).
// `follow` false: no ☆ (an organization's view of another's League; its own teams have theirs on its Teams card).
export function ProgramDivisions({
  org,
  groups,
  schedule,
  today,
  soon,
  follow = true,
  program,
}: {
  org: string;
  program?: string; // its id: Share on each grade's Standings and Schedule
  groups: PublicGroup[];
  schedule: PublicDay[] | null;
  today: string;
  soon: string[];
  follow?: boolean;
}) {
  if (!groups.length) return <p className={`${card} p-5 text-sm text-zinc-600 dark:text-zinc-300`}>No teams registered yet.</p>;
  const divisions: { name: string; levels: { level: string; grades: PublicGroup[] }[] }[] = [];
  for (const g of groups) {
    let d = divisions.find((x) => x.name === g.division);
    if (!d) divisions.push((d = { name: g.division, levels: [] }));
    let l = d.levels.find((x) => x.level === g.level);
    if (!l) d.levels.push((l = { level: g.level, grades: [] }));
    l.grades.push(g);
  }
  // REC first, then COMP.
  for (const d of divisions) d.levels.sort((a, b) => (a.level === b.level ? 0 : a.level === "REC" ? -1 : 1));
  const count = (gs: PublicGroup[]) => gs.reduce((n, g) => n + g.teams.length, 0);
  return (
    <div className="space-y-2">
      {divisions.map((d) => (
        <details key={d.name} className={`${card} overflow-hidden`}>
          <summary className={summaryCls}>
            <span className="font-semibold">
              {d.name} <span className="font-normal text-zinc-500">· {count(d.levels.flatMap((l) => l.grades))} teams</span>
            </span>
            <Arrow />
          </summary>
          <div className="space-y-2 border-t border-zinc-100 p-2 dark:border-white/5">
            {d.levels.map((l) => (
              <details key={l.level} className="overflow-hidden rounded-lg ring-1 ring-zinc-950/10 dark:ring-white/10">
                <summary className={summaryCls}>
                  <span className="flex items-center gap-2 font-semibold">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ring-1 ${
                        l.level === "COMP"
                          ? "bg-orange-50 text-orange-700 ring-orange-300 dark:bg-orange-500/10 dark:text-orange-300"
                          : "bg-sky-50 text-sky-700 ring-sky-300 dark:bg-sky-500/10 dark:text-sky-300"
                      }`}
                    >
                      {l.level}
                    </span>
                    <span className="font-normal text-zinc-500">{count(l.grades)} teams</span>
                  </span>
                  <Arrow />
                </summary>
                <div className="space-y-2 border-t border-zinc-100 p-2 dark:border-white/5">
                  {l.grades.map((g) => (
                    <GradeCard key={g.label} org={org} program={program} g={g} schedule={schedule} today={today} soon={soon.includes(g.level)} follow={follow} />
                  ))}
                </div>
              </details>
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}

function GradeCard({ org, program, g, schedule, today, soon, follow }: { org: string; program?: string; g: PublicGroup; schedule: PublicDay[] | null; today: string; soon: boolean; follow: boolean }) {
  const days = schedule?.map((d) => ({ ...d, games: d.games.filter((x) => x.group === g.label) })).filter((d) => d.games.length) ?? null;
  const next = days?.find((d) => d.date >= today); // the coming Game Day: its picture to share
  return (
    <details className="overflow-hidden rounded-lg bg-zinc-50/60 ring-1 ring-zinc-950/5 dark:bg-white/5 dark:ring-white/10">
      <summary className={summaryCls}>
        <span className="font-semibold">
          {g.grade} <span className="font-normal text-zinc-500">· {g.teams.length} teams</span>
        </span>
        <Arrow />
      </summary>
      <div className="space-y-3 border-t border-zinc-100 p-2 dark:border-white/5">
        <section>
          <h4 className="px-2 pb-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase">Standings</h4>
          {program && g.teams.some((t) => t.w + t.l > 0) && (
            <div className="px-2 pb-1">
              <ShareToggle
                at={`/share/${org}/${groupKey("standings", program, g.label)}`}
                v={`${today}-${g.teams.reduce((n, t) => n + t.w + t.l, 0)}`}
                text={`${g.label} standings`}
                file={`${groupKey("standings", program, g.label)}`}
              />
            </div>
          )}
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-zinc-500">
                <th className="px-2 py-1 text-left font-medium">Team</th>
                <th className="w-8 px-1 py-1 text-center font-medium">W</th>
                <th className="w-8 px-1 py-1 text-center font-medium">L</th>
                <th className="w-11 px-1 py-1 text-center font-medium" title="Power Index (0–1000)">PI</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
              {g.teams.map((t) => (
                <tr key={t.id}>
                  <td className="px-2 py-1.5">
                    <span className="font-medium">{t.name}</span> <span className="text-zinc-500">({t.tag})</span>
                  </td>
                  <td className="px-1 text-center tabular-nums">{t.w}</td>
                  <td className="px-1 text-center tabular-nums">{t.l}</td>
                  <td className="px-1 text-center font-semibold tabular-nums">{t.pi}</td>
                  <td className="px-1 text-right">
                    {follow && <FollowStar org={org} id={t.id} name={t.name} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-2 pt-1 text-xs text-zinc-500">
            PI: Power Index (0–1000), from this season&apos;s scores. Everyone starts at 500; wins against stronger teams (or playing up a grade or
            level) count more.
          </p>
        </section>
        <section>
          <h4 className="px-2 pb-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase">Schedule</h4>
          {soon && <ScheduleSoon levels={[g.level]} className="px-2 pb-1" />}
          {program && next && (
            <div className="px-2 pb-2">
              <ShareToggle
                at={`/share/${org}/${groupKey("schedule", program, g.label)}`}
                v={`${next.date}-${next.games.length}`}
                text={`${g.label} games, ${weekday(next.date)}`}
                file={`${groupKey("schedule", program, g.label)}`}
              />
            </div>
          )}
          {days === null ? (soon ? null : (
            <p className="px-2 text-sm text-zinc-600 dark:text-zinc-300">The schedule isn&apos;t posted yet. Check back soon.</p>
          )) : !days.length ? (soon ? null : (
            <p className="px-2 text-sm text-zinc-600 dark:text-zinc-300">No games scheduled yet.</p>
          )) : (
            <ul className="space-y-2">
              {days.map((d) => (
                <li key={d.date} className={`rounded-lg bg-white ring-1 ring-zinc-950/5 dark:bg-zinc-900 dark:ring-white/10 ${d.date < today && !d.games.some((x) => x.final) ? "opacity-60" : ""}`}>
                  <p className="border-b border-zinc-100 px-3 py-1.5 text-sm font-semibold dark:border-white/5">{weekday(d.date)}</p>
                  <ul className="divide-y divide-zinc-100 text-sm dark:divide-white/5">
                    {d.games.map((x, i) => (
                      <li key={i} className="flex gap-3 px-3 py-2">
                        <span className="w-16 shrink-0 font-medium tabular-nums">{x.starts ? timeLabel(x.starts) : "TBA"}</span>
                        <span className="min-w-0">
                          <span className="block">
                            <span className="font-medium">{x.away}</span> <span className="text-zinc-500">at</span> <span className="font-medium">{x.home}</span>
                          </span>
                          {x.gym && (
                            <span className="block text-xs text-zinc-500">
                              {x.gym}
                              {x.court ? `, ${x.court}` : ""}
                              <DirectionsLink href={x.map} />
                            </span>
                          )}
                          <FinalScore final={x.final} first={x.away} second={x.home} firstIs="away" group={g.label} />
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </details>
  );
}

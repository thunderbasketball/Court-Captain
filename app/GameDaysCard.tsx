import { db } from "@/lib/db";
import { orgGameDays, type DayGame } from "@/lib/org-game-days";
import { easternDate, timeLabel } from "@/lib/time";
import SubCard from "./SubCard";
import { rulesPrint, rulesView } from "@/lib/rules-link";
import { genderBg } from "./ui";

const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const plus = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
// The Friday before a Game Day (a Saturday's is the day before): scoresheets are printed from then until the day.
const fridayBefore = (d: string) => {
  let f = plus(d, -1);
  while (new Date(`${f}T12:00:00Z`).getUTCDay() !== 5) f = plus(f, -1);
  return f;
};

function GameRows({ games, showGym = true }: { games: DayGame[]; showGym?: boolean }) {
  return (
    <ul className="space-y-1 text-sm">
      {games.map((g) => (
        <li key={g.id} className={`flex gap-3 rounded-lg px-2 py-1.5 ${genderBg(g.gender)}`}>
          <span className="w-16 shrink-0 font-medium tabular-nums">{g.starts ? timeLabel(g.starts) : "TBA"}</span>
          <span className="min-w-0">
            <span className="block">
              <span className="font-medium">{g.away}</span> <span className="text-zinc-500">at</span> <span className="font-medium">{g.home}</span>
            </span>
            <span className="block text-xs text-zinc-500">
              {g.group}
              {showGym && g.gym && ` · ${g.gym}${g.court && g.court !== "Main" ? `, ${g.court}` : ""}`}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

// An organization's Game Days card (Home): the Leagues' rules to read and print, then a card per coming Game Day with its
// scoresheets to print (from the Friday before), the schedule at its gyms, and its teams' games by gender and grade.
export default async function GameDaysCard({ org, now }: { org: string; now: Date }) {
  const d = await orgGameDays(db, org, now);
  if (!d) return <p className="text-sm text-zinc-500">No League games yet: they show here once your teams are registered or your gyms host games.</p>;
  const today = easternDate(now);
  const withRules = d.leagues.filter((l) => l.rules || l.url || l.page);
  return (
    <div className="space-y-2">
      <SubCard title="League rules" count={withRules.length ? undefined : "not added yet"}>
        {withRules.length ? (
          <div className="space-y-3">
            {withRules.map((l) => {
              // Its rules page in the app (with a search), when the League has one.
              if (l.page)
                return (
                  <div key={l.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-semibold">{l.name}</span>
                    <a href={`/rules/${l.id}`} className="rounded-full bg-thunder-blue px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700">
                      📖 Read and search the rules
                    </a>
                  </div>
                );
              // The link (a Google Doc shows here and prints as a PDF) when there is one, else the PDF.
              const view = l.url ? rulesView(l.url) : `/program-rules/${l.id}`;
              const print = l.url ? rulesPrint(l.url) : `/program-rules/${l.id}`;
              return (
                <div key={l.id} className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-semibold">{l.name}</span>
                    <span className="flex gap-2">
                      {l.url && (
                        <a href={l.url} target="_blank" rel="noopener" className="rounded-full px-3 py-1 text-xs font-semibold text-thunder-blue ring-1 ring-thunder-blue/30 hover:bg-blue-50 dark:text-blue-400">
                          Open
                        </a>
                      )}
                      <a href={print} target="_blank" rel="noopener" className="rounded-full px-3 py-1 text-xs font-semibold text-thunder-blue ring-1 ring-thunder-blue/30 hover:bg-blue-50 dark:text-blue-400">
                        🖨 Print
                      </a>
                    </span>
                  </div>
                  {view && <iframe src={view} title={`${l.name} rules`} loading="lazy" className="h-[70vh] w-full rounded-lg bg-white ring-1 ring-zinc-950/10 dark:ring-white/10" />}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-zinc-500">The League hasn&apos;t added its rules yet.</p>
        )}
      </SubCard>
      {!d.days.length && <p className="text-sm text-zinc-500">No coming Game Days.</p>}
      {d.days.map((day) => {
        const print = today >= fridayBefore(day.day) && today <= day.day;
        const grades = [...new Set(day.ours.map((g) => `${g.gender} · ${g.grade}`))];
        return (
          <SubCard key={day.day} title={dayLabel(day.day)} count={`${day.ours.length} of our games${day.atGyms.length ? ` · ${day.atGyms.length} at our gyms` : ""}`} open={day === d.days[0]}>
            <div className="space-y-2">
              {day.leagues.length > 0 && <p className="text-xs text-zinc-500">{day.leagues.join(" · ")}</p>}
              {print && day.gyms.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm dark:bg-amber-500/10">
                  <span className="font-semibold">Scoresheets:</span>
                  {day.gyms.map((g) => (
                    <a key={g.key} href={`/print/scoresheets?day=${day.day}&gym=${encodeURIComponent(g.key)}`} target="_blank" rel="noopener" className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-thunder-blue ring-1 ring-thunder-blue/30 dark:bg-zinc-900 dark:text-blue-400">
                      🖨 {g.name} ({g.games})
                    </a>
                  ))}
                </div>
              )}
              {day.waiting > 0 && <p className="text-xs text-amber-700 dark:text-amber-300">{day.waiting} game{day.waiting === 1 ? "" : "s"} not published yet: they show once the League publishes them.</p>}
              {day.gyms.length > 0 && (
                <SubCard title="At our gyms" count={day.atGyms.length}>
                  {day.atGyms.length ? <GameRows games={day.atGyms} /> : <p className="text-sm text-zinc-500">Not published yet.</p>}
                </SubCard>
              )}
              <SubCard title="Our teams by grade" count={day.ours.length}>
                {day.ours.length ? (
                  <div className="space-y-3">
                    {grades.map((k) => {
                      const list = day.ours.filter((g) => `${g.gender} · ${g.grade}` === k);
                      return (
                        <div key={k}>
                          <p className="mb-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase">{list[0].group.replace(/ (REC|COMP)$/, "")}</p>
                          <GameRows games={list} />
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-zinc-500">No games published for our teams yet.</p>
                )}
              </SubCard>
            </div>
          </SubCard>
        );
      })}
    </div>
  );
}

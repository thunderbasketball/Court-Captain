import Link from "next/link";
import type { OrgMetrics as Metrics } from "@/lib/org-metrics";
import { TZ, easternDate } from "@/lib/time";
import type { VisitRange, VisitStats } from "@/lib/site-visits";
import RegistrationTrend from "./RegistrationTrend";
import FeeTrend from "./FeeTrend";
import SiteVisits from "./SiteVisits";
import NotOnTeamBoard from "./org/thunder/players/NotOnTeamBoard";
import SubCard from "./SubCard";
import TeamUseList from "./TeamUseList";
import { ordinal } from "@/lib/grades";
import type { ReactNode } from "react";

// The To Do items that need someone (each flashes red, and so do To Do and the Home card): players not on a team,
// uniforms missing a number or size, teams missing something, teams whose staff haven't used the app in 30 days, and
// what's waiting (join requests, Support chats).
export function todoCounts(m: Metrics) {
  const idle = m.teamUse.filter((t) => !t.views).length;
  const waiting = m.waiting.requests + m.waiting.newChats + m.waiting.workingChats;
  const items = {
    notOnTeam: m.notOnTeam?.total ?? 0,
    uniforms: m.uniforms?.missing ?? 0,
    missing: m.missing.length,
    idle,
    waiting,
  };
  return { ...items, open: Object.values(items).filter((n) => n > 0).length };
}

const grade = (g: number) => (g === -1 ? "Pre-K" : g === 0 ? "Kindergarten" : `${ordinal(String(g))} Grade`);

// An organization's Home card for its Owners and Admins (SPEC.md section 14): cards that open on their own, each with its
// count: Registrations (players, a bar a day from the first registration to the last), To Do (what needs
// someone, flashing red), Coaches' use of the app, Site visits (average a day, coaches' visits in green)
// and Fees paid and owed. `base` is the organization's address ("/org/thunder"); Thunder's pages (players, uniforms,
// practices, requests) are only Thunder's. `roster`: the viewer can roster players (the roster board button).
export default function OrgMetrics({
  m,
  visits,
  base,
  thunder,
  now,
  roster = false,
}: {
  m: Metrics;
  visits: Record<VisitRange, VisitStats> | null;
  base: string;
  thunder: boolean;
  now: Date;
  roster?: boolean;
}) {
  const todo = todoCounts(m);
  const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
  // Site visits: the average a day this month (views so far over the days so far).
  const avgDaily = visits ? Math.round(visits.month.views / Math.max(1, Number(easternDate(now).slice(8)))) : 0;
  // Uniforms still needing a number or size: Boys then Girls, by grade, then team.
  const uniformGroups = (() => {
    const out: { gender: string; grades: { grade: number; teams: { id: string; name: string; players: NonNullable<Metrics["uniforms"]>["list"] }[] }[] }[] = [];
    for (const u of m.uniforms?.list ?? []) {
      let g = out.find((x) => x.gender === u.gender);
      if (!g) out.push((g = { gender: u.gender, grades: [] }));
      let gr = g.grades.find((x) => x.grade === u.grade);
      if (!gr) g.grades.push((gr = { grade: u.grade, teams: [] }));
      let t = gr.teams.find((x) => x.id === u.teamId);
      if (!t) gr.teams.push((t = { id: u.teamId, name: u.team, players: [] }));
      t.players.push(u);
    }
    return out;
  })();
  const fold = (summary: ReactNode, body: ReactNode, key: string, depth = 0) => (
    <details key={key} className="group/u">
      <summary
        className="flex cursor-pointer list-none items-center gap-2 py-1.5 text-sm select-none [&::-webkit-details-marker]:hidden"
        style={{ paddingLeft: `${depth * 0.9}rem` }}
      >
        <span className="min-w-0 flex-1">{summary}</span>
        <span aria-hidden className="text-zinc-400 transition-transform [details[open]>summary_&]:rotate-90">
          ›
        </span>
      </summary>
      {body}
    </details>
  );

  return (
    <section aria-label="Metrics" className="space-y-2">
      {m.registrations && (
        <SubCard title="Registrations" count={m.registrations.total}>
          <p className="mb-2 text-xs text-zinc-500">
            {m.registrations.thisWeek} in the last 7 days
            {m.registrations.span.length > 0 &&
              ` · ${day(m.registrations.span[0].day)} to ${day(m.registrations.span.at(-1)!.day)}`}
            {m.registrations.syncedAt &&
              ` · synced ${new Date(m.registrations.syncedAt).toLocaleString("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`}
          </p>
          {m.registrations.span.length > 0 ? (
            <RegistrationTrend daily={m.registrations.span} lastLabel={day(m.registrations.span.at(-1)!.day)} />
          ) : (
            <p className="text-sm text-zinc-500">No registrations yet.</p>
          )}
        </SubCard>
      )}

      <SubCard title="To Do" count={todo.open} alert={todo.open > 0}>
        <div className="space-y-2">
          {!todo.open && <p className="text-sm text-zinc-500">✓ Nothing to do right now.</p>}
          {m.notOnTeam && (
            <SubCard
              title="Not on a team"
              count={m.notOnTeam.total}
              alert={m.notOnTeam.total > 0}
              action={roster && m.notOnTeam.total > 0 ? <NotOnTeamBoard>
                <span className="rounded-full px-2.5 py-1 text-xs font-semibold text-thunder-blue ring-1 ring-thunder-blue/30">Roster</span>
              </NotOnTeamBoard> : undefined}
            >
              {!m.notOnTeam.total ? (
                <p className="text-sm text-zinc-500">✓ Every player is on a team.</p>
              ) : (
                <ul className="divide-y divide-zinc-100 dark:divide-white/5">
                  {m.notOnTeam.players.map((p) => (
                    <li key={p.id} className="flex justify-between gap-2 py-1.5 text-sm">
                      <span className="truncate font-medium">{p.name}</span>
                      <span className={`shrink-0 text-xs ${p.gender === "Boys" ? "text-blue-700 dark:text-blue-300" : "text-pink-700 dark:text-pink-300"}`}>
                        {ordinal(p.grade)} {p.gender}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </SubCard>
          )}
          {m.uniforms && (
            <SubCard
              title="Uniform order"
              count={m.uniforms.missing ? `${m.uniforms.missing} need attention` : "ready"}
              alert={m.uniforms.missing > 0}
            >
              <p className="mb-1 text-xs text-zinc-500">
                {m.uniforms.ready}/{m.uniforms.players} rostered players have a number (and a size when they need a uniform).{" "}
                {thunder && (
                  <Link href={`${base}/uniforms`} className="font-medium text-thunder-blue hover:underline">
                    Uniforms →
                  </Link>
                )}
              </p>
              {!m.uniforms.missing && <p className="text-sm text-zinc-500">✓ Ready to order.</p>}
              {uniformGroups.map((g) =>
                fold(
                  <span className={`font-semibold ${g.gender === "Boys" ? "text-blue-700 dark:text-blue-300" : "text-pink-700 dark:text-pink-300"}`}>
                    {g.gender} ({g.grades.reduce((n, x) => n + x.teams.reduce((k, t) => k + t.players.length, 0), 0)})
                  </span>,
                  g.grades.map((gr) =>
                    fold(
                      <span className="font-medium">
                        {grade(gr.grade)} ({gr.teams.reduce((k, t) => k + t.players.length, 0)})
                      </span>,
                      gr.teams.map((t) =>
                        fold(
                          <span>
                            {t.name} ({t.players.length})
                          </span>,
                          <ul className="pb-1" style={{ paddingLeft: "2.7rem" }}>
                            {t.players.map((p, i) => (
                              <li key={i} className="flex justify-between gap-2 py-0.5 text-sm">
                                <span className="truncate">{p.name}</span>
                                <span className="flex shrink-0 gap-1">
                                  {p.noNumber && <Need>No number</Need>}
                                  {p.noSize && <Need>No size</Need>}
                                </span>
                              </li>
                            ))}
                          </ul>,
                          `u-${t.id}`,
                          2,
                        ),
                      ),
                      `u-${g.gender}-${gr.grade}`,
                      1,
                    ),
                  ),
                  `u-${g.gender}`,
                ),
              )}
            </SubCard>
          )}
          {m.teams && (
            <SubCard title="Teams missing something" count={m.missing.length} alert={m.missing.length > 0}>
              {!m.missing.length && (
                <p className="text-sm text-zinc-500">✓ Every team has a Head Coach (with cell and email) and players.</p>
              )}
              <ul className="max-h-64 divide-y divide-zinc-100 overflow-y-auto dark:divide-white/5">
                {m.missing.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                    <Link href={`${base}/teams/${t.id}`} className="min-w-0 truncate text-thunder-blue hover:underline">
                      {t.name}
                    </Link>
                    <span className="flex shrink-0 gap-1">
                      {t.noCoach && <Need>No Head Coach</Need>}
                      {t.noCell && <Need>No coach cell</Need>}
                      {t.noEmail && <Need>No coach email</Need>}
                      {t.noPlayers && <Need>No players</Need>}
                    </span>
                  </li>
                ))}
              </ul>
            </SubCard>
          )}
          {m.teams && (
            <SubCard title="Teams not using the app" count={todo.idle} alert={todo.idle > 0}>
              <TeamUseList teams={m.teamUse} base={base} />
            </SubCard>
          )}
          <SubCard title="Waiting on you" count={todo.waiting} alert={todo.waiting > 0}>
            {!todo.waiting ? (
              <p className="text-sm text-zinc-500">Nothing right now.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {m.waiting.requests > 0 && (
                  <li>
                    {thunder ? (
                      <Link href={`${base}?open=members&sub=requests#members`} className="text-thunder-blue hover:underline">
                        {m.waiting.requests} join request{m.waiting.requests === 1 ? "" : "s"}
                      </Link>
                    ) : (
                      `${m.waiting.requests} join request${m.waiting.requests === 1 ? "" : "s"}`
                    )}
                  </li>
                )}
                {m.waiting.newChats > 0 && <li>{m.waiting.newChats} new Support chat{m.waiting.newChats === 1 ? "" : "s"}</li>}
                {m.waiting.workingChats > 0 && (
                  <li>
                    {m.waiting.workingChats} Support chat{m.waiting.workingChats === 1 ? "" : "s"} in progress
                  </li>
                )}
              </ul>
            )}
          </SubCard>
        </div>
      </SubCard>

      {m.teams && (
        <SubCard title="Coaches' use of the app" count={m.coaches.length}>
          <p className="text-xs text-zinc-500">Last login, longest ago first</p>
          {!m.coaches.length && <p className="mt-1 text-sm text-zinc-500">No coaches yet.</p>}
          <ul className="mt-1 max-h-64 divide-y divide-zinc-100 overflow-y-auto dark:divide-white/5">
            {m.coaches.map((c) => (
              <li key={c.id} className="flex items-start justify-between gap-2 py-1.5 text-sm">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{c.name}</span>
                  <span className="block truncate text-xs text-zinc-500">{c.teams.join(" · ")}</span>
                </span>
                <span className="shrink-0 text-right text-xs">{lastLogin(c.lastLogin, now)}</span>
              </li>
            ))}
          </ul>
        </SubCard>
      )}

      {visits && (
        <SubCard title="Site visits" count={`Avg ${avgDaily} a day`}>
          <SiteVisits stats={visits} bare />
        </SubCard>
      )}

      {m.registrations && m.registrations.fees.length > 0 && (
        <SubCard title="Fees paid and owed" count={<OwedCount days={m.registrations.fees} />}>
          <p className="mb-2 text-xs text-zinc-500">Totals to date, from the first payment ({day(m.registrations.fees[0].day)}) to today</p>
          <FeeTrend days={m.registrations.fees} />
        </SubCard>
      )}
    </section>
  );
}

// "$7,002 owed ▼ $135": today's amount owed, and how it moved since yesterday (▲ red when it went up, ▼ green when down).
function OwedCount({ days }: { days: { owed: number }[] }) {
  const now = days.at(-1)!.owed;
  const change = Math.round(now - (days.at(-2)?.owed ?? now));
  const money = (n: number) => `$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;
  return (
    <>
      {money(now)} owed
      {change !== 0 && (
        <span
          className={change > 0 ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}
          title={`${change > 0 ? "Up" : "Down"} ${money(change)} since yesterday`}
        >
          {" "}
          {change > 0 ? "▲" : "▼"} {money(change)}
          <span className="sr-only"> {change > 0 ? "more" : "less"} than yesterday</span>
        </span>
      )}
      {change === 0 && <span className="text-zinc-400"> · same as yesterday</span>}
    </>
  );
}

function Need({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
      {children}
    </span>
  );
}

// "No login recorded" (logins are kept from Oct 30, 2026), "Today", "3 days ago", "Oct 30".
function lastLogin(at: Date | null, now: Date) {
  if (!at) return <span className="font-semibold text-amber-700 dark:text-amber-300">No login recorded</span>;
  const days = Math.floor((now.getTime() - new Date(at).getTime()) / 86_400_000);
  const text =
    days < 1
      ? "Today"
      : days === 1
        ? "Yesterday"
        : days < 14
          ? `${days} days ago`
          : new Date(at).toLocaleDateString("en-US", { timeZone: TZ, month: "short", day: "numeric" });
  return <span className={days >= 7 ? "text-amber-700 dark:text-amber-300" : "text-zinc-500"}>{text}</span>;
}

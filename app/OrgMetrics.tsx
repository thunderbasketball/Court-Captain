import Link from "next/link";
import type { OrgMetrics as Metrics } from "@/lib/org-metrics";
import { TZ } from "@/lib/time";
import type { VisitRange, VisitStats } from "@/lib/site-visits";
import RegistrationTrend from "./RegistrationTrend";
import SiteVisits from "./SiteVisits";
import NotOnTeamBoard from "./org/thunder/players/NotOnTeamBoard";
import { card } from "./ui";

// An organization's Home metrics for its Owners and Admins (SPEC.md section 14): number tiles that open the page behind
// them, the daily registration trend, teams missing something, and coaches' use of the app. `base` is the
// organization's address ("/org/thunder"); Thunder's pages (players, uniforms, practices, requests) are only Thunder's.
// `roster`: the viewer can roster players, so "Not on a team" opens every grade's roster board.
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
  const waiting = m.waiting.requests + m.waiting.newChats + m.waiting.workingChats;
  const tiles = [
    m.registrations && {
      label: "Players registered",
      value: m.registrations.total,
      note: `${m.registrations.thisWeek} in the last 7 days`,
      href: `${base}/members/players`,
    },
    m.teams && {
      label: "Teams",
      value: m.teams.total,
      note: `REC ${m.teams.rec} · COMP ${m.teams.comp} · Boys ${m.teams.boys} · Girls ${m.teams.girls}`,
      href: `${base}/teams`,
    },
    m.notOnTeam && {
      label: "Not on a team",
      value: m.notOnTeam.total,
      note: m.notOnTeam.total
        ? m.notOnTeam.groups
            .slice(0, 4)
            .map((g) => `${g.label} ${g.n}`)
            .join(" · ") + (m.notOnTeam.groups.length > 4 ? " …" : "")
        : "Every player is on a team",
      href: `${base}/members/players`,
      alert: m.notOnTeam.total > 0,
      board: roster,
    },
    m.uniforms && {
      label: "Uniform order prep",
      value: `${m.uniforms.ready}/${m.uniforms.players}`,
      note: m.uniforms.missing
        ? `${m.uniforms.missing} need a number or size`
        : m.uniforms.players
          ? "✓ Ready to order"
          : "No rostered players yet",
      href: `${base}/uniforms`,
      alert: m.uniforms.missing > 0,
    },
    m.practices && {
      label: "Practice slots this week",
      value: `${m.practices.thisWeek.booked} booked`,
      note: `${m.practices.thisWeek.open} open · next week ${m.practices.nextWeek.booked} booked, ${m.practices.nextWeek.open} open · ${m.practices.blackoutDays} blackout day${m.practices.blackoutDays === 1 ? "" : "s"} in 30 days`,
      href: `${base}/practice`,
    },
    {
      label: "Waiting on you",
      value: waiting,
      note: waiting
        ? [
            m.waiting.requests && `${m.waiting.requests} join request${m.waiting.requests === 1 ? "" : "s"}`,
            m.waiting.newChats && `${m.waiting.newChats} new Support chat${m.waiting.newChats === 1 ? "" : "s"}`,
            m.waiting.workingChats && `${m.waiting.workingChats} chat${m.waiting.workingChats === 1 ? "" : "s"} in progress`,
          ]
            .filter(Boolean)
            .join(" · ")
        : "Nothing right now",
      href: thunder && m.waiting.requests ? `${base}/members/requests` : null,
      alert: waiting > 0,
    },
  ].filter((t) => !!t);

  return (
    <section aria-label="Metrics" className="mb-5 space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {tiles.map((t) => {
          const body = (
            <>
              <p className="text-xs font-medium text-zinc-500">{t.label}</p>
              <p className="mt-0.5 text-2xl font-semibold">{t.value}</p>
              <p className={`mt-0.5 text-xs ${"alert" in t && t.alert ? "text-amber-700 dark:text-amber-300" : "text-zinc-500"}`}>
                {t.note}
              </p>
            </>
          );
          if ("board" in t && t.board)
            return (
              <div key={t.label} className={`${card} p-3 hover:ring-zinc-400/40`}>
                <NotOnTeamBoard>{body}</NotOnTeamBoard>
              </div>
            );
          return t.href ? (
            <Link key={t.label} href={t.href} className={`${card} block p-3 hover:ring-zinc-400/40`}>
              {body}
            </Link>
          ) : (
            <div key={t.label} className={`${card} p-3`}>
              {body}
            </div>
          );
        })}
      </div>

      {visits && <SiteVisits stats={visits} />}

      {m.registrations && (
        <div className={`${card} p-4`}>
          <h2 className="text-sm font-semibold">Registrations per day</h2>
          <p className="mb-2 text-xs text-zinc-500">
            Last 30 days
            {m.registrations.syncedAt &&
              ` · synced ${new Date(m.registrations.syncedAt).toLocaleString("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`}
          </p>
          <RegistrationTrend daily={m.registrations.daily} />
        </div>
      )}

      {m.teams && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className={`${card} p-4`}>
            <h2 className="text-sm font-semibold">
              Teams missing something <span className="font-normal text-zinc-500">({m.missing.length})</span>
            </h2>
            {!m.missing.length && (
              <p className="mt-1 text-sm text-zinc-500">✓ Every team has a Head Coach (with cell and email) and players.</p>
            )}
            <ul className="mt-1 max-h-64 divide-y divide-zinc-100 overflow-y-auto dark:divide-white/5">
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
          </div>

          <div className={`${card} p-4`}>
            <h2 className="text-sm font-semibold">
              Coaches&apos; use of the app <span className="font-normal text-zinc-500">({m.coaches.length})</span>
            </h2>
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
          </div>
        </div>
      )}
    </section>
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

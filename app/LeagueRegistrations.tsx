import InCartNote from "./cart/InCartNote";
import { inCarts } from "@/lib/cart";
import type { SessionUser } from "@/lib/auth/service";
import type { LeagueTeamPage } from "@/lib/scenic-team-page";
import { leagueEntry } from "@/lib/scenic-programs";
import type { ScheduledGame } from "@/lib/scenic-games";
import type { RequestDay } from "@/lib/schedule-requests";
import { db } from "@/lib/db";
import { LeagueGames } from "./LeagueGames";
import ScheduleRequests from "./ScheduleRequests";
import { AddLeagueDates } from "./org/scenic-city/teams/[id]/LeagueTeamTools";
import { Chip } from "./ui";

const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

// A team page's Current Registrations card (its inside): each League or event the team's League copy is in (division,
// Paid, its dates, the Brackets, its games), Add dates or a 2nd Game for whoever may (`canAdd`; checked again on the
// server), then its Schedule requests.
export default async function LeagueRegistrations({
  user,
  teamId,
  programs,
  games,
  requests,
  canAdd,
  today,
}: {
  user: SessionUser;
  teamId: string; // its copy in the League
  programs: LeagueTeamPage["programs"];
  games: ScheduledGame[];
  requests: RequestDay[] | null;
  canAdd: boolean;
  today: string;
}) {
  const terms =
    canAdd && !user.actingBy
      ? new Map(
          await Promise.all(
            programs.filter((p) => p.kind === "League" && !p.out).map(async (p) => [p.id, await leagueEntry(db, p.id, teamId)] as const),
          ),
        )
      : null;
  // Whose cart it's in (not paid for yet): shown to whoever may add to it.
  const carts = canAdd ? await inCarts(db, new Date(), user, { teamId }) : [];
  return (
    <div className="space-y-3 px-4 pb-3">
      {programs.map((p) => {
        const t = terms?.get(p.id);
        return (
          <div key={p.id} className="space-y-1 text-sm">
            <p className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{p.name}</span>
              <Chip tone={p.paid ? "green" : "amber"}>{p.paid ? "Paid" : "Unpaid"}</Chip>
              {p.out && <span className="text-xs font-medium text-red-600 dark:text-red-400">Taken out by the League</span>}
            </p>
            <p className="text-zinc-500">{p.division}</p>
            {p.entry && (
              <p className="text-zinc-600 dark:text-zinc-300">
                {p.entry.allSeason
                  ? "ALL Season"
                  : Object.entries(p.entry.perDate)
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([d, gg]) => `${day(d)} ${gg}GG`)
                      .join(", ")}
                {p.entry.bracket && <span className="font-medium text-violet-700 dark:text-violet-300"> · Brackets</span>}
              </p>
            )}
            <LeagueGames games={games.filter((g) => g.programId === p.id)} today={today} />
            <InCartNote list={carts.filter((c) => c.programId === p.id)} />
            {t?.entry && (
              <AddLeagueDates programId={p.id} teamId={teamId} options={t.options} gameDates={t.gameDates} today={today} entry={t.entry} paid={p.paid} />
            )}
          </div>
        );
      })}
      {requests && requests.length > 0 && <ScheduleRequests teamId={teamId} days={requests} />}
    </div>
  );
}

// A parent's players as they see them (Find my player's team; a team's Parent view): each with its team, the team's staff,
// and its coming practices and published games. No hooks.
import type { FoundPlayer } from "@/lib/find-player";
import { formatCell } from "@/lib/phone";
import { ScheduleList } from "./LeagueGames";
import { PhoneLink, genderOf, genderTint } from "./ui";

export default function FoundPlayers({ players, today }: { players: FoundPlayer[]; today: string }) {
  return (
    <>
      {players.map((p) => (
        <div key={p.id} className={`space-y-2 rounded-xl p-3 ring-1 ${genderTint(genderOf(p.grade)) ?? "ring-zinc-950/10 dark:ring-white/10"}`}>
          <div>
            <p className="font-semibold">{p.name}</p>
            <p className="text-xs text-zinc-500">
              {p.grade} · {p.org}
              {p.program ? ` · ${p.program}` : ""}
            </p>
          </div>
          {p.team ? (
            <>
              <p className="text-sm">
                Team: <span className="font-semibold">{p.team.name}</span>
              </p>
              {p.team.staff.length > 0 && (
                <ul className="space-y-0.5 text-sm">
                  {p.team.staff.map((s) => (
                    <li key={`${s.role}-${s.name}`} className="flex flex-wrap gap-x-2">
                      <span className="text-zinc-500">{s.role}</span>
                      <span>{s.name}</span>
                      <PhoneLink cell={s.cell} label={formatCell(s.cell)} />
                    </li>
                  ))}
                </ul>
              )}
              {p.team.soon.length > 0 && (
                <p className="text-sm font-medium text-amber-700 dark:text-amber-300">{p.team.soon.join(" and ")} Schedule will be published soon.</p>
              )}
              <ScheduleList games={p.team.games} practices={p.team.practices} own={p.team.own} today={today} empty="No practices booked or games published yet." />
            </>
          ) : (
            <p className="text-sm text-zinc-500">Not on a team yet. Check back once teams are made.</p>
          )}
        </div>
      ))}
    </>
  );
}

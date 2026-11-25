"use client";

import { useState } from "react";
import type { OrgPublicTeam } from "@/lib/public-league";
import { FollowStar, GameLine, useFollowed, type Game } from "../../FollowTeams";
import SubCard from "../../SubCard";

// An organization's public page: its teams in a current event, each with a ☆ to follow it on this device (kept on the
// phone, no login; starred teams first, under My teams) and its League games (once the League publishes its schedule),
// opened right here. Team names and games only.
export default function OrgTeams({ org, teams, today }: { org: string; teams: OrgPublicTeam[]; today: string }) {
  const followed = useFollowed(org);
  if (!teams.length) return null;
  const mine = followed.flatMap((id) => teams.filter((t) => t.id === id));
  const rest = teams.filter((t) => !followed.includes(t.id));
  return (
    <section id="teams" className="scroll-mt-4 space-y-2">
      <h2 className="px-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase">Teams</h2>
      {mine.length > 0 && (
        <SubCard title="My teams" count={mine.length} open>
          <TeamList org={org} teams={mine} today={today} />
        </SubCard>
      )}
      <SubCard title={mine.length ? "All teams" : "Teams"} count={rest.length} open={!mine.length}>
        <p className="px-1 pb-2 text-xs text-zinc-500">Tap ☆ to follow a team on this phone; it moves to My teams.</p>
        <TeamList org={org} teams={rest.length ? rest : []} today={today} />
        {!rest.length && <p className="px-1 text-sm text-zinc-500">You follow every team.</p>}
      </SubCard>
    </section>
  );
}

function TeamList({ org, teams, today }: { org: string; teams: OrgPublicTeam[]; today: string }) {
  return (
    <ul className="grid gap-x-6 px-1 lg:grid-cols-2">
      {teams.map((t) => (
        <TeamRow key={t.id} org={org} team={t} today={today} />
      ))}
    </ul>
  );
}

// One team: its name and event, the next game, ☆; tap for every game (past ones faded).
function TeamRow({ org, team, today }: { org: string; team: OrgPublicTeam; today: string }) {
  const [open, setOpen] = useState(false);
  const games: Game[] = team.programs
    .flatMap((p) => (p.games ?? []).map((g) => ({ ...g, program: p.name, team: team.name, group: p.group })))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.starts ?? "99").localeCompare(b.starts ?? "99"));
  const next = games.find((g) => g.date >= today && !g.final);
  const last = games.filter((g) => g.final).at(-1); // its latest final, shown closed too
  const posted = team.programs.some((p) => p.games !== null);
  const soon = [...new Set(team.programs.filter((p) => p.soon).map((p) => p.level))];
  return (
    <li className="border-b border-zinc-100 py-2.5 dark:border-white/5">
      <div className="flex items-start gap-1.5">
        <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="min-w-0 flex-1 text-left">
          <span className="block truncate font-semibold">{team.name}</span>
          <span className="block truncate text-xs text-zinc-500">{team.programs.map((p) => `${p.name} · ${p.group}`).join(" / ")}</span>
          <span className="block text-xs text-zinc-500">
            {soon.length > 0 && !next ? `${soon.join(" and ")} Schedule will be published soon` : !posted ? "Schedule not posted yet" : next ? "Next game below" : "No more games"}
            {posted && <span className="text-thunder-blue dark:text-blue-400"> · {open ? "Hide games" : `All games (${games.length})`}</span>}
          </span>
        </button>
        <FollowStar org={org} id={team.id} name={team.name} />
      </div>
      {posted && (open ? games.length > 0 : !!next || !!last) && (
        <ul className="mt-2 space-y-1.5 text-sm">
          {open ? (
            games.map((g, i) => <GameLine key={i} g={g} past={g.date < today} />)
          ) : (
            <>
              {last && <GameLine g={last} past />}
              {next && <GameLine g={next} />}
            </>
          )}
        </ul>
      )}
    </li>
  );
}

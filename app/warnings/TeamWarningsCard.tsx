import Link from "next/link";
import { db } from "@/lib/db";
import { orgTeamWarnings, type WarnedTeam } from "@/lib/team-warnings";
import { allowedCount, openCount } from "@/lib/roster-conflicts";
import OurConflicts from "../OurConflicts";
import BusyCoachList from "../BusyCoachList";
import SubCard from "../SubCard";

function TeamList({ teams, base }: { teams: WarnedTeam[]; base: string }) {
  if (!teams.length) return <p className="text-sm text-zinc-500">None ✓</p>;
  return (
    <ul className="divide-y divide-zinc-100 dark:divide-white/5">
      {teams.map((t) => (
        <li key={t.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
          <Link href={`${base}/teams/${t.id}`} className="min-w-0 truncate text-thunder-blue hover:underline">
            {t.name}
          </Link>
          <span className="shrink-0 text-xs text-red-600 tabular-nums dark:text-red-400">{t.detail}</span>
        </li>
      ))}
    </ul>
  );
}

// The Teams card's Warnings (every organization): the warnings it turned on, each a card of the teams it catches,
// flashing red while any team is caught. Which are on, and their numbers, are set in the organization gear's Warnings card.
export default async function TeamWarningsCard({ org, base }: { org: string; base: string }) {
  const w = await orgTeamWarnings(db, org, new Date());
  const s = w.settings;
  const parts = [
    w.roster && { key: "roster", title: `Roster under ${s.roster.min} players`, teams: w.roster },
    w.idle && { key: "idle", title: `Not on the app in ${s.idle.days} days`, teams: w.idle },
    w.uniforms && { key: "uniforms", title: "Uniform information missing", teams: w.uniforms },
    w.birthdates && { key: "birthdates", title: "Birthdate missing", teams: w.birthdates },
    w.wrong && { key: "wrong", title: "Birthdate can't be right", teams: w.wrong },
    w.numbers && { key: "numbers", title: "Uniform number missing", teams: w.numbers },
    w.duplicates && { key: "duplicates", title: "Duplicate uniform numbers", teams: w.duplicates },
  ].filter((p): p is { key: string; title: string; teams: WarnedTeam[] } => !!p);
  // Only the warnings that catch something are listed.
  const on = parts.length > 0;
  const hits = parts.filter((p) => p.teams.length > 0);
  return (
    <SubCard
      title="Warnings"
      count={`${w.teams} team${w.teams === 1 ? "" : "s"}`}
      alert={w.teams > 0}
    >
      {hits.length || w.conflicts.length || w.busy.length ? (
        <div className="space-y-2">
          {w.busy.length > 0 && (
            <SubCard title="Coaches on more than 2 teams" count={w.busy.length} alert>
              <BusyCoachList list={w.busy} base={base} />
            </SubCard>
          )}
          {w.conflicts.length > 0 && (
            <SubCard title="Roster conflicts" count={openCount(w.conflicts) || `${allowedCount(w.conflicts)} allowed`} alert={openCount(w.conflicts) > 0}>
              <OurConflicts list={w.conflicts} base={base} />
            </SubCard>
          )}
          {hits.map((p) => (
            <SubCard key={p.key} title={p.title} count={p.teams.length} alert>
              <TeamList teams={p.teams} base={base} />
            </SubCard>
          ))}
        </div>
      ) : on ? (
        <p className="text-sm text-zinc-500">No warnings right now ✓</p>
      ) : (
        <p className="text-sm text-zinc-500">No warnings are turned on. Choose them in the organization&apos;s gear (⚙ at the top) → Warning Configurations.</p>
      )}
    </SubCard>
  );
}

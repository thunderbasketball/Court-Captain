import Link from "next/link";
import { db } from "@/lib/db";
import { orgTeamWarnings, type WarnedTeam } from "@/lib/team-warnings";
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
  ].filter((p): p is { key: string; title: string; teams: WarnedTeam[] } => !!p);
  return (
    <SubCard
      title="Warnings"
      count={`${w.teams} team${w.teams === 1 ? "" : "s"}`}
      alert={w.teams > 0}
    >
      {parts.length ? (
        <div className="space-y-2">
          {parts.map((p) => (
            <SubCard key={p.key} title={p.title} count={p.teams.length} alert={p.teams.length > 0}>
              <TeamList teams={p.teams} base={base} />
            </SubCard>
          ))}
        </div>
      ) : (
        <p className="text-sm text-zinc-500">No warnings are turned on. Choose them in the organization&apos;s gear (⚙ at the top) → Warning Configurations.</p>
      )}
    </SubCard>
  );
}

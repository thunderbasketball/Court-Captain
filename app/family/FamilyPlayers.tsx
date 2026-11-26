import Link from "next/link";
import type { ReactNode } from "react";
import { db } from "@/lib/db";
import { hasFeature } from "@/lib/features";
import { gradeLabel } from "@/lib/grades";
import { familyTeams } from "@/lib/family-team";
import { formatCell } from "@/lib/phone";
import { easternDate } from "@/lib/time";
import { TextIcon } from "../CardIcons";
import { ChatToggle } from "../InlineToggle";
import { ScheduleList } from "../LeagueGames";
import NextSevenDays from "../NextSevenDays";
import SubCard from "../SubCard";
import { JerseyNumber, PhoneLink, genderTint } from "../ui";

// My dashboard's Your players: a card for each, tinted Boys blue or Girls pink. Once the parent's email is verified, their team is
// a card on the player's card: number and size, Next 10 days with their ✓ / ✗, then Schedule, Staff, Roster and the Parents chat.
export default async function FamilyPlayers({ coachId, players }: { coachId: string; players: PlayerLine[] }) {
  const on = await hasFeature(db, "thunder", "player-registration");
  const now = new Date();
  const f = on ? await familyTeams({ pool: db, now: () => now }, coachId) : null;
  const chat = !!f?.teams.length && (await hasFeature(db, "thunder", "team-chat"));
  const today = easternDate(now);
  const teamsOf = (name: string) => f?.teams.flatMap((t) => t.kids.filter((k) => k.name.toLowerCase() === name.toLowerCase()).map((kid) => ({ t, kid }))) ?? [];
  return (
    <div className="space-y-4">
      {f && !f.verified && (
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-600/25 ring-inset dark:bg-amber-500/10 dark:text-amber-200">
          Confirm your email to see your players&apos; teams: log out, then log in and enter the code we email you.
        </p>
      )}
      {players.map((c) => {
        const teams = teamsOf(c.name);
        return (
          <PlayerCard key={c.name} c={c} team={teams.length ? null : undefined}>
            {teams.map(({ t, kid }) => (
              <SubCard key={t.id} title={t.name} count={t.level} open>
                <div className="space-y-3">
                  {t.conflicts
                    .filter((x) => x.name.trim().toLowerCase() === kid.name.trim().toLowerCase())
                    .map((x) => (
                      <p key={x.text} className="rounded-xl bg-red-50 p-3 text-sm text-red-700 ring-1 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30">
                        <span className="font-semibold">On two rosters: </span>
                        {x.text} The organization and the League are sorting it out; ask your coach if you have questions.
                      </p>
                    ))}
                  <p className="text-sm font-medium">
                    <JerseyNumber n={kid.number} />
                    {kid.number ? "" : "Number not set yet"}
                    {kid.size && <span className="font-normal text-zinc-500">{kid.number ? "" : " · "}Uniform {kid.size}</span>}
                  </p>
            {t.soon.length > 0 && <p className="text-sm font-medium text-amber-700 dark:text-amber-300">{t.soon.join(" and ")} Schedule will be published soon.</p>}
            <div className="grid items-start gap-3 xl:grid-cols-2">
              <NextSevenDays
                games={t.games}
                practices={t.practices}
                own={t.own}
                scrims={t.scrims}
                now={now}
                team={{ org: "thunder", teamId: t.id }}
                staff={false}
                mine={[{ player: kid.player, firstName: kid.firstName }]}
                rsvps={t.rsvps}
              />
              <div className="space-y-2">
                <SubCard title="Schedule" count={t.games.length + t.practices.length + t.own.length + t.scrims.length}>
                  <ScheduleList games={t.games} practices={t.practices} own={t.own} scrims={t.scrims} today={today} empty="No practices booked or games published yet." />
                </SubCard>
                <SubCard title="Staff" count={t.staff.length} action={t.staff.length > 0 && <TextIcon cells={t.staff.map((s) => s.cell)} label="Text the staff" />}>
                  <ul className="space-y-1 text-sm">
                    {t.staff.map((s) => (
                      <li key={`${s.role}-${s.name}`} className="flex flex-wrap gap-x-2">
                        <span className="text-zinc-500">{s.role}</span>
                        <span className="font-medium">{s.name}</span>
                        <PhoneLink cell={s.cell} label={formatCell(s.cell)} />
                      </li>
                    ))}
                    {!t.staff.length && <li className="text-zinc-500">No coach yet.</li>}
                  </ul>
                </SubCard>
                <SubCard title="Roster" count={t.roster.length}>
                  <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                    {t.roster.map((p, i) => (
                      <li key={i}>
                        <JerseyNumber n={p.number} />
                        {p.name}
                      </li>
                    ))}
                  </ul>
                </SubCard>
                {chat && (
                  <div className="flex flex-wrap">
                    <ChatToggle chatKey={`parents-${t.id}`} label={`${t.name} parents chat`} className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-thunder-blue ring-1 ring-thunder-blue/40 dark:bg-zinc-900 dark:text-blue-400">
                      🗨️ Parents chat
                    </ChatToggle>
                  </div>
                )}
              </div>
            </div>
                </div>
              </SubCard>
            ))}
          </PlayerCard>
        );
      })}
      {!!f?.teams.length && (
        <p className="text-sm">
          <Link href="/league/scenic-city?from=thunder" className="font-medium text-thunder-blue hover:underline dark:text-blue-400">
            League schedule, standings and gyms →
          </Link>
        </p>
      )}
    </div>
  );
}

export type PlayerLine = { name: string; gender: string; grade: string; team: string | null };
// One player's card: name, gender and grade, their team's name at the right (unless the team's card is inside).
export function PlayerCard({ c, team, children }: { c: PlayerLine; team?: null; children?: ReactNode }) {
  return (
    <section className={`space-y-3 rounded-2xl p-3 shadow-sm ring-1 sm:p-4 ${genderTint(c.gender) ?? ""}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-lg font-semibold">{c.name}</p>
          <p className="text-sm text-zinc-500">
            {c.gender} · {gradeLabel(c.grade)}
          </p>
        </div>
        {team === undefined && <span className="text-sm font-medium">{c.team ?? <span className="text-zinc-500">Team not set yet</span>}</span>}
      </div>
      {children}
    </section>
  );
}

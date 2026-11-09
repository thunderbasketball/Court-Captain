import { formatCell } from "@/lib/phone";
import { gradeLabel } from "@/lib/grades";
import type { TeamListItem } from "@/lib/teams";
import { EmailLink, PhoneLink } from "../../../ui";
import RosterPlayerRow from "./RosterPlayerRow";

// A team card's roster, opened by its 👥 count right on the card: name, grade and (for Owners and Admins) who rostered
// them, by last name. Tapping a player opens their parents (name, cell, email) and coach request.
export default function TeamRosterList({ team, who }: { team: Pick<TeamListItem, "players">; who: boolean }) {
  if (!team.players.length)
    return <p className="text-sm text-zinc-500">No players yet. Roster them from Players → Roster players.</p>;
  return (
    <ul className="divide-y divide-zinc-100 rounded-xl bg-zinc-50 px-3 dark:divide-white/5 dark:bg-white/5">
      {team.players.map((p) => (
        <RosterPlayerRow
          key={p.registrantId}
          line={
            <>
              <span>
                {p.first} <span className="font-semibold">{p.last}</span>
              </span>
              <span className="text-right text-xs text-zinc-400">
                {gradeLabel(p.grade)}
                {who && ` · Rostered by ${p.rosteredBy}`}
              </span>
            </>
          }
          more={
            <>
              {p.parents.length ? (
                p.parents.map((g, i) => (
                  <p key={i} className="flex flex-wrap gap-x-2">
                    <span className="font-medium">{g.name}</span>
                    {g.cell && <PhoneLink cell={g.cell} label={formatCell(g.cell)} />}
                    {g.email && <EmailLink email={g.email} />}
                  </p>
                ))
              ) : (
                <p className="text-zinc-400">No parent on file</p>
              )}
              {p.coachRequest && <p className="text-zinc-500">Coach request: {p.coachRequest}</p>}
            </>
          }
        />
      ))}
    </ul>
  );
}

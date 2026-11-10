import Link from "next/link";
import type { TeamPractice } from "@/lib/practice/schedule";
import type { OwnPractice } from "@/lib/team-practices";
import { TZ } from "@/lib/time";
import { OwnPracticeAdd, OwnPracticeRow } from "./OwnPractices";

const dayLabel = (d: Date) => d.toLocaleDateString("en-US", { timeZone: TZ, weekday: "short", month: "numeric", day: "numeric" });
const timeLabel = (d: Date) => d.toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });

// The Practices card's inside, for Thunder's teams and every organization's: the team's upcoming practices, soonest
// first, booked ones (an organization gym's slot, with ✓ Attendance) and its own-gym ones (a place it found itself, with
// its length, Weekly and Remove) together, then "+ Own gym practice" for the people who may add them.
export default function TeamPractices({
  org,
  teamId,
  booked,
  own,
  canChange,
  locations,
  today,
  who,
  empty,
  addHere = true,
}: {
  org: string;
  teamId: string;
  booked: TeamPractice[];
  own: OwnPractice[];
  canChange: boolean;
  locations: string[];
  today: string;
  who: boolean; // Owners and Admins see who booked or added it
  empty: string;
  addHere?: boolean; // false: "+ Own gym practice" is under Book practices instead
}) {
  const rows = [
    ...booked.map((p) => ({ kind: "booked" as const, at: p.startsAt.getTime(), p })),
    ...own.map((p) => ({ kind: "own" as const, at: p.startsAt.getTime(), p })),
  ].sort((a, b) => a.at - b.at);
  return (
    <>
      {!rows.length && <p className="px-4 pb-4 text-sm text-zinc-500">{empty}</p>}
      <ul className="divide-y divide-zinc-100 border-t border-zinc-100 dark:divide-white/5 dark:border-white/5">
        {rows.map((r) =>
          r.kind === "booked" ? (
            <li key={`b${r.p.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <Link
                href={`/events/practice/${r.p.id}`}
                className="font-semibold text-thunder-blue underline-offset-2 hover:underline dark:text-blue-400"
              >
                {dayLabel(r.p.startsAt)} · {timeLabel(r.p.startsAt)}
                <span className="block text-xs font-normal">✓ Attendance</span>
              </Link>
              <span className="text-right text-zinc-500">
                {r.p.gym} {r.p.court}
                {who && r.p.bookedBy && <span className="block text-xs text-zinc-400">by {r.p.bookedBy}</span>}
              </span>
            </li>
          ) : (
            <OwnPracticeRow
              key={`o${r.p.id}`}
              org={org}
              teamId={teamId}
              id={r.p.id}
              when={dayLabel(r.p.startsAt)}
              span={`${timeLabel(r.p.startsAt)}–${timeLabel(new Date(r.at + r.p.minutes * 60_000))}`}
              location={r.p.location}
              minutes={r.p.minutes}
              weekly={!!r.p.series}
              addedBy={who ? r.p.addedBy : null}
              canChange={canChange}
            />
          ),
        )}
      </ul>
      {canChange && addHere && <OwnPracticeAdd org={org} teamId={teamId} locations={locations} today={today} />}
    </>
  );
}

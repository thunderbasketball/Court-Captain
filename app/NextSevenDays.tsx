import type { ScheduledGame } from "@/lib/scenic-games";
import type { TeamPractice } from "@/lib/practice/schedule";
import type { OwnPractice } from "@/lib/team-practices";
import type { TeamScrimmage } from "@/lib/scrimmages";
import { eventHours, type Rsvp } from "@/lib/event-attendance";
import { shortDate } from "@/lib/program-options";
import { easternDate, zonedTime } from "@/lib/time";
import { EventLine } from "./EventAttendance";
import { scheduleItems } from "./LeagueGames";
import { card } from "./ui";

// The team page's "Next 7 days", just above Staff (Thunder's teams and every organization's): its published games,
// scrimmages, booked practices and own-gym practices from now through the next 7 days, by date and time. The team's staff (and the
// Directors) open each one for attendance; a viewer whose own children are on the team answers ✓ / ✗ for them right on
// the line, until the event starts.
export default function NextSevenDays({
  games,
  practices,
  own,
  scrims = [],
  now,
  team,
  staff,
  mine,
  rsvps,
}: {
  games: ScheduledGame[]; // published only
  practices: TeamPractice[]; // upcoming
  own: OwnPractice[]; // upcoming
  scrims?: TeamScrimmage[]; // upcoming
  now: Date;
  team: { org: string; teamId: string };
  staff: boolean; // takes the team's attendance
  mine: { player: string; firstName: string }[]; // the viewer's own children on the roster
  rsvps: Record<string, Record<string, Rsvp>>; // their answers, by "<kind><id>"
}) {
  const today = easternDate(now);
  const lastDay = easternDate(new Date(now.getTime() + 6 * 86_400_000));
  const until = new Date(now.getTime() + 7 * 86_400_000);
  const items = scheduleItems(
    games.filter((g) => g.date >= today && g.date <= lastDay),
    practices.filter((p) => p.startsAt < until),
    own.filter((p) => p.startsAt < until),
    scrims.filter((x) => x.startsAt < until),
  );
  const rsvpOpen = (date: string, time: string) => {
    const [y, m, d] = date.split("-").map(Number);
    const timed = time !== "99:99";
    const [hh, mm] = (timed ? time : "00:00").split(":").map(Number);
    return now < eventHours({ start: zonedTime(y, m, d, hh, mm), timed }).rsvpCloses;
  };
  return (
    <section className={`${card} p-4`}>
      <h2 className="mb-1 font-semibold">Next 7 days</h2>
      {items.length > 0 && (staff || mine.length > 0) && (
        <p className="mb-2 text-xs text-zinc-500">
          {mine.length > 0 && `✓ / ✗ whether ${mine.map((p) => p.firstName).join(" and ")} will be there. `}
          {staff && "Tap an event to take attendance."}
        </p>
      )}
      {!items.length ? (
        <p className="text-sm text-zinc-500">No games, scrimmages or practices in the next 7 days.</p>
      ) : (
        <ul className="divide-y divide-zinc-100 rounded-xl bg-zinc-50 px-3 text-sm dark:divide-white/5 dark:bg-white/5">
          {items.map((x) => {
            const key = `${x.event.kind}${x.event.id}`;
            return (
              <EventLine
                key={key}
                org={team.org}
                teamId={team.teamId}
                kind={x.event.kind}
                eventId={x.event.id}
                date={shortDate(x.date)}
                dim={x.date < today}
                staff={staff}
                mine={mine.map((p) => ({ ...p, rsvp: rsvps[key]?.[p.player] ?? null }))}
                rsvpOpen={rsvpOpen(x.date, x.time)}
              >
                {x.node}
              </EventLine>
            );
          })}
        </ul>
      )}
    </section>
  );
}

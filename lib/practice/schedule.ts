// Reading the practice schedule.
// The week grid: one Mon–Sun week, by day, then gym, then start time, then court.
//   Director view: every slot, with Release / Block / Unblock / Book.
//   Team view: the team's practice gyms, showing open slots, which teams practice when, and blocked times
//   (not who booked). Each open slot is marked bookable or not using the same limit rule the server enforces.
import type { Pool } from "pg";
import type { SessionUser } from "../auth/service";
import { TZ, localParts, weekOf, zonedTime } from "../time";
import { limitCheck, upcomingInWeek } from "./booking";
import { hasArea } from "../org-admin";

type Deps = { pool: Pool; now: () => Date };

export type GridSlot = {
  id: string;
  court: string;
  teamId: string | null;
  team: string | null;
  bookedBy: string | null;
  blackout: boolean;
  note: string | null;
  past: boolean;
  mine: boolean; // booked by the team being viewed
  canBook: boolean; // team view: this team may book it now
  reason: string | null; // team view: why not
};
export type GridTime = { label: string; slots: GridSlot[] };
export type GridDay = { iso: string; label: string; gyms: { gym: string; times: GridTime[] }[] };
export type TeamWeek = { id: string; name: string; booked: number; status: string; canBookRole: boolean };
export type WeekGrid = {
  label: string;
  prev: string;
  next: string;
  days: GridDay[];
  team: TeamWeek | null;
  counts: { open: number; booked: number; blocked: number };
};
export type GymWithCourts = { id: string; name: string; active: boolean; courts: { id: string; name: string; active: boolean }[] };

const isoOf = (d: Date) => {
  const p = localParts(d);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
};
const hourLabel = (d: Date) => {
  const p = localParts(d);
  return `${p.hour % 12 || 12}${p.minute ? `:${String(p.minute).padStart(2, "0")}` : ""} ${p.hour < 12 ? "AM" : "PM"}`;
};

// The Monday (Eastern) that starts the week to show: the one asked for, else this week,
// else the week of the next upcoming slot when this week has none.
export async function pickWeek(deps: Deps, asked: string | undefined): Promise<Date> {
  const m = asked?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return weekOf(zonedTime(+m[1], +m[2], +m[3], 12)).start;
  const now = deps.now();
  const w = weekOf(now);
  const here = await deps.pool.query("select 1 from slots where starts_at >= $1 and starts_at < $2 limit 1", [w.start, w.end]);
  if (here.rows[0]) return w.start;
  const next = await deps.pool.query<{ starts_at: Date }>("select starts_at from slots where starts_at > $1 order by starts_at limit 1", [
    now,
  ]);
  return next.rows[0] ? weekOf(next.rows[0].starts_at).start : w.start;
}

const BOOKING_ROLES = ["HeadCoach", "AsstCoach", "Manager"];

function teamStatus(booked: number): string {
  if (booked === 0) return "No practice booked this week. You can book 1.";
  if (booked === 1) return "1 practice this week. You can add 1 more only if it starts within the next 72 hours.";
  return `${booked} practices this week, the most allowed.`;
}

// viewAs: "director" (Director only) or a team id the viewer is on (or any team, for the Director).
export async function weekGrid(
  deps: Deps,
  viewer: SessionUser,
  weekStart: Date,
  viewAs: "director" | { teamId: string },
): Promise<WeekGrid> {
  const now = deps.now();
  const end = weekOf(weekStart).end;
  let team: (TeamWeek & { locations: string[] }) | null = null;
  if (viewAs === "director") {
    if (!hasArea(viewer, "practices")) throw new Error("Director only");
  } else {
    const t = await deps.pool.query<{ id: string; name: string; locations: string[]; role: string | null }>(
      `select t.id::text, t.name, t.practice_locations as locations,
              (select s.role from team_staff s where s.team_id = t.id and s.coach_id = $2
               order by array_position(array['HeadCoach','AsstCoach','Manager','TeamParent'], s.role) limit 1) as role
       from teams t where t.id = $1`,
      [viewAs.teamId, viewer.coachId],
    );
    const row = t.rows[0];
    if (!row || (!row.role && !hasArea(viewer, "practices"))) throw new Error("Not on this team");
    const booked = await upcomingInWeek(deps.pool, row.id, new Date(weekStart.getTime() + 12 * 3_600_000), now);
    team = {
      id: row.id,
      name: row.name,
      locations: row.locations.map((l) => l.toLowerCase()),
      booked,
      status: teamStatus(booked),
      canBookRole: hasArea(viewer, "practices") || BOOKING_ROLES.includes(row.role ?? ""),
    };
  }

  const r = await deps.pool.query<{
    id: string;
    startsAt: Date;
    gym: string;
    court: string;
    teamId: string | null;
    team: string | null;
    bookedBy: string | null;
    blackout: boolean;
    note: string | null;
  }>(
    `select s.id::text, s.starts_at as "startsAt", g.name as gym, c.name as court, s.team_id::text as "teamId", t.name as team,
            s.booked_by as "bookedBy", s.blackout, s.note
     from slots s join courts c on c.id = s.court_id join gyms g on g.id = c.gym_id left join teams t on t.id = s.team_id
     where s.starts_at >= $1 and s.starts_at < $2
     order by (s.starts_at at time zone '${TZ}')::date, g.name, s.starts_at, c.name`,
    [weekStart, end],
  );

  const days: GridDay[] = [];
  const counts = { open: 0, booked: 0, blocked: 0 };
  for (const row of r.rows) {
    const past = row.startsAt <= now;
    const mine = !!team && row.teamId === team.id;
    if (team) {
      // Coaches see their practice gyms: open slots, which teams practice when, and blocked times.
      // Past slots only for their own team.
      const atTeamGym = !team.locations.length || team.locations.includes(row.gym.toLowerCase());
      if (!mine && (past || !atTeamGym)) continue;
    }
    let canBook = false;
    let reason: string | null = null;
    if (team && !mine && !row.teamId && !row.blackout) {
      const check = limitCheck(team.booked, row.startsAt, now);
      // Same rule as a coach, even for the Director, in a team's view.
      canBook = team.canBookRole && check.ok;
      reason = !team.canBookRole ? "Team parents can view only." : check.ok ? null : check.reason;
    }
    if (!row.blackout && !row.teamId) counts.open++;
    if (row.teamId) counts.booked++;
    if (row.blackout) counts.blocked++;

    const iso = isoOf(row.startsAt);
    let day = days.at(-1);
    if (!day || day.iso !== iso) {
      day = {
        iso,
        label: row.startsAt.toLocaleDateString("en-US", { timeZone: TZ, weekday: "short", month: "numeric", day: "numeric" }),
        gyms: [],
      };
      days.push(day);
    }
    let g = day.gyms.at(-1);
    if (!g || g.gym !== row.gym) day.gyms.push((g = { gym: row.gym, times: [] }));
    const label = hourLabel(row.startsAt);
    let t = g.times.at(-1);
    if (!t || t.label !== label) g.times.push((t = { label, slots: [] }));
    t.slots.push({
      id: row.id,
      court: row.court,
      teamId: row.teamId,
      team: row.team,
      bookedBy: team ? null : row.bookedBy, // who booked is shown to the Director only
      blackout: row.blackout,
      note: row.note,
      past,
      mine,
      canBook,
      reason,
    });
  }
  const shift = (n: number) => isoOf(new Date(weekStart.getTime() + n * 86_400_000 + 12 * 3_600_000));
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { timeZone: TZ, month: "numeric", day: "numeric" });
  const lastDay = new Date(end.getTime() - 86_400_000);
  return {
    label: `Week of ${fmt(weekStart)} – ${fmt(lastDay)}/${localParts(lastDay).year}`,
    prev: shift(-7),
    next: shift(7),
    days,
    team: team && { id: team.id, name: team.name, booked: team.booked, status: team.status, canBookRole: team.canBookRole },
    counts,
  };
}

export async function listGyms(deps: Pick<Deps, "pool">): Promise<GymWithCourts[]> {
  const r = await deps.pool.query<GymWithCourts>(
    `select g.id::text, g.name, g.active,
            coalesce(json_agg(json_build_object('id', c.id::text, 'name', c.name, 'active', c.active) order by c.name) filter (where c.id is not null), '[]') as courts
     from gyms g left join courts c on c.gym_id = g.id where g.org = 'thunder' group by g.id order by g.name`,
  );
  return r.rows;
}

export type SeasonDay = { iso: string; day: number; open: number; booked: number; blocked: number };
export type SeasonMonth = { label: string; firstWeekday: number; days: SeasonDay[] };

// Director only. Every month from the first to the last practice slot, with per-day counts.
export async function seasonCalendar(deps: Deps, viewer: SessionUser): Promise<SeasonMonth[]> {
  if (!hasArea(viewer, "practices")) throw new Error("Director only");
  const r = await deps.pool.query<{ iso: string; open: number; booked: number; blocked: number }>(
    `select to_char(starts_at at time zone '${TZ}', 'YYYY-MM-DD') as iso,
            count(*) filter (where team_id is null and not blackout)::int as open,
            count(*) filter (where team_id is not null)::int as booked,
            count(*) filter (where blackout)::int as blocked
     from slots group by 1 order by 1`,
  );
  if (!r.rows.length) return [];
  const byDay = new Map(r.rows.map((x) => [x.iso, x]));
  const [fy, fm] = r.rows[0].iso.split("-").map(Number);
  const [ly, lm] = r.rows.at(-1)!.iso.split("-").map(Number);
  const months: SeasonMonth[] = [];
  for (let y = fy, m = fm; y < ly || (y === ly && m <= lm); m === 12 ? (y++, (m = 1)) : m++) {
    const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
    months.push({
      label: new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { timeZone: "UTC", month: "long", year: "numeric" }),
      firstWeekday: new Date(Date.UTC(y, m - 1, 1)).getUTCDay(),
      days: Array.from({ length: count }, (_, i) => {
        const iso = `${y}-${String(m).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`;
        const x = byDay.get(iso);
        return { iso, day: i + 1, open: x?.open ?? 0, booked: x?.booked ?? 0, blocked: x?.blocked ?? 0 };
      }),
    });
  }
  return months;
}

export type TeamPractice = { id: string; startsAt: Date; gym: string; court: string; bookedBy: string | null };

// A team's upcoming practices (for the team page). The caller checks the viewer may see the team.
export async function upcomingForTeam(deps: Deps, teamId: string, limit = 8): Promise<TeamPractice[]> {
  const r = await deps.pool.query<TeamPractice>(
    `select s.id::text, s.starts_at as "startsAt", g.name as gym, c.name as court, s.booked_by as "bookedBy"
     from slots s join courts c on c.id = s.court_id join gyms g on g.id = c.gym_id
     where s.team_id = $1 and s.starts_at + interval '60 minutes' > $2 order by s.starts_at limit $3`,
    [teamId, deps.now(), limit],
  );
  return r.rows;
}

export async function teamChoices(deps: Pick<Deps, "pool">): Promise<{ id: string; name: string }[]> {
  const r = await deps.pool.query<{ id: string; name: string }>(
    "select id::text, name from teams order by level = 'COMP' desc, gender, grade_sort, lower(name)",
  );
  return r.rows;
}

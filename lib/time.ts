// Thunder runs on Eastern time, wherever the server is. Practice times are stored as real instants (timestamptz)
// and converted with these helpers, so daylight-saving changes are handled.
export const TZ = "America/New_York";

export type LocalParts = { year: number; month: number; day: number; hour: number; minute: number; weekday: number }; // weekday 0 = Sunday

export function localParts(d: Date, tz = TZ): LocalParts {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      weekday: "short",
      hourCycle: "h23",
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday),
  };
}

// A wall-clock time in Eastern -> the real instant.
export function zonedTime(year: number, month: number, day: number, hour = 0, minute = 0, tz = TZ): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  // Shift by the zone's offset at that moment (twice, to settle across a DST change).
  let t = guess;
  for (let i = 0; i < 2; i++) {
    const p = localParts(new Date(t), tz);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    t += guess - asUtc;
  }
  return new Date(t);
}

// The booking week holding this instant: Monday 00:00 to the next Monday 00:00, Eastern.
export function weekOf(d: Date): { start: Date; end: Date } {
  const p = localParts(d);
  const back = (p.weekday + 6) % 7; // days since Monday
  const monday = new Date(Date.UTC(p.year, p.month - 1, p.day - back));
  const next = new Date(Date.UTC(p.year, p.month - 1, p.day - back + 7));
  return {
    start: zonedTime(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate()),
    end: zonedTime(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate()),
  };
}

// Same wall-clock time, n weeks later (stays at 6:00 PM across daylight-saving changes).
export function addWeeks(d: Date, n: number): Date {
  const p = localParts(d);
  const x = new Date(Date.UTC(p.year, p.month - 1, p.day + 7 * n));
  return zonedTime(x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate(), p.hour, p.minute);
}

// "11/9/2026 6:00 PM" (how the sheet shows practice times), read as Eastern.
export function parseSheetTime(v: string): Date | null {
  const m = v.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*([AP]M)$/i);
  if (!m) return null;
  let hour = Number(m[4]) % 12;
  if (m[6].toUpperCase() === "PM") hour += 12;
  return zonedTime(Number(m[3]), Number(m[1]), Number(m[2]), hour, Number(m[5]));
}

// A clock time "HH:MM" (24-hour) for people: "21:00" → "9:00 PM".
export function timeLabel(t: string): string {
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

// The Eastern calendar date of an instant, "YYYY-MM-DD".
export function easternDate(d: Date): string {
  const p = localParts(d);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

// A calendar date "YYYY-MM-DD" as "Jan 9, 2027" (no time zone shift: it's a date, not an instant).
export function dayLabel(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

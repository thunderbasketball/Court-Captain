// One-time import of the sheet's Gyms, PracticeSlots and BlackOuts tabs.
// Safe to run again: gyms, courts and slots already in the app (by Gym + Court + Time) are left as they are.
import type { Pool, PoolClient } from "pg";
import { withTx } from "../sql";
import { localParts, parseSheetTime } from "../time";

// The sheet's "North" / "South" are the two practice halves of one court, called Goal #1 / Goal #2 in the app.
const GOALS: Record<string, string> = { north: "Goal #1", south: "Goal #2" };
const courtName = (c: string) => GOALS[c.toLowerCase()] ?? c;

export type Problem = { row: number; tab: string; message: string };
type SheetSlot = {
  row: number;
  gym: string;
  court: string;
  startsAt: Date;
  team: string | null;
  blackout: boolean;
  blackoutNote: string | null; // "BLACKOUT: Thanksgiving" -> "Thanksgiving"
  bookedBy: string | null;
};
type SheetBlackout = { date: { y: number; m: number; d: number }; gym: string | null; time: string | null; note: string | null };
export type ParsedPractice = {
  courts: { gym: string; court: string; active: boolean }[];
  slots: SheetSlot[];
  blackouts: SheetBlackout[];
  errors: Problem[];
  warnings: Problem[];
};

const cols = (rows: string[][]) => {
  const h = (rows[0] ?? []).map((c) => c.trim().toLowerCase());
  return (r: string[], name: string) =>
    h.indexOf(name.toLowerCase()) < 0 ? "" : (r[h.indexOf(name.toLowerCase())] ?? "").trim();
};
const bool = (v: string) => /^(true|yes|1|x)$/i.test(v);
const clean = (v: string) => v.replace(/\s+/g, " ").trim();

export function parsePracticeTabs(tabs: { gyms: string[][]; slots: string[][]; blackouts: string[][] }): ParsedPractice {
  const out: ParsedPractice = { courts: [], slots: [], blackouts: [], errors: [], warnings: [] };

  const g = cols(tabs.gyms);
  tabs.gyms.slice(1).forEach((r, i) => {
    if (!r.some((c) => c.trim())) return;
    const gym = clean(g(r, "Gym"));
    const court = courtName(clean(g(r, "Court")));
    if (!gym || !court) return out.errors.push({ row: i + 2, tab: "Gyms", message: "Missing gym or court." });
    out.courts.push({ gym, court, active: g(r, "Active") === "" ? true : bool(g(r, "Active")) });
  });
  const known = new Set(out.courts.map((c) => `${c.gym}|${c.court}`.toLowerCase()));

  const s = cols(tabs.slots);
  const seen = new Set<string>();
  tabs.slots.slice(1).forEach((r, i) => {
    const row = i + 2;
    if (!r.some((c) => c.trim())) return;
    const fail = (message: string) => out.errors.push({ row, tab: "PracticeSlots", message });
    const gym = clean(s(r, "Gym"));
    const court = courtName(clean(s(r, "Court")));
    const startsAt = parseSheetTime(s(r, "Time"));
    if (!gym || !court) return fail("Missing gym or court.");
    if (!startsAt) return fail(`Can't read the time "${s(r, "Time")}".`);
    const key = `${gym}|${court}|${startsAt.toISOString()}`.toLowerCase();
    if (seen.has(key)) return fail(`${gym} ${court} at ${s(r, "Time")} appears twice.`);
    seen.add(key);
    if (!known.has(`${gym}|${court}`.toLowerCase())) {
      out.warnings.push({ row, tab: "PracticeSlots", message: `${gym} / ${court} isn't on the Gyms tab; it will be added.` });
      known.add(`${gym}|${court}`.toLowerCase());
      out.courts.push({ gym, court, active: true });
    }
    const teamText = clean(s(r, "Team"));
    const bm = teamText.match(/^blackout\b\s*:?\s*(.*)$/i);
    const blackout = !!bm;
    const team = teamText && !blackout ? teamText : null;
    if (!teamText && s(r, "Available") && !bool(s(r, "Available")))
      out.warnings.push({ row, tab: "PracticeSlots", message: "Marked not available but has no team; imported as open." });
    out.slots.push({
      row,
      gym,
      court,
      startsAt,
      team,
      blackout,
      blackoutNote: bm?.[1] || null,
      bookedBy: clean(s(r, "Booked By")) || null,
    });
  });

  const b = cols(tabs.blackouts);
  tabs.blackouts.slice(1).forEach((r, i) => {
    if (!r.some((c) => c.trim())) return;
    const m = b(r, "Date").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m)
      return out.warnings.push({ row: i + 2, tab: "BlackOuts", message: `Can't read the date "${b(r, "Date")}"; skipped.` });
    const gym = clean(b(r, "Gym"));
    const time = clean(b(r, "Time"));
    out.blackouts.push({
      date: { y: Number(m[3]), m: Number(m[1]), d: Number(m[2]) },
      gym: !gym || /^all/i.test(gym) ? null : gym,
      time: !time || /^all$/i.test(time) ? null : time,
      note: clean(b(r, "Notes")) || null,
    });
  });
  return out;
}

export type ImportReport = {
  gyms: number;
  courts: number;
  slotsNew: number;
  slotsExisting: number;
  booked: Record<string, number>;
  blackouts: number;
  blackoutDates: number;
  unknownTeams: string[];
};

class DryRun extends Error {
  constructor(public report: ImportReport) {
    super("dry run");
  }
}

export async function importPractice(
  pool: Pool,
  parsed: ParsedPractice,
  opts: { by: string; dryRun: boolean },
): Promise<ImportReport> {
  if (parsed.errors.length) throw new Error(`The sheet has ${parsed.errors.length} error(s); nothing was changed.`);
  try {
    return await withTx(pool, async (q) => {
      const report = await run(q, parsed, opts.by);
      if (opts.dryRun) throw new DryRun(report);
      // Never drop a booking: a team name the app doesn't know stops the import.
      if (report.unknownTeams.length)
        throw new Error(`Unknown team(s) in PracticeSlots: ${report.unknownTeams.join(", ")}. Nothing was changed.`);
      return report;
    });
  } catch (e) {
    if (e instanceof DryRun) return e.report;
    throw e;
  }
}

async function run(q: PoolClient, p: ParsedPractice, by: string): Promise<ImportReport> {
  const report: ImportReport = {
    gyms: 0,
    courts: 0,
    slotsNew: 0,
    slotsExisting: 0,
    booked: {},
    blackouts: 0,
    blackoutDates: 0,
    unknownTeams: [],
  };
  const courtId = new Map<string, string>();
  for (const c of p.courts) {
    const g = await q.query<{ id: string; created: boolean }>(
      `with ins as (insert into gyms (name) values ($1) on conflict (org, name) do nothing returning id::text, true as created)
       select * from ins union all select id::text, false from gyms where org = 'thunder' and name = $1 and not exists (select 1 from ins)`,
      [c.gym],
    );
    if (g.rows[0].created) report.gyms++;
    const ct = await q.query<{ id: string; created: boolean }>(
      `with ins as (insert into courts (gym_id, name, active) values ($1, $2, $3) on conflict (gym_id, name) do nothing returning id::text, true as created)
       select * from ins union all select id::text, false from courts where gym_id = $1 and name = $2 and not exists (select 1 from ins)`,
      [g.rows[0].id, c.court, c.active],
    );
    if (ct.rows[0].created) report.courts++;
    courtId.set(`${c.gym}|${c.court}`.toLowerCase(), ct.rows[0].id);
  }

  const teams = new Map(
    (await q.query<{ id: string; name: string }>("select id::text, name from teams")).rows.map((t) => [
      t.name.toLowerCase(),
      t.id,
    ]),
  );
  // Blackout notes by date (and gym/time when given).
  const noteFor = (s: SheetSlot) => {
    const lp = localParts(s.startsAt);
    const hit = p.blackouts.find(
      (b) =>
        b.date.y === lp.year &&
        b.date.m === lp.month &&
        b.date.d === lp.day &&
        (!b.gym || b.gym.toLowerCase() === s.gym.toLowerCase()) &&
        (!b.time ||
          b.time.replace(/\s/g, "").toLowerCase() ===
            `${lp.hour % 12 || 12}:${String(lp.minute).padStart(2, "0")}${lp.hour < 12 ? "am" : "pm"}`),
    );
    return hit?.note ?? null;
  };

  for (const s of p.slots) {
    let teamId: string | null = null;
    if (s.team) {
      teamId = teams.get(s.team.toLowerCase()) ?? null;
      if (!teamId && !report.unknownTeams.includes(s.team)) report.unknownTeams.push(s.team);
    }
    const blackout = s.blackout || (!teamId && !!noteFor(s) && !s.team);
    const r = await q.query(
      `insert into slots (court_id, starts_at, team_id, blackout, note, booked_by, created_by)
       values ($1, $2, $3, $4, $5, $6, $7) on conflict (court_id, starts_at) do nothing`,
      [
        courtId.get(`${s.gym}|${s.court}`.toLowerCase()),
        s.startsAt,
        teamId,
        blackout,
        blackout ? (s.blackoutNote ?? noteFor(s)) : null,
        teamId || blackout ? (s.bookedBy ?? by) : null,
        by,
      ],
    );
    if (!r.rowCount) {
      report.slotsExisting++;
      continue;
    }
    report.slotsNew++;
    if (blackout) report.blackouts++;
    if (teamId) report.booked[s.team!] = (report.booked[s.team!] ?? 0) + 1;
  }
  // The BlackOuts tab, so slots added later on those dates come in blocked.
  for (const b of p.blackouts) {
    const gymId = b.gym
      ? ((await q.query<{ id: string }>("select id::text from gyms where org = 'thunder' and lower(name) = lower($1)", [b.gym])).rows[0]?.id ?? null)
      : null;
    if (b.gym && !gymId) continue;
    const t = b.time?.match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i);
    const minute = t ? ((Number(t[1]) % 12) + (t[3].toUpperCase() === "PM" ? 12 : 0)) * 60 + Number(t[2]) : null;
    const r = await q.query(
      `insert into blackouts (day, gym_id, minute_of_day, reason, created_by) values (make_date($1, $2, $3), $4, $5, $6, $7)
       on conflict (day, coalesce(gym_id, 0), coalesce(minute_of_day, -1)) do nothing`,
      [b.date.y, b.date.m, b.date.d, gymId, minute, b.note, by],
    );
    report.blackoutDates += r.rowCount ?? 0;
  }
  return report;
}

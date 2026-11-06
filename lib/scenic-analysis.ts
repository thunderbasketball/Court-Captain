// Scenic City Home → Schedule analysis (SPEC.md section 13): for each upcoming Game Day, the teams and game slots of
// every organization, and what they say about the day (enough slots? enough home slots per organization? games still
// to make or place?). Admins and Directors of Scheduling only. Built from the Scheduler's own data (gameDaySchedule,
// dayGrid), so it always matches the Scheduler.
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { gameDaySchedule } from "./scenic-programs";
import { dayGrid, gridBlocks } from "./scenic-grid";

type Deps = { pool: Pool; now: () => Date };

export type OrgDay = {
  key: string;
  name: string;
  teams: number;
  rec: number;
  comp: number;
  coed: number; // Pre-K teams
  home: number; // games it's home in (TBD games included)
  away: number;
  gyms: number; // its gyms open that day
  courts: number;
  slots: number; // game slots at its gyms (courts × blocks)
  used: number; // slots filled at its gyms
  hours: string | null; // earliest open – latest close at its gyms ("9:00 AM–4:00 PM")
};
export type DayAnalysis = {
  date: string;
  lastDate: string; // the Brackets' last Bracket Day (the same as date for a Game Day)
  bracketDays: string[]; // the Brackets' days ([] for a Game Day)
  label: string; // "Winter League 2027 Brackets" (empty for a Game Day)
  brackets: boolean; // a League's Brackets (postseason): teams and slots over its Bracket Days, no matchups yet
  minutes: number;
  teams: number;
  gamesGuaranteed: number; // team-games promised (1GG = 1, 2GG = 2)
  games: number; // matchups made
  tbd: number;
  placed: number;
  slots: number;
  used: number;
  short: number; // teams with fewer games than guaranteed
  divisionsWithout: number; // divisions playing that day with no matchups yet
  orgs: OrgDay[];
  notes: { tone: "red" | "amber" | "green"; text: string }[];
};

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const clock = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export async function scheduleAnalysis(deps: Deps, viewer: SessionUser): Promise<DayAnalysis[] | null> {
  const s = await gameDaySchedule(deps, viewer); // null unless a Scheduler (checked there)
  if (!s) return null;
  // Every upcoming Game Day, and each League's Brackets (postseason) as one card over its Bracket Days.
  const last = (d: (typeof s.days)[number]) => d.programs.reduce((x, p) => (p.lastDate > x ? p.lastDate : x), d.date);
  const days = s.days.filter((d) => last(d) >= s.today);
  return Promise.all(
    days.map(async (day): Promise<DayAnalysis> => {
      const brackets = day.programs.every((p) => p.bracket);
      const leagues = day.programs.filter((p) => !p.bracket);
      const teams = (brackets ? day.programs : leagues).flatMap((p) => p.teams.filter((t) => !t.removedBy && !t.out));
      const playing = new Set(teams.map((t) => t.teamId));
      const matchups = leagues.flatMap((p) => p.matchups).filter((m) => playing.has(m.a) && (!m.b || playing.has(m.b)));
      // The Brackets: game slots summed over every Bracket Day.
      const dates = brackets ? [...new Set(day.programs.flatMap((p) => p.bracketDays))].sort() : [day.date];
      const grids = (await Promise.all(dates.map((d) => dayGrid(deps, viewer, d)))).filter((g) => !!g);
      const minutes = grids[0]?.minutes ?? 0;

      const orgs = new Map<string, OrgDay>();
      const org = (key: string, name: string) => {
        let o = orgs.get(key);
        if (!o) {
          o = {
            key,
            name,
            teams: 0,
            rec: 0,
            comp: 0,
            coed: 0,
            home: 0,
            away: 0,
            gyms: 0,
            courts: 0,
            slots: 0,
            used: 0,
            hours: null,
          };
          orgs.set(key, o);
        }
        return o;
      };
      const keyOf = (t: { partnerId: string | null; from: string }) => t.partnerId ?? `solo:${t.from}`;
      const byId = new Map(teams.map((t) => [t.teamId, t]));
      for (const t of teams) {
        const o = org(keyOf(t), t.from);
        o.teams++;
        if (t.divisionName.startsWith("Coed")) o.coed++;
        else if (t.level === "COMP") o.comp++;
        else o.rec++;
      }
      for (const m of matchups) {
        const [h, a] = m.home === "a" ? [m.a, m.b] : [m.b, m.a];
        const ht = h ? byId.get(h) : null;
        const at = a ? byId.get(a) : null;
        if (ht) org(keyOf(ht), ht.from).home++;
        if (at) org(keyOf(at), at.from).away++;
      }

      // Game slots: each court's blocks within its own hours (as on the Grid); a game is placed when it sits on one.
      const open = new Set<string>(); // "court@HH:MM"
      const allGyms = grids.flatMap((grid) => grid.gyms.map((g) => ({ ...g, minutes: grid.minutes })));
      const seenGym = new Set<string>();
      const seenCourt = new Set<string>();
      for (const g of allGyms) {
        const o = org(g.hostId, g.host);
        const opens = g.courts.reduce((x, c) => (c.starts < x ? c.starts : x), "23:59");
        const closes = g.courts.reduce((x, c) => (c.ends > x ? c.ends : x), "00:00");
        if (!seenGym.has(g.key)) o.gyms++;
        seenGym.add(g.key);
        for (const c of g.courts) {
          if (!seenCourt.has(c.id)) o.courts++;
          seenCourt.add(c.id);
          for (const [b, e] of gridBlocks(opens, closes, g.minutes))
            if (toMin(c.starts) <= toMin(b) && toMin(e) <= toMin(c.ends)) {
              open.add(`${c.id}@${b}`);
              o.slots++;
            }
        }
      }
      const hostOf = new Map(allGyms.flatMap((g) => g.courts.map((c) => [c.id, g.hostId] as const)));
      let placed = 0;
      for (const m of matchups)
        if (m.court && m.starts && open.has(`${m.court}@${m.starts}`)) {
          placed++;
          const host = hostOf.get(m.court);
          if (host) orgs.get(host)!.used++;
        }
      // Each organization's hours: earliest open to latest close across its gyms.
      for (const o of orgs.values()) {
        const cs = allGyms.filter((g) => g.hostId === o.key).flatMap((g) => g.courts);
        if (cs.length) {
          const a = cs.reduce((x, c) => (c.starts < x ? c.starts : x), "23:59");
          const b = cs.reduce((x, c) => (c.ends > x ? c.ends : x), "00:00");
          o.hours = `${clock(a)}–${clock(b)}`;
        }
      }

      // Games guaranteed vs matchups made, per team.
      const need = new Map(teams.map((t) => [t.teamId, t.note === "2GG" ? 2 : 1]));
      const got = new Map<string, number>();
      for (const m of matchups) for (const id of [m.a, m.b]) if (id) got.set(id, (got.get(id) ?? 0) + 1);
      const short = teams.filter((t) => (got.get(t.teamId) ?? 0) < need.get(t.teamId)!).length;
      const divisions = new Set(teams.map((t) => `${t.divisionId}`));
      const withGames = new Set(matchups.map((m) => m.divisionId));
      const divisionsWithout = [...divisions].filter((d) => !withGames.has(d)).length;

      const slots = [...orgs.values()].reduce((n, o) => n + o.slots, 0);
      const gamesGuaranteed = teams.reduce((n, t) => n + need.get(t.teamId)!, 0);
      const expected = matchups.length || Math.ceil(gamesGuaranteed / 2); // before matchups: about half the team-games
      const list = [...orgs.values()].sort((a, b) => a.name.localeCompare(b.name));

      // What the numbers say, most urgent first.
      const notes: DayAnalysis["notes"] = [];
      if (brackets)
        notes.push(
          slots
            ? {
                tone: "green",
                text: `${plural(slots, "game slot")} over ${plural(dates.length, "Bracket Day")} for ${plural(teams.length, "team")}.`,
              }
            : {
                tone: "red",
                text: "No game slots open on the Bracket Days yet: hosting sites add court hours under Facilities.",
              },
        );
      if (!brackets) {
        if (!slots) notes.push({ tone: "red", text: "No game slots open yet: hosting sites add court hours under Facilities." });
        else if (expected > slots)
          notes.push({
            tone: "red",
            text: `About ${plural(expected, "game")} but only ${plural(slots, "slot")}: ${expected - slots} short.`,
          });
        else
          notes.push({
            tone: "green",
            text: `${plural(slots, "slot")} for about ${plural(expected, "game")} (${Math.round((expected / slots) * 100)}% full).`,
          });
        for (const o of list) {
          if (o.home > 0 && !o.slots)
            notes.push({
              tone: "amber",
              text: `${o.name}: ${plural(o.home, "home game")} and no gym open (they go to No home gym).`,
            });
          else if (o.home > o.slots)
            notes.push({
              tone: "amber",
              text: `${o.name}: ${plural(o.home, "home game")} but ${plural(o.slots, "slot")} at its gyms.`,
            });
          if (o.slots > 0 && !o.teams)
            notes.push({ tone: "green", text: `${o.name} hosts (${plural(o.slots, "slot")}) with no teams playing.` });
        }
        if (divisionsWithout)
          notes.push({ tone: "amber", text: `${plural(divisionsWithout, "division")} with no matchups yet.` });
        if (short && matchups.length)
          notes.push({ tone: "amber", text: `${plural(short, "team")} short of their games guaranteed.` });
        const tbd = matchups.filter((m) => !m.b).length;
        if (tbd) notes.push({ tone: "amber", text: `${plural(tbd, "TBD game")} (no opponent yet).` });
        if (matchups.length && placed < matchups.length)
          notes.push({ tone: "amber", text: `${plural(matchups.length - placed, "game")} not placed on the Grid yet.` });
        if (matchups.length && placed === matchups.length) notes.push({ tone: "green", text: "Every game is on the Grid." });
      }

      return {
        date: day.date,
        lastDate: last(day),
        bracketDays: brackets ? dates : [],
        label: brackets ? day.programs.map((p) => `${p.programName} Brackets`).join(" · ") : "",
        brackets,
        minutes,
        teams: teams.length,
        gamesGuaranteed,
        games: matchups.length,
        tbd: matchups.filter((m) => !m.b).length,
        placed,
        slots,
        used: placed,
        short,
        divisionsWithout,
        orgs: list,
        notes,
      };
    }),
  );
}

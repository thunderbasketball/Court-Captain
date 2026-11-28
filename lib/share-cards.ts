// Pictures an organization's visitors share (SPEC.md section 14): marketing and information made from what its public page
// already shows, the same for every organization. No people: team names, counts, gyms, dates, published games and
// standings. The words and numbers here; drawn by app/share.
import { createHash } from "node:crypto";
import type { GamesOfTheWeek, GotwGame } from "./games-of-week";
import type { PublicLeague } from "./public-league";
import {
  daysUntil,
  type HostDay,
  type ProgramCounts,
  type PublicGym,
} from "./public-org";
import type { PublicFinal } from "./score-share";
import { shortDate } from "./program-options";
import { groupSlug } from "./share-keys";
import { timeLabel } from "./time";

export type ShareCard = {
  key: string; // in its address
  label: string; // under its picture on the page
  kicker: string; // small, above the title
  title: string;
  big: { value: string; label: string } | null; // one number, large
  tiles: { value: number; label: string }[];
  // side: at the right (a record, a time). A game: `game` stacks its teams (the away team, then "at" the home team) over its
  // gym, all teams the same size; `text` is the one-line version.
  lines: {
    text: string;
    side?: string;
    game?: { top: string; bottom: string; place: string | null };
  }[];
  tall?: true; // games stacked in a tall picture (phone-screen shape): more than 4 games
  foot: string; // what to do: "Register your team"
  href: string; // where its link leads
  text: string; // the words that go with it
};

export const cardVersion = (c: ShareCard) =>
  createHash("sha1").update(JSON.stringify(c)).digest("hex").slice(0, 8);

const line = (text: string, side?: string) =>
  side === undefined ? { text } : { text, side };
// A game's line: "Team A" over "at Team B" over its gym (and court), the time (or score) at the right.
const gameLine = (
  top: string,
  joiner: "at" | "vs",
  other: string,
  gym: string | null | undefined,
  court: string | null | undefined,
  side: string,
) => ({
  text: `${top} ${joiner} ${other}`,
  side,
  game: {
    top,
    bottom: `${joiner} ${other}`,
    place: gym ? [gym, court].filter(Boolean).join(", ") : null,
  },
});
const when = (starts: string | null) => (starts ? timeLabel(starts) : "TBA");
// Games in one tall picture (two columns of 13); more make "1 of 2", "2 of 2"..., each its own picture ("-2" on its key).
export const TALL_MAX = 26;
function tallParts(c: ShareCard): ShareCard[] {
  if (c.lines.length <= 4) return [c];
  if (c.lines.length <= TALL_MAX) return [{ ...c, tall: true }];
  const n = Math.ceil(c.lines.length / TALL_MAX);
  return Array.from({ length: n }, (_, i) => ({
    ...c,
    tall: true as const,
    key: i ? `${c.key}-${i + 1}` : c.key,
    label: `${c.label} (${i + 1} of ${n})`,
    kicker: `${c.kicker} · ${i + 1} of ${n}`,
    lines: c.lines.slice(i * TALL_MAX, (i + 1) * TALL_MAX),
  }));
}
const s = (n: number, one: string) => (n === 1 ? one : `${one}s`);
const longDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
const base = {
  big: null,
  tiles: [] as ShareCard["tiles"],
  lines: [] as ShareCard["lines"],
};

export type ShareInput = {
  org: string;
  name: string;
  today: string;
  own: {
    id: string;
    name: string;
    startsOn: string;
    endsOn: string;
    regCloses: string;
    register: boolean;
    recLimited: boolean;
    divisions: string[];
  }[];
  leagues: { name: string; orgName: string; startsOn: string }[];
  teams: number;
  counts: ProgramCounts;
  gyms: PublicGym[];
  hosting: boolean;
  recruiting: string[]; // the organizations taking applications to officiate
  openable: boolean;
  week: GamesOfTheWeek | null;
  // Its own teams' published League games (with finals once scored), and the coming day of games at its gyms.
  games?: OurGame[];
  gymDay?: HostDay | null;
};
export type OurGame = {
  team: string;
  date: string;
  starts: string | null;
  opponent: string;
  home: boolean;
  final: PublicFinal | null;
  gym?: string | null;
  court?: string | null;
};

// A final from its team's side: W or L, its points first ("W 30-23", "W Forfeit"). Null: not played.
function result(g: OurGame): { won: boolean; text: string } | null {
  const f = g.final;
  if (!f) return null;
  const side = g.home ? "home" : "away";
  if (f.forfeit) return { won: f.forfeit !== side, text: "Forfeit" };
  if (f.home === null || f.away === null) return null;
  const [us, them] = g.home ? [f.home, f.away] : [f.away, f.home];
  return { won: us > them, text: `${us}-${them}` };
}

// Pure: what people care about from its teams' games: the last Game Day's results, the next Game Day's games, the games at
// its gyms, and its teams' records this season. Most timely first.
function gameCards(h: ShareInput, page: string): ShareCard[] {
  const out: ShareCard[] = [];
  const games = h.games ?? [];
  const played = games.filter((g) => result(g));
  // Results: its latest Game Day with finals, for a week after it.
  const last = played
    .map((g) => g.date)
    .sort()
    .at(-1);
  if (last && daysUntil(last, h.today) <= 6) {
    const day = played
      .filter((g) => g.date === last)
      .sort(
        (a, b) =>
          (a.starts ?? "").localeCompare(b.starts ?? "") ||
          a.team.localeCompare(b.team),
      );
    const w = day.filter((g) => result(g)!.won).length;
    out.push({
      ...base,
      key: "results",
      label: "Game Day results",
      kicker: longDate(last),
      title: "Game Day results",
      big: {
        value: `${w}–${day.length - w}`,
        label: `our ${s(day.length, "game")}`,
      },
      lines: day.map((g) => {
        const r = result(g)!;
        return line(
          `${g.team} ${g.home ? "vs" : "at"} ${g.opponent}`,
          `${r.won ? "W" : "L"} ${r.text}`,
        );
      }),
      foot: "Every final and standings",
      href: page,
      text: `${h.name} on ${longDate(last)}: ${w} ${s(w, "win")}, ${day.length - w} ${day.length - w === 1 ? "loss" : "losses"}.`,
    });
  }
  // The next Game Day: its teams' games, by time.
  const next = games
    .filter((g) => g.date >= h.today && !g.final)
    .map((g) => g.date)
    .sort()[0];
  if (next) {
    const day = games
      .filter((g) => g.date === next && !g.final)
      .sort(
        (a, b) =>
          (a.starts ?? "99").localeCompare(b.starts ?? "99") ||
          a.team.localeCompare(b.team),
      )
      // Two of its own teams playing each other: the game once (from the home team's side).
      .filter((g, i, all) => {
        const twin = all.findIndex((x) => x.starts === g.starts && x.team === g.opponent && x.opponent === g.team);
        return twin < 0 || g.home || (!all[twin].home && i < twin);
      });
    out.push(
      ...tallParts({
        ...base,
        key: "next-games",
        label: "Our next games",
        kicker: longDate(next),
        title:
          day.length === 1 ? "Our next game" : `Our next ${day.length} games`,
        lines: day.map((g) =>
          gameLine(
            g.team,
            g.home ? "vs" : "at",
            g.opponent,
            g.gym,
            g.court,
            when(g.starts),
          ),
        ),
        foot: "Times, gyms and directions",
        href: page,
        text: `${h.name}: ${day.length} ${s(day.length, "game")} ${longDate(next)}. Come cheer us on!`,
      }),
    );
  }
  // Games at its gyms on the coming day.
  if (h.gymDay?.games.length) {
    const d = h.gymDay;
    const where = [
      ...new Set(d.games.map((g) => g.gym).filter((x): x is string => !!x)),
    ];
    out.push(
      ...tallParts({
        ...base,
        key: "gym-games",
        label: "Games at our gym",
        kicker: longDate(d.date),
        title: `${d.games.length} ${s(d.games.length, "game")} at ${where.length === 1 ? where[0] : "our gyms"}`,
        lines: d.games.map((g) =>
          gameLine(g.away, "at", g.home, g.gym, g.court, when(g.starts)),
        ),
        foot: "Get directions",
        href: `${page}#gyms`,
        text: `${d.games.length} ${s(d.games.length, "game")} at ${where.join(" and ") || h.name} on ${longDate(d.date)}. Come watch!`,
      }),
    );
  }
  // The season so far: its teams' combined record, the best records first.
  if (played.length) {
    const rec = new Map<string, { w: number; l: number }>();
    for (const g of played) {
      const r = rec.get(g.team) ?? { w: 0, l: 0 };
      if (result(g)!.won) r.w++;
      else r.l++;
      rec.set(g.team, r);
    }
    const w = [...rec.values()].reduce((n, r) => n + r.w, 0);
    const l = played.length - w;
    out.push({
      ...base,
      key: "season",
      label: "Our season so far",
      kicker: h.name,
      title: "Our season so far",
      big: { value: `${w}–${l}`, label: "all our teams" },
      lines: [...rec]
        .sort(([a, x], [b, y]) => y.w - x.w || x.l - y.l || a.localeCompare(b))
        .map(([team, r]) => line(team, `${r.w}–${r.l}`)),
      foot: "Standings by grade",
      href: page,
      text: `${h.name} this season: ${w}–${l} across our teams.`,
    });
  }
  return out;
}

// Pure: the pictures on an organization's page, the most timely first.
export function shareCards(h: ShareInput): ShareCard[] {
  const page = `/login/${h.org}`;
  const out: ShareCard[] = gameCards(h, page);
  const open = h.own
    .filter((p) => p.register)
    .sort((a, b) => a.regCloses.localeCompare(b.regCloses))[0];
  const current = h.own.find((p) => p.endsOn >= h.today);
  if (open) {
    out.push({
      ...base,
      key: "register",
      label: "Register a new team",
      kicker: open.name,
      title: "New team registration is open",
      lines: [
        line(
          "Season",
          `${shortDate(open.startsOn)} – ${shortDate(open.endsOn)}`,
        ),
        line("Register by", shortDate(open.regCloses)),
        ...(open.recLimited
          ? [line("COMP", "Open to all"), line("REC", "Invited organizations")]
          : []),
      ],
      foot: "Register a new team",
      href: `/register-team/${h.org}?program=${open.id}`,
      text: `${h.name}: ${open.name} new team registration is open through ${shortDate(open.regCloses)}.`,
    });
    if (open.divisions.length)
      out.push({
        ...base,
        key: "divisions",
        label: "Divisions",
        kicker: open.name,
        title: "Find your division",
        lines: open.divisions.map((d) => line(d)),
        foot: "Register a new team",
        href: `/register-team/${h.org}?program=${open.id}`,
        text: `${h.name} ${open.name} divisions: ${open.divisions.join(", ")}.`,
      });
  }
  const start = [
    ...h.own.map((p) => ({ name: p.name, startsOn: p.startsOn })),
    ...h.leagues.map((p) => ({
      name: `${p.orgName} ${p.name}`.trim(),
      startsOn: p.startsOn,
    })),
  ]
    .filter((p) => p.startsOn > h.today)
    .sort((a, b) => a.startsOn.localeCompare(b.startsOn))[0];
  const days = start ? daysUntil(h.today, start.startsOn) : 0;
  if (start && days <= 60)
    out.push({
      ...base,
      key: "tipoff",
      label: "Tip-off countdown",
      kicker: start.name,
      title: "Tip-off is coming",
      big: { value: String(days), label: s(days, "day") + " to go" },
      lines: [line(longDate(start.startsOn))],
      foot: "Teams, schedules and standings",
      href: page,
      text: `${days} ${s(days, "day")} to tip-off! ${start.name} starts ${longDate(start.startsOn)}.`,
    });
  const recap = h.week?.mode === "recap";
  const score = (g: GotwGame) => {
    const f = g.final;
    if (!f) return "Final soon";
    if (f.forfeit) return "Forfeit";
    return `${f.away}-${f.home}`;
  };
  for (const [level, games] of [
    ["REC", h.week?.rec ?? []],
    ["COMP", h.week?.comp ?? []],
  ] as const)
    if (h.week?.day && games.length) {
      const name = recap
        ? `${level} Game Recaps`
        : `${level} Upcoming Game Highlights`;
      out.push({
        ...base,
        key: `games-${level.toLowerCase()}`,
        label: name,
        kicker: longDate(h.week.day),
        title: name,
        lines: games.map((g) =>
          recap
            ? gameLine(g.away.name, "at", g.home.name, g.gym, g.court, score(g))
            : gameLine(
                `${g.away.name} (${g.away.w}–${g.away.l})`,
                "at",
                `${g.home.name} (${g.home.w}–${g.home.l})`,
                g.gym,
                g.court,
                when(g.starts),
              ),
        ),
        foot: recap ? "Every final and standings" : "See where they play",
        href: page,
        text: `${h.name}: ${name}, ${longDate(h.week.day)}.`,
      });
    }
  if (current && h.counts.teams) {
    out.push({
      ...base,
      key: "numbers",
      label: "By the numbers",
      kicker: current.name,
      title: "By the numbers",
      tiles: [
        { value: h.counts.teams, label: s(h.counts.teams, "team") },
        { value: h.counts.divisions, label: s(h.counts.divisions, "division") },
        { value: h.counts.orgs, label: s(h.counts.orgs, "organization") },
      ].filter((t) => t.value > 0),
      foot: "See every team",
      href: page,
      text: `${h.name} ${current.name}: ${h.counts.teams} ${s(h.counts.teams, "team")}, ${h.counts.divisions} ${s(h.counts.divisions, "division")}.`,
    });
  }
  if (h.recruiting.length)
    out.push({
      ...base,
      key: "officials",
      label: "Officials wanted",
      kicker: h.recruiting.join(" · "),
      title: "Officials wanted",
      lines: [
        line("Referee youth basketball games"),
        line("Apply online"),
        line("No login needed"),
      ],
      foot: "Apply to officiate",
      href: `${page}#officials`,
      text: `${h.recruiting.join(" and ")} ${h.recruiting.length === 1 ? "is" : "are"} looking for youth basketball officials. Apply online.`,
    });
  return out;
}

// Pure: a grade group's standings (once a team has played) or its coming Game Day's games (once published). Null: neither.
export function groupCard(
  org: string,
  league: PublicLeague,
  key: string,
  today: string,
): ShareCard | null {
  const m = /^(standings|schedule)\.\d{1,18}\.([a-z0-9-]{1,60})$/.exec(key);
  const g = m && league.groups.find((x) => groupSlug(x.label) === m[2]);
  if (!m || !g) return null;
  const href = `/login/${org}`;
  if (m[1] === "standings") {
    if (!g.teams.some((t) => t.w + t.l > 0)) return null;
    return {
      ...base,
      key,
      label: `${g.label} standings`,
      kicker: `${league.name} · ${g.label}`,
      title: "Standings",
      lines: g.teams.map((t, i) =>
        line(`${i + 1}. ${t.name}`, `${t.w}–${t.l}`),
      ),
      foot: "See every standing",
      href,
      text: `${league.name} ${g.label} standings.`,
    };
  }
  const day = league.schedule?.find(
    (d) => d.date >= today && d.games.some((x) => x.group === g.label),
  );
  if (!day) return null;
  const games = day.games.filter((x) => x.group === g.label);
  return {
    ...base,
    key,
    label: `${g.label} games`,
    kicker: `${league.name} · ${g.label}`,
    title: longDate(day.date),
    lines: games.map((x) =>
      gameLine(x.away, "at", x.home, x.gym, x.court, when(x.starts)),
    ),
    ...(games.length > 4 ? { tall: true as const } : {}),
    foot: "Gyms and directions",
    href,
    text: `${league.name} ${g.label} games, ${longDate(day.date)}.`,
  };
}

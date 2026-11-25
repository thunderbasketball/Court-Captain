// Pictures an organization's visitors share (SPEC.md section 14): marketing and information made from what its public page
// already shows, the same for every organization. No people: team names, counts, gyms, dates, published games and
// standings. The words and numbers here; drawn by app/share.
import { createHash } from "node:crypto";
import type { GamesOfTheWeek } from "./games-of-week";
import type { PublicLeague } from "./public-league";
import { daysUntil, type ProgramCounts, type PublicGym } from "./public-org";
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
  lines: { text: string; side?: string }[]; // side: at the right (a record, a time)
  foot: string; // what to do: "Register your team"
  href: string; // where its link leads
  text: string; // the words that go with it
};

export const cardVersion = (c: ShareCard) => createHash("sha1").update(JSON.stringify(c)).digest("hex").slice(0, 8);

const line = (text: string, side?: string) => (side === undefined ? { text } : { text, side });
const s = (n: number, one: string) => (n === 1 ? one : `${one}s`);
const longDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
const base = { big: null, tiles: [] as ShareCard["tiles"], lines: [] as ShareCard["lines"] };

export type ShareInput = {
  org: string;
  name: string;
  today: string;
  own: { id: string; name: string; startsOn: string; endsOn: string; regCloses: string; register: boolean; recLimited: boolean; divisions: string[] }[];
  leagues: { name: string; orgName: string; startsOn: string }[];
  teams: number;
  counts: ProgramCounts;
  gyms: PublicGym[];
  hosting: boolean;
  recruiting: string[]; // the organizations taking applications to officiate
  openable: boolean;
  week: GamesOfTheWeek | null;
};

// Pure: the pictures on an organization's page, the most timely first.
export function shareCards(h: ShareInput): ShareCard[] {
  const out: ShareCard[] = [];
  const page = `/login/${h.org}`;
  const open = h.own.filter((p) => p.register).sort((a, b) => a.regCloses.localeCompare(b.regCloses))[0];
  const current = h.own.find((p) => p.endsOn >= h.today);
  if (open) {
    out.push({
      ...base,
      key: "register",
      label: "Register a new team",
      kicker: open.name,
      title: "New team registration is open",
      lines: [
        line("Season", `${shortDate(open.startsOn)} – ${shortDate(open.endsOn)}`),
        line("Register by", shortDate(open.regCloses)),
        ...(open.recLimited ? [line("COMP", "Open to all"), line("REC", "Invited organizations")] : []),
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
    ...h.leagues.map((p) => ({ name: `${p.orgName} ${p.name}`.trim(), startsOn: p.startsOn })),
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
  for (const [level, games] of [["REC", h.week?.rec ?? []], ["COMP", h.week?.comp ?? []]] as const)
    if (h.week?.day && games.length)
      out.push({
        ...base,
        key: `games-${level.toLowerCase()}`,
        label: `${level} Games of the Week`,
        kicker: longDate(h.week.day),
        title: `${level} Games of the Week`,
        lines: games.map((g) => line(`${g.away.name} (${g.away.w}–${g.away.l}) at ${g.home.name} (${g.home.w}–${g.home.l})`, g.starts ? timeLabel(g.starts) : "TBA")),
        foot: "See where they play",
        href: page,
        text: `${h.name}: ${level} Games of the Week, ${longDate(h.week.day)}.`,
      });
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
  } else if (h.teams && h.leagues[0]) {
    const l = h.leagues[0];
    out.push({
      ...base,
      key: "teams",
      label: "Our teams",
      kicker: `${l.orgName} ${l.name}`.trim(),
      title: "Our teams are ready",
      big: { value: String(h.teams), label: `${s(h.teams, "team")} this season` },
      foot: "Follow your team",
      href: page,
      text: `${h.name} has ${h.teams} ${s(h.teams, "team")} in ${`${l.orgName} ${l.name}`.trim()}.`,
    });
  }
  if (h.openable)
    out.push({
      ...base,
      key: "follow",
      label: "Follow your team",
      kicker: h.name,
      title: "Follow your team all season",
      lines: [line("Game times, gyms and directions"), line("Final scores to share"), line("Standings by grade"), line("No login needed")],
      foot: "Tap the star by your team",
      href: page,
      text: `Follow your team at ${h.name}: schedules, scores and standings, no login needed.`,
    });
  if (h.recruiting.length)
    out.push({
      ...base,
      key: "officials",
      label: "Officials wanted",
      kicker: h.recruiting.join(" · "),
      title: "Officials wanted",
      lines: [line("Referee youth basketball games"), line("Apply online"), line("No login needed")],
      foot: "Apply to officiate",
      href: `${page}#officials`,
      text: `${h.recruiting.join(" and ")} ${h.recruiting.length === 1 ? "is" : "are"} looking for youth basketball officials. Apply online.`,
    });
  if (h.gyms.length && h.hosting)
    out.push({
      ...base,
      key: "gyms",
      label: "Our gyms",
      kicker: h.leagues[0] ? `${h.leagues[0].orgName} ${h.leagues[0].name}`.trim() : h.name,
      title: h.gyms.length === 1 ? "Our home court" : "Our home courts",
      lines: h.gyms.map((g) => line(g.name)),
      foot: "Get directions",
      href: `${page}#gyms`,
      text: `${h.name} hosts games at ${h.gyms.map((g) => g.name).join(", ")}.`,
    });
  return out;
}

// Pure: a grade group's standings (once a team has played) or its coming Game Day's games (once published). Null: neither.
export function groupCard(org: string, league: PublicLeague, key: string, today: string): ShareCard | null {
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
      lines: g.teams.map((t, i) => line(`${i + 1}. ${t.name}`, `${t.w}–${t.l}`)),
      foot: "See every standing",
      href,
      text: `${league.name} ${g.label} standings.`,
    };
  }
  const day = league.schedule?.find((d) => d.date >= today && d.games.some((x) => x.group === g.label));
  if (!day) return null;
  const games = day.games.filter((x) => x.group === g.label);
  return {
    ...base,
    key,
    label: `${g.label} games`,
    kicker: `${league.name} · ${g.label}`,
    title: longDate(day.date),
    lines: games.map((x) => line(`${x.away} at ${x.home}`, x.starts ? timeLabel(x.starts) : "TBA")),
    foot: "Gyms and directions",
    href,
    text: `${league.name} ${g.label} games, ${longDate(day.date)}.`,
  };
}

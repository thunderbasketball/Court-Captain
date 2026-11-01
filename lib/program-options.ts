// A League's Registration Options, picked at setup with a fee each. Shown after the League's name in parentheses,
// e.g. "Winter (26/27) (ALL Season)". GG = games guaranteed that day. Safe for the browser (no server code).
export const REG_OPTIONS = [
  { key: "all_season", name: "ALL Season", about: "1 game each Game Day + the brackets", perDate: false },
  { key: "single_1", name: "1 Game – Single Day", about: "1GG on the date picked", perDate: true },
  { key: "single_2", name: "2 Games – Single Day", about: "2GG on the date picked", perDate: true },
  { key: "single_2nd", name: "Add a 2nd Game", about: "A day the team already plays becomes 2GG", perDate: true },
] as const;
export type RegOptionKind = (typeof REG_OPTIONS)[number]["key"];
export type ProgramOption = { kind: RegOptionKind; feeCents: number | null };

export const optionName = (kind: string) => REG_OPTIONS.find((o) => o.key === kind)?.name ?? kind;
export const money = (c: number) => `$${(c / 100).toFixed(2).replace(/\.00$/, "")}`;

// ---- A team's League registration: what it picked, and what that gives it ----

export type SingleKind = "single_1" | "single_2nd" | "single_2";
export type Choice = { allSeason: boolean; days: { date: string; kind: SingleKind }[] };
export type ChoiceResult = {
  perDate: Record<string, 1 | 2>; // games guaranteed (GG) on each Game Day it plays
  bracket: boolean; // in the post-season: ALL Season, or at least half the Game Days
  feeCents: number; // ALL Season's fee + each Single Day option's fee per date
};

const shortDate = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

// Adds `add` to what the team already has (`had`) and checks it against the League's options and Game Days.
// Per date: ALL Season or 1 Game – Single Day = 1GG; Add a 2nd Game makes a day it already plays 2GG; 2 Games – Single
// Day = 2GG on a day it doesn't play otherwise.
export function planChoice(
  offered: ProgramOption[],
  gameDates: string[],
  had: Choice,
  add: Choice,
): { error: string } | { merged: Choice; result: ChoiceResult; newFeeCents: number } {
  const fee = (k: RegOptionKind) => offered.find((o) => o.kind === k)?.feeCents ?? 0;
  const isOffered = (k: RegOptionKind) => offered.some((o) => o.kind === k);
  const newAll = add.allSeason && !had.allSeason;
  if (newAll && !isOffered("all_season")) return { error: "This League doesn't offer ALL Season." };
  for (const d of add.days) {
    if (!isOffered(d.kind)) return { error: `This League doesn't offer ${optionName(d.kind)}.` };
    if (!gameDates.includes(d.date)) return { error: `${shortDate(d.date)} isn't one of this League's Game Days.` };
    if (had.days.some((x) => x.date === d.date && x.kind === d.kind))
      return { error: `Already registered: ${optionName(d.kind)} on ${shortDate(d.date)}.` };
  }
  const days = [
    ...had.days,
    ...add.days.filter((d, i) => add.days.findIndex((x) => x.date === d.date && x.kind === d.kind) === i),
  ];
  if (!newAll && days.length === had.days.length)
    return { error: add.allSeason ? "Already registered for ALL Season." : "Pick ALL Season or at least one date." };
  const allSeason = had.allSeason || add.allSeason;
  const perDate: Record<string, 1 | 2> = {};
  if (allSeason) for (const d of gameDates) perDate[d] = 1;
  for (const date of [...new Set(days.map((d) => d.date))]) {
    const has = (k: SingleKind) => days.some((d) => d.date === date && d.kind === k);
    const day = shortDate(date);
    if (has("single_1") && allSeason) return { error: `${day}: ALL Season already plays that day.` };
    if (has("single_2") && (allSeason || has("single_1")))
      return { error: `${day}: the team already plays that day. Pick Add a 2nd Game instead.` };
    if (has("single_2nd") && !(allSeason || has("single_1")))
      return { error: `${day}: Add a 2nd Game needs a game that day first (ALL Season or 1 Game – Single Day).` };
    perDate[date] = has("single_2") || has("single_2nd") ? 2 : 1;
  }
  const played = Object.keys(perDate).length;
  const total = (c: Choice) => (c.allSeason ? fee("all_season") : 0) + c.days.reduce((s, d) => s + fee(d.kind), 0);
  const merged = { allSeason, days };
  return {
    merged,
    result: { perDate, bracket: allSeason || (gameDates.length > 0 && played * 2 >= gameDates.length), feeCents: total(merged) },
    newFeeCents: total(merged) - total(had),
  };
}

// "Dec 5 1GG · Dec 12 2GG" for the dates a team plays (ALL Season: only the 2GG days, after "ALL Season").
export function entryLine(e: Choice & ChoiceResult): string {
  const days = Object.entries(e.perDate)
    .filter(([, gg]) => !e.allSeason || gg === 2)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([d, gg]) => `${shortDate(d)} ${gg}GG`);
  return [e.allSeason ? "ALL Season (1GG each Game Day)" : "", ...days].filter(Boolean).join(" · ");
}
export { shortDate };

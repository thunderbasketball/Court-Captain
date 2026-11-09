// CourtSolo accounts are organizations of this kind (lib/court-solo.ts). Kept apart so team-name code can use it
// without importing the account code.
export const SOLO_KIND = "Team";

// A team's name in a league: just its name for a CourtSolo team, else its organization's Abbreviation first
// ("ER 5B Harris"). `o` is the organizations row, `name` the team's name (SQL).
export const leagueNameSql = (o: string, name: string) =>
  `case when ${o}.kind = '${SOLO_KIND}' then ${name} else coalesce(${o}.abbr, upper(left(${o}.slug, 4))) || ' ' || ${name} end`;

// CourtSolo accounts are organizations of this kind (lib/court-solo.ts). Kept apart so team-name code can use it
// without importing the account code.
export const SOLO_KIND = "Team";

// A team's name in a league: its own name, with its organization's Abbreviation first for a REC team
// ("TB 8B Testing Basketball Smith"); a CourtSolo team's is always just its name. `o` is the organizations row, `name` the
// team's name and `level` its level (SQL).
export const leagueNameSql = (o: string, name: string, level: string) =>
  `case when ${o}.kind = '${SOLO_KIND}' or ${level} <> 'REC' then ${name}
        else coalesce(${o}.abbr, upper(left(${o}.slug, 4))) || ' ' || ${name} end`;

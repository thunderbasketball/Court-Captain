// CourtSolo accounts are organizations of this kind (lib/court-solo.ts). Kept apart so team-name code can use it
// without importing the account code.
export const SOLO_KIND = "Team";

// A team's name in a league: its own name ("5B Ft. O REC Pickett"; it already carries its organization or its Alternate
// name), except that an organization's Default Alternate name (Organization settings → General) takes its name's place
// for a team without an Alternate name of its own ("5B Thunder Johnson"). (Until Nov 23 a REC team's had its
// organization's Abbreviation first.) SQL: `o` is the organizations row, `t` the org_teams row, `name` the name to use.
export const leagueNameSql = (o: string, name: string, t = "t") =>
  `case when ${o}.default_alt_name is not null and ${t}.alt_name is null and not ${t}.own_name
        then replace(${name}, ' ' || coalesce(${o}.short_name, ${o}.name) || ' ', ' ' || ${o}.default_alt_name || ' ')
        else ${name} end`;

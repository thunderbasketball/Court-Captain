// The key of a League team's logo in team_logos (lib/team-logos), `t` being scenic_teams: the team it comes from (Thunder's
// "t:<id>" or an organization's "o:<id>"), or its own "s:<id>" for a Solo team. No imports: safe wherever it's used.
export const LEAGUE_TEAM_KEY_SQL = (t: string) =>
  `case when ${t}.thunder_team_id is not null then 't:' || ${t}.thunder_team_id when ${t}.org_team_id is not null then 'o:' || ${t}.org_team_id else 's:' || ${t}.id end`;

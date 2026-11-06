// Teams linked by their coaches (Head or Assistant): two teams sharing anyone are in one group, and so is a third team
// sharing someone with either (Sam coaches A and B, Ann assists B and C: A, B and C are one group). The Scheduler keeps
// a group all home or all away and gives it one color badge.
type Linked = { teamId: string; coaches: { key: string; name: string }[] };

// The groups of two or more teams, each in the teams' order.
export function coachGroups<T extends Linked>(teams: T[]): T[][] {
  const root = new Map<string, string>(teams.map((t) => [t.teamId, t.teamId]));
  const find = (id: string): string => {
    const r = root.get(id)!;
    if (r === id) return id;
    const top = find(r);
    root.set(id, top);
    return top;
  };
  const firstTeam = new Map<string, string>(); // coach key → the first team they coach
  for (const t of teams)
    for (const c of t.coaches) {
      const other = firstTeam.get(c.key);
      if (other) root.set(find(t.teamId), find(other));
      else firstTeam.set(c.key, t.teamId);
    }
  const groups = new Map<string, T[]>();
  for (const t of teams) groups.set(find(t.teamId), [...(groups.get(find(t.teamId)) ?? []), t]);
  return [...groups.values()].filter((g) => g.length > 1);
}

// The people in a group who coach more than one of its teams, most teams first, then by name.
export function sharedCoaches(group: Linked[]): { key: string; name: string; teams: string[] }[] {
  const by = new Map<string, { key: string; name: string; teams: string[] }>();
  for (const t of group)
    for (const c of t.coaches) {
      const x = by.get(c.key) ?? { key: c.key, name: c.name, teams: [] };
      if (!x.teams.includes(t.teamId)) x.teams.push(t.teamId);
      by.set(c.key, x);
    }
  return [...by.values()]
    .filter((x) => x.teams.length > 1)
    .sort((a, b) => b.teams.length - a.teams.length || a.name.localeCompare(b.name));
}

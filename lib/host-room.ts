// Sharing a Game Day's home games among the organizations that host (SPEC.md section 13). Pure.
export type HostCourt = { id: string; hostId: string; slots: number; divisions: string[] | null }; // divisions: only these (null: any)
export type HostUse = { hostId: string | null; divisionId: string; court?: string | null }; // a game already made, at home there
export type HostGroup = { id: string; divisionId: string; games: number; need: Map<string, number> }; // a division's level: its games, and each host's team-games in it

const takes = (c: HostCourt, d: string) => !c.divisions || c.divisions.includes(d);

// Each court's slots left: games on it take theirs; the others, in order, take one at their home organization, on a court for fewer
// divisions first, so one open to any is left for whoever needs it.
function slotsLeft(courts: HostCourt[], used: HostUse[]): Map<string, number> {
  const left = new Map(courts.map((c) => [c.id, c.slots]));
  const byHost = [...courts].sort((a, b) => (a.divisions?.length ?? 1e9) - (b.divisions?.length ?? 1e9));
  for (const u of used) if (u.court && left.has(u.court)) left.set(u.court, Math.max(0, left.get(u.court)! - 1));
  for (const u of used)
    if (!u.court) {
      const c = byHost.find((x) => x.hostId === u.hostId && takes(x, u.divisionId) && left.get(x.id)! > 0);
      if (c) left.set(c.id, left.get(c.id)! - 1);
    }
  return left;
}

// How many more home games each host has room for in a division.
export function hostRoom(courts: HostCourt[], used: HostUse[], divisionId: string): Map<string, number> {
  const left = slotsLeft(courts, used);
  const room = new Map<string, number>(courts.map((c) => [c.hostId, 0]));
  for (const c of courts) if (takes(c, divisionId)) room.set(c.hostId, room.get(c.hostId)! + left.get(c.id)!);
  return room;
}

// Each host's share of the home games in each group still to be made: as many games as possible get a home gym, the hosts' home games
// over the whole day (`base`: those already made) as even as they can be, never more than its teams there or its open slots allow.
// When there isn't room for all, earlier groups (as listed) come first. A minimum-cost flow: host → its courts' slots → (host, group)
// up to its teams' games → the group's games; a host's n-th home game of the day costs more than its (n-1)th.
export function hostShares(courts: HostCourt[], used: HostUse[], base: Map<string, number>, groups: HostGroup[]): Map<string, Map<string, number>> {
  const left = slotsLeft(courts, used);
  type Arc = { to: number; cap: number; cost: number; rev: number };
  const graph: Arc[][] = [];
  const ids = new Map<string, number>();
  const node = (k: string) => {
    if (!ids.has(k)) {
      ids.set(k, graph.length);
      graph.push([]);
    }
    return ids.get(k)!;
  };
  const arc = (a: string, b: string, cap: number, cost = 0) => {
    const [u, v] = [node(a), node(b)];
    graph[u].push({ to: v, cap, cost, rev: graph[v].length });
    graph[v].push({ to: u, cap: 0, cost: -cost, rev: graph[u].length - 1 });
    return graph[u][graph[u].length - 1];
  };
  const [S, T] = [node("S"), node("T")];
  const shares = new Map<string, Map<string, number>>(groups.map((g) => [g.id, new Map()]));
  const flows: { g: string; h: string; arc: Arc; cap: number }[] = [];
  for (const h of new Set(courts.map((c) => c.hostId))) {
    const most = groups.reduce((n, g) => n + (g.need.get(h) ?? 0), 0);
    const from = base.get(h) ?? 0;
    for (let k = 1; k <= most; k++) arc("S", `h${h}`, 1, (from + k) * 1000);
    for (const c of courts.filter((x) => x.hostId === h)) {
      arc(`h${h}`, `c${c.id}`, left.get(c.id)!);
      for (const g of groups) if (takes(c, g.divisionId) && g.need.get(h)) arc(`c${c.id}`, `x${h}/${g.id}`, left.get(c.id)!);
    }
    for (const g of groups) {
      const n = g.need.get(h) ?? 0;
      if (n) flows.push({ g: g.id, h, cap: n, arc: arc(`x${h}/${g.id}`, `g${g.id}`, n) });
    }
  }
  groups.forEach((g, i) => arc(`g${g.id}`, "T", g.games, i));
  for (;;) {
    // The cheapest way for one more game (Bellman–Ford: small graph, some arcs cost less than nothing).
    const dist = graph.map(() => Infinity);
    const via: ([number, number] | null)[] = graph.map(() => null);
    dist[S] = 0;
    for (let changed = true; changed; ) {
      changed = false;
      for (let u = 0; u < graph.length; u++)
        if (dist[u] < Infinity)
          graph[u].forEach((a, i) => {
            if (a.cap > 0 && dist[u] + a.cost < dist[a.to]) {
              dist[a.to] = dist[u] + a.cost;
              via[a.to] = [u, i];
              changed = true;
            }
          });
    }
    if (dist[T] === Infinity) break;
    for (let v = T; v !== S; ) {
      const [u, i] = via[v]!;
      graph[u][i].cap--;
      graph[v][graph[u][i].rev].cap++;
      v = u;
    }
  }
  for (const f of flows) if (f.cap - f.arc.cap > 0) shares.get(f.g)!.set(f.h, f.cap - f.arc.cap);
  return shares;
}

// The order a Game Day is planned and placed in: REC first, youngest to oldest, then COMP, youngest to oldest (Boys, Girls, Coed as
// the League lists them).
export const planOrder = <T extends { level: string; grade: number; index: number }>(list: T[]): T[] =>
  [...list].sort((a, b) => Number(a.level === "COMP") - Number(b.level === "COMP") || a.grade - b.grade || a.index - b.index);

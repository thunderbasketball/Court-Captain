// Every part of an organization (Teams, Facilities, Members, …) is a card on its Home, not its own page: the link that
// opens Home with that card open, and the part inside it when named (`sub`, e.g. Members → Staff). Other settings
// (like Teams' `view=register`) ride along for the part inside.
export function homeCardHref(home: string, card: string, sp: Record<string, string | string[] | undefined> = {}) {
  const q = new URLSearchParams({ open: card });
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v !== "string") continue;
    q.set(k === "open" ? "sub" : k, v);
  }
  return `${home}?${q}#${card}`;
}
export const membersHref = (home: string, sp: Record<string, string | string[] | undefined> = {}) => homeCardHref(home, "members", sp);

// On Home: what the part inside the open card is given (`sub` back to `open`).
export function innerParams(sp: Record<string, string | string[] | undefined>): Record<string, string | string[] | undefined> {
  const { open: _open, sub, ...rest } = sp;
  void _open;
  return { ...rest, open: typeof sub === "string" ? sub : undefined };
}

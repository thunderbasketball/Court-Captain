// Matchups → Grid on the same page: each game whose teams or home side just changed, so the Grid redraws at once instead of
// waiting for the page to reload (which follows and confirms it). home/away: team ids (null: TBD).
export type GameChange = { id: string; home: string | null; away: string | null };
const EVENT = "scheduler:games";

export function announce(changes: GameChange[]) {
  if (changes.length && typeof window !== "undefined") window.dispatchEvent(new CustomEvent<GameChange[]>(EVENT, { detail: changes }));
}

export function onGameChanges(fn: (changes: GameChange[]) => void): () => void {
  const h = (e: Event) => fn((e as CustomEvent<GameChange[]>).detail);
  window.addEventListener(EVENT, h);
  return () => window.removeEventListener(EVENT, h);
}

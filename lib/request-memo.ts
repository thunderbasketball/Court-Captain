// One page load asks the same small questions many times (is this person an Admin here? CourtCaptain staff?). While a
// page is being built, each answer from the shared pool is read once and reused for the rest of that page. Outside a
// page render (saving a change in a server action, scripts, tests) React's cache doesn't hold, so it always reads fresh;
// so does anything read inside a transaction.
import { cache } from "react";

const answers = cache(() => new Map<string, Promise<unknown>>());

export function memo<T>(q: object, key: string, read: () => Promise<T>): Promise<T> {
  if (!("totalCount" in q)) return read(); // a transaction's client, not the shared pool
  const seen = answers();
  let p = seen.get(key) as Promise<T> | undefined;
  if (!p) {
    p = read();
    seen.set(key, p);
    p.catch(() => seen.delete(key));
  }
  return p;
}

// Is a page being built right now (so answers are kept)? Outside a render each call gets a new, empty store.
export function remembering(): boolean {
  return answers() === answers();
}

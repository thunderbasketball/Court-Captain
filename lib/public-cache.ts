// The public pages (no login: the League page, an organization's main page, My Teams) keep what they read for 30
// seconds, so many parents looking at once (a Saturday morning) don't each rebuild it. Kept in this copy of the app's
// memory only, so each copy a host runs has its own. Only for what anyone may see: never anything read for a person who
// is logged in, never a permission, price or registration. Saving a change doesn't clear it: the public pages show it
// within 30 seconds.
export const PUBLIC_SECONDS = 30;
const MAX = 300; // answers kept at most; the oldest goes first

type Kept = { until: number; value: Promise<unknown> };
const g = globalThis as unknown as { publicAnswers?: Map<string, Kept> };
const answers = (g.publicAnswers ??= new Map<string, Kept>());

// `key`: everything the answer depends on. Visitors at the same moment share one read; a failed read isn't kept.
export function publicly<T>(key: string, read: () => Promise<T>, now: number = Date.now()): Promise<T> {
  const hit = answers.get(key);
  if (hit && now < hit.until) return hit.value as Promise<T>;
  const value = read();
  const kept: Kept = { until: now + PUBLIC_SECONDS * 1000, value };
  answers.delete(key); // to the end: newest last
  answers.set(key, kept);
  if (answers.size > MAX) answers.delete(answers.keys().next().value!);
  value.catch(() => {
    if (answers.get(key) === kept) answers.delete(key);
  });
  return value;
}

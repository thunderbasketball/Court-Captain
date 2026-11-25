// What spares can be ordered (no server code: the form uses it too).
import { SIZES } from "./uniform-fields";

export const SPARE_ITEMS = [
  { key: "set", one: "Uniform set", many: "Uniform sets", about: "Jersey and shorts" },
  { key: "jersey", one: "Jersey", many: "Jerseys", about: "Jersey only" },
  { key: "shirt", one: "Shooting shirt", many: "Shooting shirts", about: "" },
  { key: "shorts", one: "Shorts", many: "Shorts", about: "No number: how many of each size" },
] as const;
export type SpareItem = (typeof SPARE_ITEMS)[number]["key"];
export type Spare = { item: SpareItem; number: string | null; size: string; qty: number };
export const MAX_SPARES = 60; // of each numbered kind
export const MAX_SHORTS = 200; // of a size

export const sizeRank = (s: string) => (SIZES as readonly string[]).indexOf(s);

// Pure: what's being ordered, checked and put in order (sets, jerseys, shooting shirts by number; shorts by size), or what's
// wrong. "07" is the same jersey as "7"; "0" and "00" are different jerseys.
export function checkSpares(input: unknown): { ok: true; rows: Spare[] } | { ok: false; message: string } {
  const list = Array.isArray(input) ? input : [];
  const rows: Spare[] = [];
  for (const x of list as Record<string, unknown>[]) {
    const item = SPARE_ITEMS.find((i) => i.key === x?.item);
    if (!item) return { ok: false, message: "Pick what to order." };
    if (typeof x.size !== "string" || sizeRank(x.size) < 0) return { ok: false, message: `${item.many}: pick a size for each.` };
    if (item.key === "shorts") {
      const qty = Number(x.qty);
      if (!Number.isInteger(qty) || qty < 1 || qty > MAX_SHORTS) return { ok: false, message: `Shorts: how many of each size (1 to ${MAX_SHORTS}).` };
      if (rows.some((r) => r.item === "shorts" && r.size === x.size)) return { ok: false, message: "Shorts: each size once." };
      rows.push({ item: "shorts", number: null, size: x.size, qty });
      continue;
    }
    const n = typeof x.number === "string" ? x.number.trim() : "";
    if (!/^\d{1,2}$/.test(n)) return { ok: false, message: `${item.many}: a number (0 to 99) for each.` };
    rows.push({ item: item.key, number: n === "00" ? n : String(Number(n)), size: x.size, qty: 1 });
  }
  if (!rows.length) return { ok: false, message: "Nothing to order yet." };
  for (const i of SPARE_ITEMS)
    if (i.key !== "shorts" && rows.filter((r) => r.item === i.key).length > MAX_SPARES) return { ok: false, message: `${i.many}: at most ${MAX_SPARES} at a time.` };
  return { ok: true, rows: sortSpares(rows) };
}

// Sets, jerseys, shooting shirts (by number), then shorts (by size).
export function sortSpares<R extends Spare>(rows: R[]): R[] {
  const rank = (r: Spare) => SPARE_ITEMS.findIndex((i) => i.key === r.item);
  return [...rows].sort(
    (a, b) => rank(a) - rank(b) || Number(a.number ?? 0) - Number(b.number ?? 0) || (a.number ?? "").localeCompare(b.number ?? "") || sizeRank(a.size) - sizeRank(b.size),
  );
}
export const spareGroups = <R extends Spare>(rows: R[]) => SPARE_ITEMS.map((i) => ({ ...i, rows: rows.filter((r) => r.item === i.key) })).filter((g) => g.rows.length);
// "3 players and 14 spares", "14 spares", "1 player"
export const orderCounts = (players: number, spares: number, word = "player") =>
  [...(players || !spares ? [`${players} ${word}${players === 1 ? "" : "s"}`] : []), ...(spares ? [piecesLabel(spares)] : [])].join(" and ");

export const spareCount = (rows: Pick<Spare, "qty">[]) => rows.reduce((n, r) => n + r.qty, 0);
export const piecesLabel = (n: number) => `${n} spare${n === 1 ? "" : "s"}`;
// "2 uniform sets, 5 shorts"
export const spareSummary = (rows: Spare[]) =>
  SPARE_ITEMS.flatMap((i) => {
    const n = spareCount(rows.filter((r) => r.item === i.key));
    return n ? [`${n} ${(n === 1 ? i.one : i.many).toLowerCase()}`] : [];
  }).join(", ");

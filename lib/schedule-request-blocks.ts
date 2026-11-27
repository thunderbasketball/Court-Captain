// Schedule request time blocks and dates, shared by the server rules and the screens (no database code here).
export const BLOCKS = [
  { key: "09", label: "9 AM–12 PM", start: 9 * 60, end: 12 * 60 },
  { key: "12", label: "12–3 PM", start: 12 * 60, end: 15 * 60 },
  { key: "15", label: "3–6 PM", start: 15 * 60, end: 18 * 60 },
  { key: "18", label: "6–9 PM", start: 18 * 60, end: 21 * 60 },
] as const;
export type BlockKey = (typeof BLOCKS)[number]["key"];
export const MAX_BLOCKED = 2;

export const RULES_NOTE =
  "NO requests are taken after requests close. Play your scheduled game or sit out that week. If your request can't be met, you will not be scheduled.";

export const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// The last day requests are taken (through the end of that day, Eastern). REC (and Pre-K): `recDays` (14 unless the
// League set it) before the League's first Game Day. COMP: `compDays` before the Game Day, or (not set) the Sunday before.
export const REC_DAYS_DEFAULT = 14;
export function closesOn(
  level: string,
  day: string,
  firstDay: string,
  close: { compDays?: number | null; recDays?: number | null } = {},
): string {
  if (level !== "COMP") return addDays(firstDay, -(close.recDays ?? REC_DAYS_DEFAULT));
  if (close.compDays != null) return addDays(day, -close.compDays);
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(day, -(dow === 0 ? 7 : dow));
}

// Blocked blocks a game overlaps (start and length in minutes from midnight), from the League's blocks.
export function blockedBy(blocks: string[], start: number, minutes: number, defs: readonly Block[] = BLOCKS): string[] {
  return defs.filter((b) => blocks.includes(b.key) && start < b.end && b.start < start + minutes).map((b) => b.label);
}

// A League's own blocks and limit (its Schedule requests gear); without them, the 4 blocks above and up to 2.
export type Block = { key: string; label: string; start: number; end: number };
// compDays / recDays: when requests close (null: the Sunday before each Game Day / 14 days before the first).
export type RequestSettings = { blocks: Block[]; max: number; setBy: string | null; compDays: number | null; recDays: number | null };
export const DEFAULT_SETTINGS: RequestSettings = {
  blocks: BLOCKS.map((b) => ({ ...b })),
  max: MAX_BLOCKED,
  setBy: null,
  compDays: null,
  recDays: null,
};
export const MAX_BLOCKS = 8;

const two = (n: number) => String(n).padStart(2, "0");
// A block's key: its start, "09" on the hour (as the first blocks were), else "0930".
export const blockKey = (start: number) => (start % 60 ? `${two(Math.floor(start / 60))}${two(start % 60)}` : two(start / 60));
// "9 AM", "12:30 PM": a time from minutes after midnight.
const clock = (m: number) => {
  const h = Math.floor(m / 60) % 24;
  return `${h % 12 || 12}${m % 60 ? `:${two(m % 60)}` : ""}`;
};
const half = (m: number) => (Math.floor(m / 60) % 24 < 12 ? "AM" : "PM");
// "9 AM–12 PM", "12–3 PM" (AM/PM once when both match).
export const blockLabel = (start: number, end: number) =>
  half(start) === half(end) ? `${clock(start)}–${clock(end)} ${half(end)}` : `${clock(start)} ${half(start)}–${clock(end)} ${half(end)}`;
export const hhmm = (m: number) => `${two(Math.floor(m / 60))}:${two(m % 60)}`;
const minutesOf = (v: unknown) => {
  const t = typeof v === "string" ? /^(\d{1,2}):(\d{2})$/.exec(v.trim()) : null;
  if (!t || Number(t[1]) > 24 || Number(t[2]) > 59) return null;
  const m = Number(t[1]) * 60 + Number(t[2]);
  return m <= 24 * 60 ? m : null;
};

// Checks a League's settings ({ blocks: [{ start: "09:00", end: "12:00" }], max }): 2 to 8 blocks, each ending after it
// starts, none overlapping (sorted by start); up to `max` checked, fewer than the blocks so a team is free for one.
export function parseSettings(
  input: unknown,
): { ok: true; blocks: Block[]; max: number; compDays: number | null; recDays: number | null } | { ok: false; message: string } {
  const x = (input ?? {}) as { blocks?: unknown; max?: unknown; compDays?: unknown; recDays?: unknown };
  if (!Array.isArray(x.blocks) || x.blocks.length < 2 || x.blocks.length > MAX_BLOCKS)
    return { ok: false, message: `Set 2 to ${MAX_BLOCKS} time blocks.` };
  const blocks: Block[] = [];
  for (const b of x.blocks as { start?: unknown; end?: unknown }[]) {
    const start = minutesOf(b?.start);
    const end = minutesOf(b?.end);
    if (start === null || end === null) return { ok: false, message: "Each block needs a start and end time." };
    if (end <= start) return { ok: false, message: `A block must end after it starts (${hhmm(start)}).` };
    blocks.push({ key: blockKey(start), label: blockLabel(start, end), start, end });
  }
  blocks.sort((a, b) => a.start - b.start);
  for (let i = 1; i < blocks.length; i++)
    if (blocks[i].start < blocks[i - 1].end) return { ok: false, message: `${blocks[i - 1].label} and ${blocks[i].label} overlap.` };
  const max = Number(x.max);
  if (!Number.isInteger(max) || max < 1 || max >= blocks.length)
    return { ok: false, message: `Teams can check 1 to ${blocks.length - 1} blocks (they must be free for at least one).` };
  // Close days: blank keeps the standard rule; else a whole number of days.
  const days = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
  const compDays = days(x.compDays);
  const recDays = days(x.recDays);
  if (compDays !== null && (!Number.isInteger(compDays) || compDays < 0 || compDays > 30))
    return { ok: false, message: "COMP requests close 0 to 30 days before each Game Day (or leave it blank)." };
  if (recDays !== null && (!Number.isInteger(recDays) || recDays < 0 || recDays > 60))
    return { ok: false, message: "REC requests close 0 to 60 days before the first Game Day (or leave it blank)." };
  return { ok: true, blocks, max, compDays, recDays };
}


// The League's own blocks, by the hour (each hour as its start, 0–23): the hours its time blocks cover (9 AM to 9 PM: 9…20).
export function hourOptions(blocks: readonly Block[]): number[] {
  if (!blocks.length) return [];
  const from = Math.floor(Math.min(...blocks.map((b) => b.start)) / 60);
  const to = Math.ceil(Math.max(...blocks.map((b) => b.end)) / 60);
  return Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i);
}
// "9 AM", "1 PM": an hour's start.
export const hourLabel = (h: number) => `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`;
// Blocked hours as runs of time ("1–3 PM"), in minutes from midnight.
export function hourRuns(hours: readonly number[]): { label: string; start: number; end: number }[] {
  const out: { label: string; start: number; end: number }[] = [];
  for (const h of [...new Set(hours)].sort((a, b) => a - b)) {
    const last = out.at(-1);
    if (last && last.end === h * 60) last.end += 60;
    else out.push({ label: "", start: h * 60, end: h * 60 + 60 });
  }
  return out.map((r) => ({ ...r, label: blockLabel(r.start, r.end) }));
}

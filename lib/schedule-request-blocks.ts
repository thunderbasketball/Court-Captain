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

// The last day requests are taken (through the end of that day, Eastern). REC (and Pre-K): 14 days before the League's
// first Game Day. COMP: the Sunday before the Game Day.
export function closesOn(level: string, day: string, firstDay: string): string {
  if (level !== "COMP") return addDays(firstDay, -14);
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(day, -(dow === 0 ? 7 : dow));
}

// Blocked blocks a game overlaps (start and length in minutes from midnight).
export function blockedBy(blocks: string[], start: number, minutes: number): string[] {
  return BLOCKS.filter((b) => blocks.includes(b.key) && start < b.end && b.start < start + minutes).map((b) => b.label);
}


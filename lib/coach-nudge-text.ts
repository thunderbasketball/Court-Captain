// The words of a reminder to coaches (SPEC.md section 14; sent from lib/coach-nudges): one coach's email, with what's
// needed, why it matters, by when and how; and the one short text for all of them. Pure, so the page can preview it.
import { USE_DAYS } from "./coach-use";

export type NudgeKind = "use" | "rosters";
export type Recipient = {
  coachId: string;
  name: string;
  first: string;
  cell: string | null;
  email: string | null;
  teams: { name: string; missing: string[] }[];
  cc: string[]; // copied: their teams' whole staff and their teams' organizations' Owners, Admins and Directors of Teams
  last: { channel: "email" | "text"; by: string; at: string } | null; // the last reminder of this kind
};
export type NudgeContext = { org: string; orgName: string; link: string; sender: string; next: string | null; today: string };

const LONG = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
const SHORT = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);

// Pure: one coach's email: what's needed, why it matters, by when, and how.
export function nudgeEmail(kind: NudgeKind, r: Pick<Recipient, "first" | "teams">, c: NudgeContext, note = ""): { subject: string; text: string } {
  const teams = r.teams.map((t) => t.name);
  const teamList = teams.length <= 2 ? teams.join(" and ") : `${teams.slice(0, -1).join(", ")} and ${teams.at(-1)}`;
  const left = c.next ? daysBetween(c.today, c.next) : null;
  const sign = [`Thank you,`, c.sender, c.orgName];
  const personal = note.trim() ? [note.trim(), ""] : [];
  if (kind === "rosters") {
    // Due 2 days before the next Game Day (today when that's sooner).
    const due = c.next ? (left! <= 2 ? c.today : addDays(c.next, -2)) : null;
    const urgent = left !== null && left <= 2;
    const subject = urgent
      ? `URGENT: finish your roster today, games are ${left === 0 ? "today" : SHORT(c.next!)}`
      : c.next
        ? `Action needed: finish your roster by ${SHORT(due!)}`
        : "Action needed: finish your team's roster";
    const lines = [
      `Coach ${r.first},`,
      "",
      ...personal,
      `${r.teams.length === 1 ? `${teamList}'s roster isn't` : `These rosters aren't`} complete yet:`,
      ...r.teams.flatMap((t) => (r.teams.length === 1 ? t.missing.map((m) => `  • ${m}`) : [`  ${t.name}:`, ...t.missing.map((m) => `    • ${m}`)])),
      "",
      "Why it matters:",
      "  • Players who aren't on the roster can't play, and rosters lock after your team's first game.",
      "  • Each birthdate shows the player is eligible for the grade (the Age Control Date is Sept 1). A player who can't be verified can be protested and sat down.",
      "  • Jersey numbers go on the scoresheet, so every basket and foul goes to the right player.",
      "",
      c.next
        ? urgent
          ? `By when: TODAY. The next Game Day is ${LONG(c.next)}${left === 0 ? " (today)" : left === 1 ? " (tomorrow)" : ""}.`
          : `By when: ${LONG(due!)}, two days before the next Game Day (${LONG(c.next)}).`
        : "By when: as soon as you can, before your team's first game.",
      "",
      `How: log in at ${c.link}, open your team, then Roster. It takes about 5 minutes.`,
      "",
      ...sign,
    ];
    return { subject, text: lines.join("\n") };
  }
  const subject = c.next ? `Your game times for ${SHORT(c.next)} are in CourtCaptain` : "Your team's schedule and game info are in CourtCaptain";
  const lines = [
    `Coach ${r.first},`,
    "",
    ...personal,
    `You haven't opened CourtCaptain in the last ${USE_DAYS} days. It's where ${c.orgName} keeps everything for ${teamList}:`,
    "  • Game times and gyms for each Game Day, and any last-minute changes",
    "  • Your roster (players can't play until they're on it)",
    "  • Scores, standings and messages from the League and your organization",
    "",
    c.next
      ? `Why now: the next Game Day is ${LONG(c.next)}${left !== null && left <= 1 ? (left === 0 ? " (today)" : " (tomorrow)") : ""}. Changes are posted in the app first, so check it before you head to the gym.`
      : "Why now: schedules and changes are posted in the app first, so check it before every Game Day.",
    "",
    `How: log in at ${c.link} with your cell number and PIN. Trouble logging in? Reply to this email.`,
    "",
    ...sign,
  ];
  return { subject, text: lines.join("\n") };
}

// Pure: the one text for all of them (short; no one's details).
export function nudgeText(kind: NudgeKind, c: NudgeContext): string {
  const left = c.next ? daysBetween(c.today, c.next) : null;
  if (kind === "rosters") {
    const by = c.next ? (left! <= 2 ? "TODAY" : `by ${SHORT(addDays(c.next, -2))}`) : "this week";
    return `Coach, this is ${c.sender} with ${c.orgName}. Your team's roster isn't complete. Players not on the roster can't play, and rosters lock after your first game${c.next ? ` (next Game Day ${SHORT(c.next)})` : ""}. Please add every player with their birthdate and jersey number ${by}: ${c.link}`;
  }
  return `Coach, this is ${c.sender} with ${c.orgName}. ${c.next ? `The next Game Day is ${SHORT(c.next)}. ` : ""}Your game times, gyms, roster and any changes are in CourtCaptain. Please log in this week: ${c.link}`;
}


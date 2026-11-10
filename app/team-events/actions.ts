"use server";

import { VIEW_ONLY, currentUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { eventRoster, setEventMark, setRsvp } from "@/lib/event-attendance";

const deps = { pool: db, now: () => new Date() };

// A team event's roster with each player's mark and parent answer, and why marking is closed (if it is). Who may see it
// is checked inside lib/event-attendance.
export async function loadEventRoster(org: string, teamId: string, kind: string, eventId: string) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  const r = await eventRoster(deps, user, { org: String(org), teamId: String(teamId) }, kind, eventId);
  return r ? { ok: true as const, ...r } : { ok: false as const, message: "Only the team's staff can see attendance." };
}

// Staff only, from 15 minutes before the start until 24 hours after.
export async function markEventPlayer(org: string, teamId: string, kind: string, eventId: string, player: string, status: string) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  return setEventMark(deps, user, { org: String(org), teamId: String(teamId) }, { kind, eventId, player, status });
}

// The player's parent only, until the event starts.
export async function answerEvent(org: string, teamId: string, kind: string, eventId: string, player: string, rsvp: "yes" | "no" | null) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  return setRsvp(deps, user, { org: String(org), teamId: String(teamId) }, { kind, eventId, player, rsvp });
}

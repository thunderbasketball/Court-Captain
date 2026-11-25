"use server";

import { VIEW_ONLY, currentUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import * as support from "@/lib/support";
import { supportPanel } from "@/lib/support-panel";
import { markSeen } from "@/lib/whats-new-seen";

const deps = () => ({ pool: db, now: () => new Date() });

// Session checked here; CourtCaptain staff are checked again inside lib/support.
async function guarded<T>(fn: (user: NonNullable<Awaited<ReturnType<typeof currentUser>>>) => Promise<T>) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  try {
    return await fn(user);
  } catch (e) {
    console.error("Support failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}

export async function ask(org: string, question: string) {
  return guarded((u) => support.askQuestion(deps(), u, org, question));
}
export async function reply(id: string, body: string) {
  return guarded((u) => support.replyChat(deps(), u, id, body));
}
export async function resolve(id: string, resolved: boolean) {
  return guarded((u) => support.setChatResolved(deps(), u, id, resolved));
}
export async function publish(id: string, title: string, answer: string) {
  return guarded((u) => support.publishChat(deps(), u, id, title, answer));
}
export async function saveArticle(
  id: string | null,
  input: { kind: string; title: string; body: string; topic: string; audiences: string[]; features: string[]; areas: string[] },
) {
  return guarded((u) => support.saveArticle(deps(), u, id, input));
}
export async function restoreArticle(key: string) {
  return guarded((u) => support.restoreArticle(deps(), u, key));
}
// The header's ? (everyone logged in): their own questions, guides and chats, read when it's opened.
export async function loadSupport(org: string | null) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  return { ok: true as const, ...(await supportPanel(user, typeof org === "string" ? org : null)) };
}
// They opened What's New (not while viewing as someone).
export async function sawWhatsNew() {
  const user = await currentUser();
  if (user && !user.actingBy) await markSeen(deps(), user.coachId);
}
export async function deleteArticle(id: string) {
  return guarded((u) => support.deleteArticle(deps(), u, id));
}

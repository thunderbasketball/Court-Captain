"use server";

import { VIEW_ONLY, currentUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import * as support from "@/lib/support";

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
export async function saveArticle(id: string | null, input: { kind: string; title: string; body: string; sort?: string }) {
  return guarded((u) => support.saveArticle(deps(), u, id, input));
}
export async function deleteArticle(id: string) {
  return guarded((u) => support.deleteArticle(deps(), u, id));
}

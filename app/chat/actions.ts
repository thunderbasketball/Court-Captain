"use server";

import { VIEW_ONLY, currentUser } from "@/lib/auth/server";
import { featureRefusal } from "@/lib/features-server";
import * as chat from "@/lib/chat";
import { db } from "@/lib/db";

const deps = { pool: db, now: () => new Date() };

// Session and chat membership are checked again inside lib/chat; the Chat feature is the chat's organization's.
export async function postMessage(key: string, body: string) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  const refused = await featureRefusal(chat.chatOrg(String(key)) ?? "thunder", "chat"); // that organization's Chat
  if (refused) return refused;
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  try {
    return await chat.postMessage(deps, user, String(key), body);
  } catch (e) {
    console.error("Chat message failed:", e);
    return {
      ok: false as const,
      message: "Something went wrong. Please try again.",
    };
  }
}

// A chat for the pop-up (who can see it is checked inside lib/chat). Opening it marks it read,
// except while a Director is viewing as someone.
export async function loadChat(key: string) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  const refused = await featureRefusal(chat.chatOrg(String(key)) ?? "thunder", "chat"); // that organization's Chat
  if (refused) return refused;
  try {
    const thread = await chat.getChat(deps, user, String(key));
    if (!thread) return { ok: false as const, message: "This chat isn't available." };
    if (!user.actingBy) await chat.markChatRead(deps, user, thread.key);
    return { ok: true as const, thread, me: user.coachId };
  } catch (e) {
    console.error("Chat load failed:", e);
    return {
      ok: false as const,
      message: "Something went wrong. Please try again.",
    };
  }
}

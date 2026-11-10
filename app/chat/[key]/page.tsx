import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { requireFeature } from "@/lib/features-server";
import { chatOrg, getChat, markChatRead } from "@/lib/chat";
import { currentContexts } from "@/lib/contexts-server";
import { db } from "@/lib/db";
import AppHeader from "../../AppHeader";
import ChatThread from "./ChatThread";

export default function ChatThreadPage({ params }: PageProps<"/chat/[key]">) {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <Thread params={params} />
    </Suspense>
  );
}

async function Thread({ params }: { params: PageProps<"/chat/[key]">["params"] }) {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  const { key } = await params;
  await requireFeature(chatOrg(decodeURIComponent(key)) ?? "thunder", "chat"); // the chat's organization has Chat
  const deps = { pool: db, now: () => new Date() };
  const chat = await getChat(deps, user, decodeURIComponent(key));
  if (!chat) notFound();
  // Seeing the chat marks it read (before the header counts unread). Not while a Director is viewing as someone.
  if (!user.actingBy) await markChatRead(deps, user, chat.key);
  const { active } = await currentContexts(user);

  return (
    <>
      <AppHeader user={user} context={active?.key} />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 pt-4">
        <Link href="/chat" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
          ← Chats
        </Link>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">{chat.title}</h1>
        <details className="text-xs text-zinc-500">
          <summary className="cursor-pointer">{chat.members.length} people</summary>
          <p className="mt-1">{chat.members.join(", ")}</p>
        </details>
        <ChatThread chatKey={chat.key} me={user.coachId} messages={chat.messages} />
      </main>
    </>
  );
}

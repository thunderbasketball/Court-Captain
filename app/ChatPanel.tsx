"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ChatThread as Thread } from "@/lib/chat";
import ChatThread from "./chat/[key]/ChatThread";
import { loadChat } from "./chat/actions";
import { Alert } from "./client-ui";

// One chat right on a card (Teams page), loaded when it opens (who can see it is checked on the server). Closing it
// updates the unread badges.
export default function ChatPanel({ chatKey }: { chatKey: string }) {
  const router = useRouter();
  const [chat, setChat] = useState<{ thread: Thread; me: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    const r = await loadChat(chatKey);
    if (!r.ok) return setError(r.message);
    setError(null);
    setChat({ thread: r.thread, me: r.me });
  }, [chatKey]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads the chat once it opens
    reload();
    return () => router.refresh();
  }, [reload, router]);

  return (
    <div className="flex h-96 flex-col rounded-xl bg-zinc-50 px-3 pt-2 pb-3 dark:bg-white/5">
      {chat && (
        <details className="text-xs text-zinc-500">
          <summary className="cursor-pointer">
            <span className="font-semibold text-zinc-700 dark:text-zinc-200">{chat.thread.title}</span> ·{" "}
            {chat.thread.members.length} people
          </summary>
          <p className="mt-1">{chat.thread.members.join(", ")}</p>
        </details>
      )}
      {error && <Alert tone="red">{error}</Alert>}
      {!chat && !error && <p className="mt-6 text-center text-sm text-zinc-500">Loading…</p>}
      {chat && <ChatThread chatKey={chat.thread.key} me={chat.me} messages={chat.thread.messages} reload={reload} popup />}
    </div>
  );
}

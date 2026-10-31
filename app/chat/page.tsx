import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { requireFeature } from "@/lib/features-server";
import { listChats, newChatOptions } from "@/lib/chat";
import { currentContexts } from "@/lib/contexts-server";
import { db } from "@/lib/db";
import { TZ } from "@/lib/time";
import AppHeader from "../AppHeader";
import { PageTitle, card } from "../ui";
import NewChatButton from "./NewChatButton";

export default function ChatPage() {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <Chats />
    </Suspense>
  );
}

const when = (d: Date) => {
  const sameDay = d.toLocaleDateString("en-US", { timeZone: TZ }) === new Date().toLocaleDateString("en-US", { timeZone: TZ });
  return sameDay
    ? d.toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString("en-US", { timeZone: TZ, month: "numeric", day: "numeric" });
};

async function Chats() {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  await requireFeature("thunder", "chat");
  if (!user.hasThunderRole) redirect("/");
  const deps = { pool: db, now: () => new Date() };
  const [chats, options, { active }] = await Promise.all([listChats(deps, user), newChatOptions(deps, user), currentContexts(user)]);

  return (
    <>
      <AppHeader user={user} context={active?.key} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <div className="flex items-start justify-between gap-3">
          <PageTitle
            title="Chat"
            subtitle={user.isDirector ? "Every chat in the club" : "Your chats with Directors, coaches and your teams"}
          />
          {options.length > 0 && <NewChatButton options={options} />}
        </div>
        {!chats.length && <p className="text-zinc-500">No messages yet. Tap “+ New chat” to start one.</p>}
        <ul className={`${card} divide-y divide-zinc-100 overflow-hidden dark:divide-white/5 ${chats.length ? "" : "hidden"}`}>
          {chats.map((c) => (
            <li key={c.key}>
              <Link href={`/chat/${c.key}`} className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-white/5">
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className={`truncate ${c.unread ? "font-bold" : "font-semibold"}`}>{c.title}</span>
                    {c.last && <span className="shrink-0 text-xs text-zinc-400">{when(c.last.at)}</span>}
                  </span>
                  {c.last && (
                    <span
                      className={`block truncate text-sm ${c.unread ? "text-zinc-900 dark:text-white" : "text-zinc-500 dark:text-zinc-400"}`}
                    >
                      {c.last.sender}: {c.last.body}
                    </span>
                  )}
                </span>
                {c.unread > 0 && (
                  <span className="flex min-w-6 shrink-0 items-center justify-center rounded-full bg-thunder-blue px-1.5 py-0.5 text-xs font-bold text-white tabular-nums">
                    {c.unread}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}

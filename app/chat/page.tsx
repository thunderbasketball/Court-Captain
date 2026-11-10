import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { hasFeature } from "@/lib/features";
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
  const deps = { pool: db, now: () => new Date() };
  // Every chat they're in, from every organization with Chat; + New chat starts one in the organization in use.
  const { active } = await currentContexts(user);
  const org = active?.org && active.org !== "platform" ? active.org : "thunder";
  const chatHere = await hasFeature(db, org, "chat");
  const [chats, options] = await Promise.all([listChats(deps, user), chatHere ? newChatOptions(deps, user, org) : []]);

  return (
    <>
      <AppHeader user={user} context={active?.key} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <div className="flex items-start justify-between gap-3">
          <PageTitle
            title="Chat"
            subtitle="Your chats with Directors, coaches and teams, in every organization"
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

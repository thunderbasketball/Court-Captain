"use client";

import { useEffect, useState } from "react";
import type { BoxChat, BoxGroup } from "@/lib/chat";
import ChatPanel from "./ChatPanel";
import { loadChatBox } from "./chat/actions";
import { Alert } from "./client-ui";
import { TZ } from "@/lib/time";

const when = (d: Date | string) => {
  const t = new Date(d);
  const today = t.toLocaleDateString("en-US", { timeZone: TZ }) === new Date().toLocaleDateString("en-US", { timeZone: TZ });
  return today
    ? t.toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" })
    : t.toLocaleDateString("en-US", { timeZone: TZ, month: "numeric", day: "numeric" });
};
const unreadOf = (g: { chats: BoxChat[]; teams?: { chats: BoxChat[] }[] }) =>
  [...g.chats, ...(g.teams ?? []).flatMap((t) => t.chats)].reduce((n, c) => n + c.unread, 0);

function Badge({ n }: { n: number }) {
  return n > 0 ? (
    <span className="flex min-w-5 shrink-0 items-center justify-center rounded-full bg-thunder-blue px-1.5 text-xs font-bold text-white tabular-nums">
      {n}
    </span>
  ) : null;
}

const arrow = "text-zinc-400 transition-transform [details[open]>summary_&]:rotate-90";

// The header's chat icon opens this right under the header (no pop-up): every chat the person can open, grouped
// (Groups, Teams with each team's chats together, Coaches, Direct messages, Events, other organizations). Groups with
// unread messages start open. Tapping a chat opens it right here, with ← back to the list.
export default function ChatBox() {
  const [groups, setGroups] = useState<BoxGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<BoxChat | null>(null);
  const [search, setSearch] = useState("");
  useEffect(() => {
    if (open) return;
    let live = true;
    loadChatBox().then((r) => {
      if (!live) return;
      if (r.ok) setGroups(r.groups);
      else setError(r.message);
    });
    return () => {
      live = false;
    };
  }, [open]);

  if (open)
    return (
      <div className="space-y-2 p-1">
        <button type="button" onClick={() => setOpen(null)} className="text-sm font-medium text-thunder-blue dark:text-blue-400">
          ← All chats
        </button>
        <ChatPanel chatKey={open.key} />
      </div>
    );
  if (error) return <Alert tone="red">{error}</Alert>;
  if (!groups) return <p className="py-6 text-center text-sm text-zinc-500">Loading…</p>;
  if (!groups.length) return <p className="py-6 text-center text-sm text-zinc-500">No chats yet.</p>;

  const q = search.trim().toLowerCase();
  const hit = (c: BoxChat, extra = "") => !q || `${extra} ${c.title}`.toLowerCase().includes(q);
  const shown = groups
    .map((g) => ({
      ...g,
      chats: g.chats.filter((c) => hit(c)),
      teams: g.teams?.map((t) => ({ ...t, chats: t.chats.filter((c) => hit(c, t.name)) })).filter((t) => t.chats.length),
    }))
    .filter((g) => g.chats.length || g.teams?.length);

  const row = (c: BoxChat, indent = false) => (
    <li key={c.key}>
      <button
        type="button"
        onClick={() => setOpen(c)}
        className={`flex w-full items-center gap-2 py-2 text-left hover:bg-zinc-50 dark:hover:bg-white/5 ${indent ? "pr-2 pl-6" : "px-2"}`}
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className={`truncate text-sm ${c.unread ? "font-bold" : "font-medium"}`}>{c.title}</span>
            {c.last && <span className="shrink-0 text-xs text-zinc-400">{when(c.last.at)}</span>}
          </span>
          {c.last && (
            <span className={`block truncate text-xs ${c.unread ? "text-zinc-800 dark:text-zinc-100" : "text-zinc-500"}`}>
              {c.last.sender}: {c.last.body}
            </span>
          )}
        </span>
        <Badge n={c.unread} />
      </button>
    </li>
  );

  return (
    <div className="space-y-2 p-1">
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Find a chat, coach or team…"
        aria-label="Find a chat"
        className="w-full rounded-xl bg-white px-3 py-2 text-base ring-1 ring-zinc-950/10 outline-none focus:ring-2 focus:ring-thunder-blue dark:bg-zinc-900 dark:ring-white/15"
      />
      {!shown.length && <p className="py-3 text-center text-sm text-zinc-500">No chats match.</p>}
      {shown.map((g) => {
        const n = unreadOf(g);
        const count = g.chats.length + (g.teams?.length ?? 0);
        return (
          <details key={g.name} open={!!q || n > 0 || shown.length === 1} className="rounded-xl ring-1 ring-zinc-950/10 dark:ring-white/10">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 select-none [&::-webkit-details-marker]:hidden">
              <span className="min-w-0 flex-1 text-sm font-semibold">
                {g.name} <span className="font-normal text-zinc-500">({count})</span>
              </span>
              <Badge n={n} />
              <span aria-hidden className={arrow}>
                ›
              </span>
            </summary>
            <ul className="divide-y divide-zinc-100 border-t border-zinc-100 dark:divide-white/5 dark:border-white/5">
              {g.chats.map((c) => row(c))}
              {g.teams?.map((t) => {
                const tn = t.chats.reduce((k, c) => k + c.unread, 0);
                return (
                  <li key={t.name}>
                    <details open={!!q || tn > 0}>
                      <summary className="flex cursor-pointer list-none items-center gap-2 px-2 py-2 select-none [&::-webkit-details-marker]:hidden">
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{t.name}</span>
                        <Badge n={tn} />
                        <span aria-hidden className={arrow}>
                          ›
                        </span>
                      </summary>
                      <ul className="divide-y divide-zinc-100 dark:divide-white/5">{t.chats.map((c) => row(c, true))}</ul>
                    </details>
                  </li>
                );
              })}
            </ul>
          </details>
        );
      })}
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ChatStatus, SupportArticle, SupportChat } from "@/lib/support";
import { Alert, PopUp } from "../client-ui";
import { inputCls, pillCls, primaryBtn } from "../ui";
import { ask, publish, reply, resolve } from "./actions";

type Tab = "faq" | "howto" | "chats" | ChatStatus;

// Support, the same in every organization. Everyone: Questions (tap for the answer), How to (step by step) and Chats
// (their own chats with support; start a new one). Those who answer (CourtCaptain staff: every chat; an organization's
// Owners and Admins: the chats started there) open on New, Working and Resolved. `inbox` is null for everyone else.
export default function SupportButton({
  org,
  articles,
  mine,
  inbox,
  staff,
  className,
}: {
  org: string;
  articles: SupportArticle[];
  mine: SupportChat[];
  inbox: SupportChat[] | null;
  staff: boolean;
  className: string;
}) {
  const waiting = inbox?.filter((c) => c.status === "new").length ?? 0;
  return (
    <PopUp
      label={waiting ? `Support (${waiting})` : "Support"}
      title="Support"
      className={`${className} ${waiting ? "animate-pulse text-red-600! dark:text-red-400!" : ""}`}
    >
      {() => <SupportPanel org={org} articles={articles} mine={mine} inbox={inbox} staff={staff} />}
    </PopUp>
  );
}

export function SupportPanel({
  org,
  articles,
  mine,
  inbox,
  staff,
}: {
  org: string;
  articles: SupportArticle[];
  mine: SupportChat[];
  inbox: SupportChat[] | null;
  staff: boolean;
}) {
  const [tab, setTab] = useState<Tab>(inbox ? "new" : "faq");
  const [open, setOpen] = useState<string | null>(null);
  const [find, setFind] = useState("");
  const count = (s: ChatStatus) => inbox?.filter((c) => c.status === s).length ?? 0;
  const tabs: [Tab, string][] = [
    ...(inbox
      ? ([
          ["new", `New (${count("new")})`],
          ["working", `Working (${count("working")})`],
          ["resolved", "Resolved"],
        ] as [Tab, string][])
      : []),
    ["faq", "Questions"],
    ["howto", "How to"],
    ...(inbox ? [] : ([["chats", `Chats${mine.length ? ` (${mine.length})` : ""}`]] as [Tab, string][])),
  ];
  const all = [...(inbox ?? []), ...mine.filter((m) => !inbox?.some((c) => c.id === m.id))];
  const chat = open ? all.find((c) => c.id === open) : null;
  if (chat) return <ChatView chat={chat} staff={staff} canAnswer={!!inbox} onBack={() => setOpen(null)} />;

  const words = find.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = articles.filter((a) => a.kind === tab && words.every((w) => `${a.title} ${a.body}`.toLowerCase().includes(w)));
  const chats = tab === "chats" ? mine : (inbox ?? []).filter((c) => c.status === tab);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {tabs.map(([k, label]) => (
          <button
            key={k}
            type="button"
            className={`${pillCls(tab === k)} ${k === "new" && count("new") && tab !== k ? "animate-pulse text-red-600!" : ""}`}
            onClick={() => setTab(k)}
          >
            {label}
          </button>
        ))}
      </div>

      {(tab === "faq" || tab === "howto") && (
        <>
          <input className={inputCls} placeholder="Search…" value={find} onChange={(e) => setFind(e.target.value)} />
          <ul className="max-h-[55vh] divide-y divide-zinc-100 overflow-y-auto rounded-xl ring-1 ring-zinc-950/10 dark:divide-white/5 dark:ring-white/10">
            {shown.map((a) => (
              <li key={a.id}>
                <details className="group px-3 py-2.5">
                  <summary className="flex cursor-pointer list-none items-start justify-between gap-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
                    {a.title}
                    <span className="text-zinc-400 transition-transform [details[open]>summary_&]:rotate-90">›</span>
                  </summary>
                  {a.kind === "howto" ? (
                    <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-zinc-600 dark:text-zinc-300">
                      {a.body
                        .split("\n")
                        .filter((s) => s.trim())
                        .map((s, i) => (
                          <li key={i}>{s}</li>
                        ))}
                    </ol>
                  ) : (
                    <p className="mt-2 text-sm whitespace-pre-line text-zinc-600 dark:text-zinc-300">{a.body}</p>
                  )}
                </details>
              </li>
            ))}
            {!shown.length && (
              <li className="px-3 py-3 text-sm text-zinc-500">
                Nothing matches.{" "}
                {!inbox && (
                  <button type="button" className="font-medium text-thunder-blue hover:underline" onClick={() => setTab("chats")}>
                    Chat with us
                  </button>
                )}
              </li>
            )}
          </ul>
        </>
      )}

      {tab === "chats" && <NewChat org={org} onStarted={(id) => setOpen(id)} />}

      {tab !== "faq" && tab !== "howto" && (
        <ul className="max-h-[50vh] divide-y divide-zinc-100 overflow-y-auto rounded-xl ring-1 ring-zinc-950/10 dark:divide-white/5 dark:ring-white/10">
          {chats.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="w-full px-3 py-2.5 text-left hover:bg-zinc-50 dark:hover:bg-white/5"
                onClick={() => setOpen(c.id)}
              >
                <span className="flex items-start justify-between gap-2">
                  <span className="min-w-0 truncate text-sm font-medium">{c.messages[0]?.body ?? ""}</span>
                  <StatusChip status={c.status} />
                </span>
                <span className="block text-xs text-zinc-500">
                  {inbox ? `${c.who}${c.orgName ? ` · ${c.orgName}` : ""} · ` : ""}
                  {new Date(c.startedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · {c.messages.length}{" "}
                  message
                  {c.messages.length === 1 ? "" : "s"}
                </span>
              </button>
            </li>
          ))}
          {!chats.length && <li className="px-3 py-3 text-sm text-zinc-500">No chats here.</li>}
        </ul>
      )}
    </div>
  );
}

function StatusChip({ status }: { status: ChatStatus }) {
  const [label, tone] =
    status === "new"
      ? ["New", "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300"]
      : status === "working"
        ? ["Working", "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"]
        : ["Resolved", "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300"];
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone}`}>{label}</span>;
}

function NewChat({ org, onStarted }: { org: string; onStarted: (id: string) => void }) {
  const router = useRouter();
  const [question, setQuestion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const r = await ask(org, question);
          if (!r.ok) return setError(r.message);
          setQuestion("");
          router.refresh();
          onStarted(r.id);
        });
      }}
    >
      <textarea
        className={`${inputCls} min-h-20`}
        maxLength={1000}
        placeholder="Start a chat: what do you need help with?"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
      />
      {error && <Alert tone="red">{error}</Alert>}
      <button type="submit" disabled={busy || !question.trim()} className={`${primaryBtn} w-full`}>
        {busy ? "Sending…" : "Start chat"}
      </button>
    </form>
  );
}

// One chat: who you're chatting with, the messages (names, and who answers for CourtCaptain or the organization), a reply
// box, and Resolved (or Open again). CourtCaptain staff can also add it to everyone's Questions.
function ChatView({
  chat,
  staff,
  canAnswer,
  onBack,
}: {
  chat: SupportChat;
  staff: boolean;
  canAnswer: boolean;
  onBack: () => void;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const iStarted = chat.messages[0]?.mine;
  const lastAnswer = [...chat.messages].reverse().find((m) => m.helper)?.body ?? "";
  const run = (fn: () => Promise<{ ok: boolean; message?: string }>, after?: () => void) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) return setError(r.message ?? "Something went wrong.");
      after?.();
      router.refresh();
    });

  return (
    <div className="space-y-3">
      <button type="button" className="text-sm text-zinc-500 hover:underline" onClick={onBack}>
        ← All chats
      </button>
      <div className="flex items-start justify-between gap-2 rounded-xl bg-zinc-50 p-3 text-sm dark:bg-zinc-800/50">
        <span>
          {iStarted || !canAnswer ? (
            chat.chattingWith ? (
              <>
                You&apos;re chatting with <span className="font-semibold">{chat.chattingWith}</span>
              </>
            ) : (
              "Waiting for CourtCaptain Support or your organization's Admins to answer."
            )
          ) : (
            <>
              You&apos;re chatting with <span className="font-semibold">{chat.who}</span>
              {chat.orgName && <span className="text-zinc-500"> · {chat.orgName}</span>}
            </>
          )}
        </span>
        <StatusChip status={chat.status} />
      </div>
      <ul className="max-h-[40vh] space-y-2 overflow-y-auto">
        {chat.messages.map((m) => (
          <li key={m.id} className={`flex ${m.mine ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                m.mine ? "bg-thunder-blue text-white" : "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100"
              }`}
            >
              <p className={`text-[11px] font-semibold ${m.mine ? "text-white/80" : "text-zinc-500"}`}>
                {m.mine ? "You" : m.who}
                {m.helper && ` · ${m.helper}`}
              </p>
              <p className="whitespace-pre-line">{m.body}</p>
            </div>
          </li>
        ))}
      </ul>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(
            () => reply(chat.id, body),
            () => setBody(""),
          );
        }}
      >
        <textarea
          className={`${inputCls} min-h-16`}
          maxLength={2000}
          placeholder="Write a message…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={busy || !body.trim()} className={primaryBtn}>
            Send
          </button>
          {chat.status !== "resolved" ? (
            <button
              type="button"
              disabled={busy}
              className="rounded-full px-4 py-2 text-sm font-semibold text-emerald-700 ring-1 ring-emerald-600/40 dark:text-emerald-300"
              onClick={() =>
                run(
                  () => resolve(chat.id, true),
                  () => setDone("Marked Resolved."),
                )
              }
            >
              ✓ Resolved
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              className="rounded-full px-4 py-2 text-sm font-semibold text-zinc-600 ring-1 ring-zinc-950/15 dark:text-zinc-300"
              onClick={() => run(() => resolve(chat.id, false))}
            >
              Open again
            </button>
          )}
          {staff && lastAnswer && (
            <button
              type="button"
              disabled={busy}
              className="text-sm font-medium text-thunder-blue hover:underline"
              onClick={() =>
                run(
                  () => publish(chat.id, (chat.messages[0]?.body ?? "").slice(0, 120), lastAnswer),
                  () => setDone("Added to Questions."),
                )
              }
            >
              Add to everyone&apos;s Questions
            </button>
          )}
        </div>
      </form>
      {error && <Alert tone="red">{error}</Alert>}
      {done && <Alert tone="green">{done}</Alert>}
    </div>
  );
}

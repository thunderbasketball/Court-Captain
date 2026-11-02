"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { SupportArticle } from "@/lib/support";
import { Alert, PopUp, Toast, useConfirm } from "../client-ui";
import { card, fieldLabel, inputCls, pillCls, primaryBtn } from "../ui";
import { deleteArticle, saveArticle } from "../support/actions";

// CourtCaptain staff: the Questions and How-to guides every organization sees (add, change, remove). Chats are answered
// in the Support pop-up.
export default function SupportAdmin({ articles }: { articles: SupportArticle[] }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-500">
        Chats (New, Working, Resolved) are under Support in the tab menu: CourtCaptain staff see every chat.
      </p>
      <section className={`${card} p-4`}>
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="font-semibold">Questions and How-to guides ({articles.length})</h2>
          <ArticleButton />
        </div>
        <ul className="divide-y divide-zinc-100 dark:divide-white/5">
          {articles.map((a) => (
            <li key={a.id} className="flex items-start justify-between gap-3 py-2.5 text-sm">
              <span className="min-w-0">
                <span className="mr-2 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                  {a.kind === "faq" ? "Question" : "How to"}
                </span>
                <span className="font-medium">{a.title}</span>
              </span>
              <span className="flex shrink-0 gap-3">
                <ArticleButton article={a} />
                <DeleteArticle id={a.id} title={a.title} />
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function ArticleButton({ article }: { article?: SupportArticle }) {
  const router = useRouter();
  return (
    <PopUp
      label={article ? "Edit" : "+ Add"}
      title={article ? "Edit" : "Add a Question or How-to"}
      link={!!article}
      className={article ? undefined : "shrink-0 rounded-full bg-thunder-blue px-4 py-2 text-sm font-semibold text-white"}
    >
      {(close) => <ArticleForm article={article} onDone={() => (close(), router.refresh())} />}
    </PopUp>
  );
}

function ArticleForm({ article, onDone }: { article?: SupportArticle; onDone: () => void }) {
  const [kind, setKind] = useState<"faq" | "howto">(article?.kind ?? "faq");
  const [title, setTitle] = useState(article?.title ?? "");
  const [body, setBody] = useState(article?.body ?? "");
  const [sort, setSort] = useState(String(article?.sort ?? 100));
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveArticle(article?.id ?? null, { kind, title, body, sort });
          if (!r.ok) return setError(r.message);
          onDone();
        });
      }}
    >
      <div className="flex gap-2">
        <button type="button" className={pillCls(kind === "faq")} onClick={() => setKind("faq")}>
          Question
        </button>
        <button type="button" className={pillCls(kind === "howto")} onClick={() => setKind("howto")}>
          How to
        </button>
      </div>
      <label className="block">
        <span className={fieldLabel}>{kind === "faq" ? "Question" : "Guide title"}</span>
        <input className={inputCls} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="block">
        <span className={fieldLabel}>{kind === "faq" ? "Answer" : "Steps (one per line)"}</span>
        <textarea className={`${inputCls} min-h-32`} value={body} onChange={(e) => setBody(e.target.value)} />
      </label>
      <label className="block">
        <span className={fieldLabel}>Order (smaller shows first)</span>
        <input className={`${inputCls} w-24`} inputMode="numeric" value={sort} onChange={(e) => setSort(e.target.value)} />
      </label>
      {error && <Alert tone="red">{error}</Alert>}
      <button type="submit" disabled={busy} className={`${primaryBtn} w-full`}>
        {busy ? "Saving…" : "Save"}
      </button>
    </form>
  );
}

function DeleteArticle({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const [confirm, dialog] = useConfirm();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, start] = useTransition();
  return (
    <>
      <button
        type="button"
        disabled={busy}
        className="text-xs font-medium text-red-600 hover:underline"
        onClick={async () => {
          if (
            !(await confirm({
              title: `Remove "${title}"?`,
              message: "Are you sure? Nobody will see it in Support.",
              confirmLabel: "Remove",
            }))
          )
            return;
          start(async () => {
            const r = await deleteArticle(id);
            setMsg(r.ok ? "Removed." : r.message);
            if (r.ok) router.refresh();
          });
        }}
      >
        Remove
      </button>
      {msg && <Toast key={msg} message={msg} />}
      {dialog}
    </>
  );
}

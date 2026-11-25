"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { SupportArticle } from "@/lib/support";
import { Alert, PopUp, Toast, useConfirm } from "../client-ui";
import { card, fieldLabel, inputCls, pillCls, primaryBtn } from "../ui";
import { AUDIENCES, AUDIENCE_LABEL, NEEDS, TOPICS, type Audience, type Need } from "@/lib/support-library";
import { deleteArticle, restoreArticle, saveArticle } from "../support/actions";

const AREA_OPTIONS: [string, string][] = [
  ["teams", "Teams"],
  ["players", "Players"],
  ["uniforms", "Uniforms"],
  ["facilities", "Facilities"],
  ["practices", "Practices"],
  ["events", "Events"],
  ["programs", "Programs"],
  ["scheduling", "Scheduling"],
  ["officials", "Officials Assigner"],
  ["support", "Support"],
  ["scores", "Scores"],
];

// CourtCaptain staff: every Question and How-to guide (the library's and any staff added), by who it's for; add, change,
// remove, or put the library's own back. How many each kind of person has for each feature is at the top. Chats are
// answered in Support (the ? at the top).
export default function SupportAdmin({ articles }: { articles: SupportArticle[] }) {
  const [who, setWho] = useState<string>("");
  const [need, setNeed] = useState<string>("");
  const [find, setFind] = useState("");
  const words = find.toLowerCase().split(/\s+/).filter(Boolean);
  const live = articles.filter((a) => !a.hidden);
  const shown = articles.filter(
    (a) =>
      (!who || a.audiences.includes(who)) &&
      (!need || a.features.includes(need)) &&
      words.every((w) => `${a.title} ${a.body} ${a.topic}`.toLowerCase().includes(w)),
  );
  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-500">
        Each person sees only what&apos;s for them, by their role and their organization&apos;s features. Chats are under the ? at the top.
      </p>
      <section className={`${card} p-4`}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-semibold">Questions and How-to guides ({live.length})</h2>
          <ArticleButton />
        </div>
        <div className="mb-3 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {AUDIENCES.map((a) => (
              <button key={a} type="button" className={`${pillCls(who === a)} px-3! py-1! text-xs!`} onClick={() => setWho(who === a ? "" : a)}>
                {AUDIENCE_LABEL[a]} ({live.filter((x) => x.audiences.includes(a)).length})
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(NEEDS).map(([k, label]) => (
              <button key={k} type="button" className={`${pillCls(need === k)} px-3! py-1! text-xs!`} onClick={() => setNeed(need === k ? "" : k)}>
                {label} ({live.filter((x) => x.features.includes(k)).length})
              </button>
            ))}
          </div>
          <input className={inputCls} placeholder="Search…" value={find} onChange={(e) => setFind(e.target.value)} />
        </div>
        <ul className="grid gap-x-6 lg:grid-cols-2">
          {shown.map((a) => (
            <li key={a.id} className={`flex items-start justify-between gap-3 border-b border-zinc-100 py-2.5 text-sm dark:border-white/5 ${a.hidden ? "opacity-50" : ""}`}>
              <span className="min-w-0">
                <span className="mr-2 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                  {a.kind === "faq" ? "Question" : "How to"}
                </span>
                <span className="font-medium">{a.title}</span>
                <span className="block text-xs text-zinc-500">
                  {a.topic} · {a.audiences.map((x) => AUDIENCE_LABEL[x as Audience] ?? x).join(", ")}
                  {a.features.length > 0 && ` · needs ${a.features.map((x) => NEEDS[x as Need] ?? x).join(" + ")}`}
                  {a.hidden ? " · Removed" : a.changed ? " · Changed by staff" : !a.key ? " · Added by staff" : ""}
                </span>
              </span>
              <span className="flex shrink-0 gap-3">
                {a.key && (a.changed || a.hidden) && <RestoreArticle id={a.key} label={a.hidden ? "Put back" : "Reset"} />}
                {!a.hidden && <ArticleButton article={a} />}
                {!a.hidden && <DeleteArticle id={a.id} title={a.title} />}
              </span>
            </li>
          ))}
        </ul>
        {!shown.length && <p className="text-sm text-zinc-500">Nothing matches.</p>}
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
  const [topic, setTopic] = useState(article?.topic ?? "");
  const [audiences, setAudiences] = useState<string[]>(article?.audiences ?? []);
  const [features, setFeatures] = useState<string[]>(article?.features ?? []);
  const [areas, setAreas] = useState<string[]>(article?.areas ?? []);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const pills = (options: [string, string][], on: string[], set: (v: string[]) => void) => (
    <span className="flex flex-wrap gap-1.5">
      {options.map(([k, label]) => (
        <button key={k} type="button" className={`${pillCls(on.includes(k))} px-3! py-1! text-xs!`} onClick={() => set(on.includes(k) ? on.filter((x) => x !== k) : [...on, k])}>
          {label}
        </button>
      ))}
    </span>
  );
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveArticle(article?.id ?? null, { kind, title, body, topic, audiences, features, areas });
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
        <textarea className={`${inputCls} min-h-32`} maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} />
      </label>
      <label className="block">
        <span className={fieldLabel}>Topic</span>
        <select className={inputCls} value={topic} onChange={(e) => setTopic(e.target.value)}>
          <option value="">Pick a topic…</option>
          {TOPICS.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
      </label>
      <div>
        <span className={fieldLabel}>Who sees it</span>
        {pills(AUDIENCES.map((a) => [a, AUDIENCE_LABEL[a]]), audiences, setAudiences)}
      </div>
      <div>
        <span className={fieldLabel}>Only with these features (all of them; none: any organization)</span>
        {pills(Object.entries(NEEDS), features, setFeatures)}
      </div>
      {audiences.includes("director") && (
        <div>
          <span className={fieldLabel}>Only Directors of (none: every Director)</span>
          {pills(AREA_OPTIONS, areas, setAreas)}
        </div>
      )}
      {error && <Alert tone="red">{error}</Alert>}
      <button type="submit" disabled={busy} className={`${primaryBtn} w-full`}>
        {busy ? "Saving…" : "Save"}
      </button>
    </form>
  );
}

function RestoreArticle({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  return (
    <button
      type="button"
      disabled={busy}
      className="text-xs font-medium text-thunder-blue hover:underline dark:text-blue-400"
      onClick={() =>
        start(async () => {
          await restoreArticle(id);
          router.refresh();
        })
      }
    >
      {label}
    </button>
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

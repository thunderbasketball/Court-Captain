"use client";

import { Fragment, useMemo, useState, type ReactNode } from "react";
import type { RulesSection } from "@/lib/rules-doc";

// The words typed, each found anywhere (any order), ignoring case.
const wordsOf = (q: string) => q.toLowerCase().split(/\s+/).filter((w) => w.length > 1).slice(0, 8);
const textOf = (s: RulesSection) => [s.title, ...s.blocks.map((b) => b.text)].join(" ").toLowerCase();

// Each typed word highlighted.
function Marked({ text, words }: { text: string; words: string[] }): ReactNode {
  if (!words.length) return text;
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return text.split(re).map((part, i) =>
    i % 2 ? (
      <mark key={i} className="rounded bg-yellow-200 px-0.5 text-inherit dark:bg-yellow-500/40">
        {part}
      </mark>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

// The rules with a search box: typing shows only the sections with every word (opened, words highlighted) and how many;
// with nothing typed, every section is a card that opens in place (one at a time), and the contents' chips jump to one.
// Print prints all.
export default function RulesSearch({ sections }: { sections: RulesSection[] }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Set<string>>(() => new Set(sections.filter((s) => !s.title).map((s) => s.id)));
  const words = useMemo(() => wordsOf(q), [q]);
  const hits = useMemo(() => (words.length ? sections.filter((s) => s.blocks.length && words.every((w) => textOf(s).includes(w))) : sections), [sections, words]);
  const searching = words.length > 0;
  // One card open at a time: opening one closes the others (the untitled opening text stays).
  const keep = (o: Set<string>) => new Set([...o].filter((id) => sections.find((s) => s.id === id && !s.title)));
  const toggle = (id: string) => setOpen((o) => (o.has(id) ? (o.delete(id), new Set(o)) : keep(o).add(id)));
  // The contents' chips: the sections themselves (not the groups' labels).
  const headings = sections.filter((s) => s.title && s.blocks.length && s.level <= 2);
  return (
    <div className="mt-4">
      <div className="sticky top-0 z-10 -mx-4 bg-zinc-50/95 px-4 py-2 backdrop-blur print:hidden dark:bg-zinc-950/95">
        <div className="flex items-center gap-2">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search the rules (e.g. overtime, press, fouls)"
            aria-label="Search the rules"
            className="min-w-0 flex-1 rounded-xl bg-white px-4 py-2.5 text-base ring-1 ring-zinc-950/10 outline-none focus:ring-2 focus:ring-thunder-blue dark:bg-zinc-900 dark:ring-white/10"
          />
          <button
            type="button"
            onClick={() => {
              setQ("");
              setOpen(new Set(sections.map((s) => s.id)));
              setTimeout(() => window.print(), 50);
            }}
            className="shrink-0 rounded-xl px-3 py-2.5 text-sm font-semibold text-thunder-blue ring-1 ring-thunder-blue/30 hover:bg-blue-50 dark:text-blue-400"
          >
            🖨 Print
          </button>
        </div>
        {searching && (
          <p className="mt-1.5 text-sm text-zinc-500" aria-live="polite">
            {hits.length ? `${hits.length} section${hits.length === 1 ? "" : "s"} with “${q.trim()}”` : `Nothing found for “${q.trim()}”.`}
          </p>
        )}
      </div>

      {!searching && headings.length > 2 && (
        <nav aria-label="Contents" className="mt-3 flex flex-wrap gap-1.5 print:hidden">
          {headings.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              onClick={() => setOpen((o) => keep(o).add(s.id))}
              className="rounded-full bg-white px-3 py-1 text-xs font-medium text-zinc-700 ring-1 ring-zinc-950/10 hover:bg-zinc-100 dark:bg-zinc-900 dark:text-zinc-200 dark:ring-white/10"
            >
              {s.title}
            </a>
          ))}
        </nav>
      )}

      <div className="mt-3 space-y-2">
        {hits.map((s) => {
          // A group's heading (Game Format, Conduct): a label over its sections, not a card (hidden while searching).
          if (s.title && !s.blocks.length)
            return searching ? null : (
              <h2 key={s.id} id={s.id} className="scroll-mt-20 px-1 pt-4 text-xs font-bold tracking-wide text-zinc-500 uppercase">
                {s.title}
              </h2>
            );
          const shown = searching || open.has(s.id) || !s.title;
          return (
            <section
              key={s.id}
              id={s.id}
              className={`scroll-mt-20 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-zinc-950/5 dark:bg-zinc-900 dark:ring-white/10 ${s.level === 3 ? "ml-4" : ""}`}
            >
              {s.title && (
                <button type="button" onClick={() => toggle(s.id)} aria-expanded={shown} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
                  <h2 className={s.level === 1 ? "text-lg font-semibold" : "font-semibold"}>
                    <Marked text={s.title} words={words} />
                  </h2>
                  <span aria-hidden className={`text-zinc-400 transition print:hidden ${shown ? "rotate-90" : ""}`}>
                    ›
                  </span>
                </button>
              )}
              <div className={`${shown ? "" : "hidden print:block"} space-y-2 px-4 pb-4 text-[15px] leading-relaxed ${s.title ? "" : "pt-4"}`}>
                {s.blocks.map((b, i) =>
                  b.kind === "li" ? (
                    <p key={i} className="flex gap-2" style={{ paddingLeft: `${b.depth * 1.25}rem` }}>
                      <span aria-hidden className="text-zinc-400">
                        •
                      </span>
                      <span>
                        <Marked text={b.text} words={words} />
                      </span>
                    </p>
                  ) : (
                    <p key={i} className={b.kind === "row" ? "rounded-lg bg-zinc-50 px-3 py-1.5 text-sm dark:bg-white/5" : ""}>
                      <Marked text={b.text} words={words} />
                    </p>
                  ),
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

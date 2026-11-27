"use client";

import { useState, type ReactNode } from "react";

export type DivisionCard = {
  key: string;
  title: string;
  status: string; // "17 teams · 9 matchups"
  tone: "green" | "warn" | "plain"; // every game scheduled / something to look at / neither
  notes: string[]; // warnings and extra games, shown on the card
  body: ReactNode;
};

// A Game Day's divisions in the Matchups list, youngest first: one open at a time, moved to the bottom so the others stay on top.
export default function DivisionCards({ cards }: { cards: DivisionCard[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const list = open ? [...cards.filter((c) => c.key !== open), ...cards.filter((c) => c.key === open)] : cards;
  return (
    <div className="space-y-2">
      {list.map((c) => (
        <details
          key={c.key}
          open={c.key === open}
          onToggle={(e) => {
            const isOpen = (e.currentTarget as HTMLDetailsElement).open;
            setOpen((cur) => (isOpen ? c.key : cur === c.key ? null : cur));
          }}
          className={`group overflow-hidden rounded-lg ring-1 ${
            c.tone === "green"
              ? "ring-emerald-300 dark:ring-emerald-400/40"
              : c.tone === "warn"
                ? "ring-red-300 dark:ring-red-400/40"
                : "ring-zinc-200 dark:ring-white/10"
          }`}
        >
          <summary
            className={`block cursor-pointer list-none px-3 py-2 [&::-webkit-details-marker]:hidden ${
              c.tone === "green" ? "bg-emerald-50 dark:bg-emerald-500/10" : c.tone === "warn" ? "bg-red-50 dark:bg-red-500/10" : "bg-zinc-50 dark:bg-white/5"
            }`}
          >
            <span className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold">
                <span className="mr-1 inline-block text-zinc-400 transition [details[open]>summary_&]:rotate-90">›</span>
                {c.title}
              </span>
              <span className={`shrink-0 text-xs ${c.tone === "green" ? "text-emerald-700 dark:text-emerald-300" : "text-zinc-500"}`}>
                {c.tone === "green" && "✓ "}
                {c.status}
              </span>
            </span>
            {c.notes.map((n) => (
              <span key={n} className={`mt-0.5 block text-xs ${n.startsWith("⚠") ? "font-semibold text-red-700 dark:text-red-300" : "text-violet-700 dark:text-violet-300"}`}>
                {n}
              </span>
            ))}
          </summary>
          <div className="px-3 py-3">{c.body}</div>
        </details>
      ))}
    </div>
  );
}

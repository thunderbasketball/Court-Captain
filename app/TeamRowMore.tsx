"use client";

import { useState, type ReactNode } from "react";

// A button on a team card that opens its panel right on the card instead of a pop-up (roster, schedule, chat, notify).
export type CardToggle = {
  key: string;
  label: string; // for screen readers and the hover title
  icon: ReactNode;
  className: string; // the button's look (round, colored ring)
  panel: ReactNode; // shown under the team line while open (mounted only then: a chat loads when it opens)
  opensCard?: boolean; // opening it opens the card too (👥 roster: its staff show above the players)
};

// A team's card on a Teams page: one line (`head`: badge and name, tapping it opens the card like the chevron; then its buttons and the chevron at the far right;
// on a narrow phone the buttons wrap under the name). `lead` comes first (Text coaches), then each toggle (👥 roster,
// 📅 schedule, chat, notify), then `actions`; each toggle opens its panel on the card and tapping it again closes it.
// The chevron opens the rest (`more`).
export default function TeamRowMore({
  head,
  lead,
  toggles = [],
  actions,
  more,
}: {
  head: ReactNode;
  lead?: ReactNode;
  toggles?: CardToggle[];
  actions?: ReactNode;
  more: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState<string[]>([]);
  const flip = (t: CardToggle) => {
    const opening = !shown.includes(t.key);
    setShown((s) => (s.includes(t.key) ? s.filter((x) => x !== t.key) : [...s, t.key]));
    if (opening && t.opensCard) setOpen(true);
  };
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 basis-40 items-center gap-3 rounded-lg text-left hover:opacity-80"
        >
          {head}
        </button>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {lead}
          {toggles.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => flip(t)}
              aria-expanded={shown.includes(t.key)}
              aria-label={t.label}
              title={t.label}
              className={`${t.className} ${shown.includes(t.key) ? "bg-zinc-100 dark:bg-white/10" : ""}`}
            >
              {t.icon}
            </button>
          ))}
          {actions}
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-label={open ? "Less" : "More"}
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 dark:hover:bg-white/10"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden className={`size-5 transition-transform ${open ? "rotate-180" : ""}`}>
              <path d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" />
            </svg>
          </button>
        </div>
      </div>
      {open && <div className="mt-2 flex flex-col gap-1.5 pl-12">{more}</div>}
      {toggles
        .filter((t) => shown.includes(t.key))
        .map((t) => (
          <div key={t.key} className="mt-2 pl-12">
            {t.panel}
          </div>
        ))}
    </>
  );
}

"use client";

import { useState, type MouseEvent, type ReactNode } from "react";

// A person's card collapsed by default: the initials (`lead`), the name line with its chips and a chevron at the far
// right, `always` under it (e.g. their team pills), and the rest (`children`: cell, email, buttons) when opened.
// Tapping anywhere on the card's row opens or closes it, except its own buttons and links (View as, gear, team pills).
export default function MoreToggle({
  lead,
  name,
  chips,
  always,
  children,
}: {
  lead?: ReactNode;
  name: ReactNode;
  chips?: ReactNode;
  always?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const toggle = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest("a, button, input, select, textarea, label, dialog")) return;
    if (window.getSelection()?.toString()) return; // selecting text (copying a cell or email) doesn't close it
    setOpen((o) => !o);
  };
  return (
    <div onClick={toggle} className="flex cursor-pointer items-start gap-3 px-4 py-2 hover:bg-zinc-50/60 dark:hover:bg-white/[0.02]">
      {lead}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">{name}</div>
          <div className="flex flex-wrap items-center justify-end gap-1">
            {chips}
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              aria-label={open ? "Less" : "More"}
              className="flex size-7 shrink-0 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 dark:hover:bg-white/10"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden className={`size-5 transition-transform ${open ? "rotate-180" : ""}`}>
                <path d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" />
              </svg>
            </button>
          </div>
        </div>
        {(always || open) && (
          <div className="mt-0.5 space-y-0.5 text-sm text-zinc-500 dark:text-zinc-400">
            {always}
            {open && children}
          </div>
        )}
      </div>
    </div>
  );
}

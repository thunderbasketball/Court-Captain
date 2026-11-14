"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

const noop = () => () => {};

export type PageMenu = {
  key: string;
  icon: ReactNode;
  label: string; // for screen readers and the tooltip
  className: string; // the round button's look
  items: { key: string; label: string; panel: ReactNode }[];
};

// A page's title with round menu buttons on its right (e.g. 📣 Text / Chat / Alert coaches, + Add / Import teams), sized
// for a phone. Tapping a button opens its choices right under the title (no pop-up); tapping a choice opens it there
// too (tap again, or the button, to close).
// `slot`: shown inside a Home card, the buttons sit on that card's title line instead (the element with this id, which
// the card provides), so they show while it's closed; tapping one opens the card too.
export default function PageMenus({
  title,
  menus,
  extra,
  slot,
}: {
  title: ReactNode;
  menus: PageMenu[];
  extra?: ReactNode;
  slot?: string;
}) {
  const [menu, setMenu] = useState<string | null>(null);
  // The card's title-line spot (found after the page shows; none on the server).
  const target = useSyncExternalStore(
    noop,
    () => (slot ? document.getElementById(slot) : null),
    () => null,
  );
  const [item, setItem] = useState<string | null>(null);
  const open = menus.find((m) => m.key === menu);
  const buttons = (
        <div className="flex shrink-0 items-center gap-2">
          {extra}
          {menus.map((m) => (
            <button
              key={m.key}
              type="button"
              aria-label={m.label}
              title={m.label}
              aria-expanded={menu === m.key}
              onClick={(e) => {
                // On a Home card's title line: open the card too.
                const d = target && (e.currentTarget.closest(".relative")?.querySelector("details") as HTMLDetailsElement | null);
                if (d) d.open = true;
                setMenu(menu === m.key ? null : m.key);
                setItem(null);
              }}
              className={`${m.className} ${menu === m.key ? "ring-2" : ""}`}
            >
              {/* A round + turns into − while its choices are open (tap to close). */}
              {menu === m.key && m.className === PLUS_BTN ? <span className="text-2xl leading-none font-light">−</span> : m.icon}
            </button>
          ))}
        </div>
  );
  const panel = open?.items.find((i) => i.key === item);
  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        {title}
        {slot ? (target ? createPortal(buttons, target) : null) : buttons}
      </div>
      {open && (
        <div className="-mt-2 mb-4 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-zinc-950/5 dark:bg-zinc-900 dark:ring-white/10">
          <div className="flex flex-wrap gap-2">
            {open.items.map((i) => (
              <button
                key={i.key}
                type="button"
                aria-expanded={item === i.key}
                onClick={() => setItem(item === i.key ? null : i.key)}
                className={`rounded-full px-3 py-1.5 text-sm font-medium ring-1 ${
                  item === i.key
                    ? "bg-thunder-blue text-white ring-thunder-blue"
                    : "text-zinc-700 ring-zinc-950/15 hover:bg-zinc-100 dark:text-zinc-200 dark:ring-white/20 dark:hover:bg-white/10"
                }`}
              >
                {i.label}
              </button>
            ))}
          </div>
          {panel && <div className="mt-3">{panel.panel}</div>}
        </div>
      )}
    </div>
  );
}

// The round buttons' looks, the same on every page: 📣 reaching people (Text, Chat, Alert), + adding (Add, Import).
export const MEGAPHONE_BTN =
  "inline-flex size-10 items-center justify-center rounded-full text-thunder-blue ring-1 ring-thunder-blue/30 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-500/10";
export const PLUS_BTN =
  "inline-flex size-10 items-center justify-center rounded-full bg-thunder-blue text-white shadow-sm ring-thunder-blue/40 hover:bg-thunder-blue-dark";
export const PlusIcon = () => <span className="text-2xl leading-none font-light">+</span>;

// A megaphone: reaching people (Text, Chat, Alert), unlike the bell used for alerts themselves.
export function MegaphoneIcon({ className = "size-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden className={className}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M10.34 15.84c-.688-.06-1.386-.09-2.09-.09H7.5a4.5 4.5 0 1 1 0-9h.75c.704 0 1.402-.03 2.09-.09m0 9.18c.253.962.584 1.892.985 2.783.247.55.06 1.21-.463 1.511l-.657.38c-.551.318-1.26.117-1.527-.461a20.845 20.845 0 0 1-1.44-4.282m3.102.069a18.03 18.03 0 0 1-.59-4.59c0-1.586.205-3.124.59-4.59m0 9.18a23.848 23.848 0 0 1 8.835 2.535M10.34 6.66a23.847 23.847 0 0 0 8.835-2.535m0 0A23.74 23.74 0 0 0 18.795 3m.38 1.125a23.91 23.91 0 0 1 1.014 5.395m-1.014 8.855c-.118.38-.245.754-.38 1.125m.38-1.125a23.91 23.91 0 0 0 1.014-5.395m0-3.46c.495.413.811 1.035.811 1.73 0 .695-.316 1.317-.811 1.73m0-3.46a24.347 24.347 0 0 1 0 3.46"
      />
    </svg>
  );
}

"use client";

import { useEffect, useState, type ReactNode } from "react";
import { MAX_GROUP_TEXT, openGroupText } from "./Contacts";

// Round icon buttons for a collapsible card's title line (Players, Staff, Practices on a team page), shown while the card
// is closed. Text opens the phone's group text, Email the mail app (Bcc), and a panel icon (Chat, Book practices) opens
// the card and its panel right inside it (no pop-up); tap again to close.
export const iconBtn =
  "flex size-8 shrink-0 items-center justify-center rounded-full text-thunder-blue ring-1 ring-thunder-blue/30 hover:bg-blue-50 disabled:opacity-40 dark:text-blue-400 dark:hover:bg-blue-500/10";
const EVENT = "card-panel";

export function TextIcon({ cells, label }: { cells: (string | null)[]; label: string }) {
  const numbers = [...new Set(cells.filter((c): c is string => !!c && /^\d{10}$/.test(c)))].map((c) => `+1${c}`);
  const parts: string[][] = [];
  for (let i = 0; i < numbers.length; i += MAX_GROUP_TEXT) parts.push(numbers.slice(i, i + MAX_GROUP_TEXT));
  if (!parts.length) return null;
  return (
    <>
      {parts.map((part, i) => (
        <button
          key={i}
          type="button"
          aria-label={`${label} (${part.length})${parts.length > 1 ? `, group ${i + 1}` : ""}`}
          title={`${label} (${part.length})`}
          onClick={() => openGroupText(part)}
          className={iconBtn}
        >
          <span aria-hidden className="text-sm">
            💬{parts.length > 1 ? <sup>{i + 1}</sup> : null}
          </span>
        </button>
      ))}
    </>
  );
}

export function EmailIcon({ emails, label }: { emails: string[]; label: string }) {
  const list = [...new Set(emails.filter(Boolean).map((e) => e.toLowerCase()))];
  if (!list.length) return null;
  return (
    <a
      href={`mailto:?bcc=${list.map(encodeURIComponent).join(",")}`}
      aria-label={`${label} (${list.length})`}
      title={`${label} (${list.length})`}
      className={iconBtn}
    >
      <span aria-hidden className="text-sm">
        ✉️
      </span>
    </a>
  );
}

// Opens the card (when closed) and toggles the panel with this id inside it.
export function PanelIcon({ id, label, children, className = iconBtn }: { id: string; label: string; children: ReactNode; className?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        const d = e.currentTarget.closest(".relative")?.querySelector("details");
        if (d) d.open = true;
        window.dispatchEvent(new CustomEvent(EVENT, { detail: id }));
      }}
      className={className}
    >
      {children}
    </button>
  );
}

// The panel a PanelIcon opens, at the top of the card's inside.
export function CardPanel({ id, children, className = "border-b border-zinc-100 px-4 pb-3 dark:border-white/5" }: { id: string; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = (e: Event) => {
      if ((e as CustomEvent).detail === id) setOpen((o) => !o);
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, [id]);
  return open ? <div className={className}>{children}</div> : null;
}

export function ChatIcon() {
  return (
    <span aria-hidden className="text-sm">
      🗨️
    </span>
  );
}

// A calendar with a plus: Book practices.
export function BookIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="size-4">
      <rect x="3" y="4.5" width="18" height="16" rx="2.5" />
      <path d="M8 2.5v4M16 2.5v4M3 9.5h18M12 12.5v5M9.5 15h5" />
    </svg>
  );
}

// A person with a plus: Add staff, Add coach.
export function AddPersonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="size-4">
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5M19 8v6M16 11h6" />
    </svg>
  );
}

// Two people with a plus: Add players.
export function AddPlayersIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="size-4">
      <circle cx="8" cy="8.5" r="3" />
      <circle cx="14.5" cy="7.5" r="2.5" />
      <path d="M2 19.5c.6-3 2.9-4.5 6-4.5s5.4 1.5 6 4.5M14 13.2c2.2-.2 4 .9 4.6 3M20 3v5M17.5 5.5h5" />
    </svg>
  );
}

// The filled blue round icon button used for a card's "add" action.
export const addIconBtn =
  "flex size-8 shrink-0 items-center justify-center rounded-full bg-thunder-blue text-white shadow-sm hover:bg-thunder-blue-dark";

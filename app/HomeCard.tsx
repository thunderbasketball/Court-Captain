"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { card } from "./ui";

const Chevron = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden className="size-5 shrink-0 text-zinc-400 transition-transform [details[open]>summary_&]:rotate-180">
    <path
      fillRule="evenodd"
      d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
      clipRule="evenodd"
    />
  </svg>
);

// The open cards, from the address: `?open=teams,members` (Home's cards) or `&sub=staff` (the cards inside Members).
function listed(param: string): string[] {
  const v = new URLSearchParams(window.location.search).get(param);
  return v ? v.split(",").filter(Boolean) : [];
}

// One card of a stack (Home's cards, Members' cards): its title, count and alert always; its contents only while it's
// open. Opening adds it to the address at once and the server builds just that card (closed cards cost nothing);
// closing takes it out at once, with no trip to the server. Shows "Loading…" until its contents arrive. A refresh keeps
// exactly what's open.
export default function HomeCard({
  id,
  param,
  title,
  count,
  alert,
  action,
  open,
  children,
}: {
  id: string;
  param: string;
  title: ReactNode;
  count?: ReactNode;
  alert?: boolean;
  action?: ReactNode;
  open: boolean; // the server built its contents (it's in the address)
  children: ReactNode; // null while closed
}) {
  const router = useRouter();
  const [want, setWant] = useState(open);
  const [pending, start] = useTransition();
  const tries = useRef(0);
  // Ask the server for the page at the address as it is now (it lists every open card).
  const load = () => start(() => router.replace(`${window.location.pathname}${window.location.search}${window.location.hash}`, { scroll: false }));
  // Open but still empty once the server has answered (an older answer, from before this card was in the address,
  // arrived last): ask again, up to 3 times.
  useEffect(() => {
    if (!want || open) {
      tries.current = 0;
      return;
    }
    if (pending || tries.current >= 3) return;
    tries.current++;
    load();
  });
  // A fresh page from the server: follow the address (a link, Back), never an answer that's out of date (a card closed
  // while it was loading stays closed).
  const [seen, setSeen] = useState(open);
  if (open !== seen) {
    setSeen(open);
    setWant(typeof window === "undefined" ? open : listed(param).includes(id));
  }
  const toggle = (next: boolean) => {
    setWant(next);
    // The address changes at once (so a refresh, or the next tap, sees it right away)…
    const keys = listed(param).filter((k) => k !== id);
    if (next) keys.push(id);
    const q = new URLSearchParams(window.location.search);
    if (keys.length) q.set(param, keys.join(","));
    else q.delete(param);
    if (param === "open" && !next && id === "members") q.delete("sub"); // closing Members closes its inner cards too
    const s = q.toString().replace(/%2C/g, ",");
    window.history.replaceState(null, "", `${window.location.pathname}${s ? `?${s}` : ""}${window.location.hash}`);
    // …and only opening asks the server, for just this card's contents. Closing needs nothing.
    if (next) load();
  };
  return (
    <div className="relative">
      <details
        id={id}
        className={`${card} group overflow-hidden`}
        open={want}
        onToggle={(e) => {
          const now = (e.currentTarget as HTMLDetailsElement).open;
          if (now !== want) toggle(now);
        }}
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 select-none [&::-webkit-details-marker]:hidden">
          <span className={`text-lg font-semibold ${action ? "pr-16" : ""} ${alert ? "animate-pulse text-red-600 dark:text-red-400" : ""}`}>
            {title}
            {count !== undefined && count !== null && <span className="font-normal text-zinc-500"> ({count})</span>}
          </span>
          <Chevron />
        </summary>
        {/* The part's own title is the card's, so its big heading is kept for screen readers only. */}
        <div className="border-t border-zinc-100 p-3 sm:p-4 dark:border-white/5 [&_h1]:sr-only">
          {want && (open ? children : <p className="text-sm text-zinc-500">Loading…</p>)}
        </div>
      </details>
      {action && <div className="absolute top-2 right-11">{action}</div>}
      {/* A part shown in this card can put its own buttons here (PageMenus slot), e.g. Teams' 📣 and +. */}
      {!action && <div id={`card-slot-${id}`} className="absolute top-1.5 right-11 flex items-center gap-2 empty:hidden" />}
    </div>
  );
}

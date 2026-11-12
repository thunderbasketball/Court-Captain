"use client";

import { useEffect, useRef, useState } from "react";
import type { PlaceHit } from "@/lib/places";
import { searchPlaces } from "./org/thunder/facilities/actions";
import { inputCls } from "./ui";

const newSession = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `s-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

// Find a real place (Google Places, asked from our server): type 3+ letters, pick one from the list. `onPick` gets the
// place and the search's session token (Google counts the search and the pick as one).
export default function PlaceSearch({
  org,
  onPick,
  placeholder = "Search for the gym's name or address…",
}: {
  org: string;
  onPick: (hit: PlaceHit, session: string) => void;
  placeholder?: string;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<PlaceHit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const session = useRef(newSession());
  const latest = useRef(0);

  useEffect(() => {
    const text = q.trim();
    if (text.length < 3) return;
    const n = ++latest.current;
    const t = setTimeout(async () => {
      const r = await searchPlaces(org, text, session.current);
      if (n !== latest.current) return;
      if (!r.ok) return setError(r.message);
      setError(null);
      setHits(r.hits);
    }, 350);
    return () => clearTimeout(t);
  }, [q, org]);

  const short = q.trim().length < 3;
  return (
    <div className="space-y-1">
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={placeholder}
        aria-label="Search for a place"
        autoComplete="off"
        className={inputCls}
      />
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      {!short && hits.length > 0 && (
        <ul className="divide-y divide-zinc-100 rounded-xl bg-white ring-1 ring-zinc-950/10 dark:divide-white/5 dark:bg-zinc-900 dark:ring-white/10">
          {hits.map((h) => (
            <li key={h.placeId}>
              <button
                type="button"
                onClick={() => {
                  onPick(h, session.current);
                  session.current = newSession(); // the next search is a new session
                  setQ("");
                  setHits([]);
                }}
                className="block w-full px-3 py-2 text-left hover:bg-zinc-50 dark:hover:bg-white/5"
              >
                <span className="block text-sm font-medium">{h.name}</span>
                <span className="block text-xs text-zinc-500">{h.address}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

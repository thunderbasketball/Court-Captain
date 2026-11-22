"use client";

import { useState } from "react";
import { CardPanel, PanelIcon, iconBtn } from "../../../CardIcons";
import { inputCls } from "../../../ui";

export const SEARCH_PANEL = "uniform-search";

// One searchable line: a player on the current list (with the order they went in, or not sent yet), or in a past order.
export type UniformHit = {
  key: string;
  name: string; // jersey name
  team: string;
  number: string | null;
  size: string | null;
  where: string; // "Current · Order #20261120", "Current · Not sent yet", "Order #20261120"
};

// The Uniforms card's 🔍 (top right, by the gear): opens the search right in the card.
export function UniformSearchIcon() {
  return (
    <PanelIcon id={SEARCH_PANEL} label="Search uniforms" className={iconBtn}>
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden className="size-5">
        <circle cx="8.5" cy="8.5" r="5.5" />
        <path d="m13 13 4.5 4.5" />
      </svg>
    </PanelIcon>
  );
}

// Search the current list and past orders: a last name, team, jersey number (22 or #22), size or order number.
export function UniformSearch({ hits }: { hits: UniformHit[] }) {
  const [q, setQ] = useState("");
  const words = q.trim().toLowerCase().replace(/#/g, "").split(/\s+/).filter(Boolean);
  const found = words.length
    ? hits.filter((h) => {
        const hay = `${h.name} ${h.team} ${h.size ?? ""} ${h.where}`.toLowerCase().replace(/#/g, "");
        // A number alone matches a jersey number exactly (22 isn't 2), or an order number.
        return words.every((w) => (/^\d{1,2}$/.test(w) ? h.number === w : hay.includes(w)));
      })
    : [];
  return (
    <CardPanel id={SEARCH_PANEL} className="mb-4 space-y-2 rounded-xl bg-zinc-50 p-3 dark:bg-white/5">
      <input
        type="search"
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Last name, team, #number, size or order"
        aria-label="Search current and past uniform orders"
        className={inputCls}
      />
      {words.length > 0 &&
        (found.length ? (
          <>
            <p className="text-xs text-zinc-500">
              {found.length} match{found.length === 1 ? "" : "es"}
              {found.length > 50 ? " (first 50)" : ""}
            </p>
            <ul className="divide-y divide-zinc-100 rounded-lg bg-white ring-1 ring-zinc-950/10 dark:divide-white/5 dark:bg-zinc-900 dark:ring-white/10">
              {found.slice(0, 50).map((h) => (
                <li key={h.key} className="grid grid-cols-[1fr_3rem_3rem] items-center gap-2 px-3 py-1.5 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate font-semibold tracking-wide">{h.name}</span>
                    <span className="block truncate text-xs text-zinc-500">
                      {h.team} · {h.where}
                    </span>
                  </span>
                  <span className="text-right tabular-nums">{h.number ? `#${h.number}` : "—"}</span>
                  <span className="text-right">{h.size ?? "—"}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-sm text-zinc-500">No matches in current or past orders.</p>
        ))}
    </CardPanel>
  );
}

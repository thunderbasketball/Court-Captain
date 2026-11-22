"use client";

import { useState, type ReactNode } from "react";

// By division / By organization on the League's Teams card: both are already on the page, so a tap switches at once
// (no reload). The choice is kept in the address for a refresh.
export default function TeamViews({
  initial,
  division,
  org,
}: {
  initial: "division" | "org";
  division: ReactNode;
  org: ReactNode;
}) {
  const [view, setView] = useState(initial);
  const pick = (v: "division" | "org") => {
    setView(v);
    try {
      const u = new URL(window.location.href);
      if (v === "org") u.searchParams.set("view", "org");
      else u.searchParams.delete("view");
      window.history.replaceState(window.history.state, "", u);
    } catch {
      // the address is only a convenience
    }
  };
  return (
    <>
      <nav aria-label="Team views" className="mb-4 flex gap-2">
        {(
          [
            ["division", "By division"],
            ["org", "By organization"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            aria-pressed={view === k}
            onClick={() => pick(k)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${
              view === k
                ? "bg-scenic-navy text-white dark:bg-white dark:text-zinc-900"
                : "text-zinc-600 ring-1 ring-zinc-950/10 hover:bg-zinc-50 dark:text-zinc-300 dark:ring-white/15"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>
      <div hidden={view !== "division"}>{division}</div>
      <div hidden={view !== "org"}>{org}</div>
    </>
  );
}

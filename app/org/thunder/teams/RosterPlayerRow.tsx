"use client";

import { useState, type ReactNode } from "react";

// One player in a roster (a Teams page card, or the team page's Players card): the name and grade line; tapping it
// opens their details right there.
export default function RosterPlayerRow({
  line,
  more,
  className = "py-1.5",
}: {
  line: ReactNode;
  more: ReactNode;
  className?: string; // padding (the team page's Players card uses wider rows)
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className={`${className} text-sm`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-baseline justify-between gap-2 text-left"
      >
        {line}
      </button>
      {open && <div className="mt-1 mb-0.5 space-y-1 pl-2 text-zinc-600 dark:text-zinc-300">{more}</div>}
    </li>
  );
}

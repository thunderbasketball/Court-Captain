"use client";

import { useState, type ReactNode } from "react";

// A header button whose panel opens right under the header (no pop-up), the page's width: the gear, the 🔍 search.
// Tap the button again or × to close (not a tap outside, so a half-filled form isn't lost). `children` gets close().
export default function HeaderDrop({
  label,
  ariaLabel,
  title,
  className,
  children,
}: {
  label: ReactNode;
  ariaLabel: string;
  title: string;
  className: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <>
      <button
        type="button"
        aria-label={ariaLabel}
        title={ariaLabel}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={`${className} ${open ? "bg-zinc-100 dark:bg-zinc-800" : ""}`}
      >
        {label}
      </button>
      {open && (
        // Under the header (its nearest positioned box), over the page.
        <div className="absolute inset-x-0 top-full z-20 px-4 pt-2">
          <div className="mx-auto max-w-3xl rounded-2xl bg-white p-3 shadow-lg ring-1 ring-zinc-950/10 dark:bg-zinc-900 dark:ring-white/10">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">{title}</span>
              <button
                type="button"
                aria-label="Close"
                onClick={close}
                className="rounded-full px-2 text-lg leading-none text-zinc-400 hover:text-zinc-700"
              >
                ×
              </button>
            </div>
            <div className="max-h-[75dvh] overflow-y-auto p-1">{children(close)}</div>
          </div>
        </div>
      )}
    </>
  );
}

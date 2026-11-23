"use client";

import { useState } from "react";

// Share a public page: the phone's share sheet (text, email, any app) where there is one, else copies the link.
// `label`: an icon-only button (the header's, beside the organization's name) named this for screen readers.
export default function ShareButton({
  path,
  title,
  className = "",
  label,
}: {
  path: string;
  title: string;
  className?: string;
  label?: string;
}) {
  const [note, setNote] = useState<string | null>(null);
  const share = async () => {
    const url = new URL(path, window.location.origin).toString();
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch (e) {
        if ((e as Error).name === "AbortError") return; // they closed the share sheet
      }
    }
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Older browsers: copy through a hidden box.
      const t = document.createElement("textarea");
      t.value = url;
      t.style.position = "fixed";
      t.style.opacity = "0";
      document.body.appendChild(t);
      t.select();
      document.execCommand("copy");
      t.remove();
    }
    setNote("Link copied ✓");
    setTimeout(() => setNote(null), 2500);
  };
  return (
    <span className="relative inline-flex shrink-0">
      {label ? (
        <button
          type="button"
          onClick={share}
          aria-label={label}
          title={label}
          className={`grid size-8 shrink-0 place-items-center rounded-full text-thunder-blue hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-white/5 ${className}`}
        >
          {/* Share: a box with an arrow up out of it */}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="size-[18px]" aria-hidden>
            <path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M8 11H6a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-2" />
          </svg>
        </button>
      ) : (
        <button
          type="button"
          onClick={share}
          className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-semibold text-thunder-blue ring-1 ring-thunder-blue/40 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-white/5 ${className}`}
        >
          Share
        </button>
      )}
      {note && (
        <span role="status" className="absolute top-full right-0 mt-1 whitespace-nowrap text-xs font-medium text-emerald-600 dark:text-emerald-400">
          {note}
        </span>
      )}
    </span>
  );
}

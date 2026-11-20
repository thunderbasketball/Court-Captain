"use client";

import { useState } from "react";

// Share a public page: the phone's share sheet (text, email, any app) where there is one, else copies the link.
export default function ShareButton({ path, title, className = "" }: { path: string; title: string; className?: string }) {
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
      <button
        type="button"
        onClick={share}
        className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-semibold text-thunder-blue ring-1 ring-thunder-blue/40 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-white/5 ${className}`}
      >
        Share
      </button>
      {note && (
        <span role="status" className="absolute top-full right-0 mt-1 whitespace-nowrap text-xs font-medium text-emerald-600 dark:text-emerald-400">
          {note}
        </span>
      )}
    </span>
  );
}

"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";

// The on-screen step guide: "Step 2 of 3 · Your teams", one plain sentence on what to do now, and a progress bar. Shown
// while someone registers, verifies their email or logs in for the first time. Hide (remembered on this phone per guide)
// leaves a small "Show steps" link.
const EVT = "cc-step-guide";
const keyOf = (name: string) => `cc_guide_hidden_${name}`;
const subscribe = (cb: () => void) => {
  window.addEventListener("storage", cb);
  window.addEventListener(EVT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(EVT, cb);
  };
};
const read = (name: string) => {
  try {
    return localStorage.getItem(keyOf(name)) === "1";
  } catch {
    return false;
  }
};

export default function StepGuide({
  name,
  step,
  total,
  title,
  children,
}: {
  name: string; // which guide (Hide is remembered per guide)
  step: number;
  total?: number; // none: the count isn't known yet (no progress bar)
  title: string;
  children: ReactNode;
}) {
  const stored = useSyncExternalStore(subscribe, () => read(name), () => false);
  const [local, setLocal] = useState<boolean | null>(null); // when this phone can't remember it
  const hidden = local ?? stored;
  const set = (hide: boolean) => {
    setLocal(hide);
    try {
      if (hide) localStorage.setItem(keyOf(name), "1");
      else localStorage.removeItem(keyOf(name));
      window.dispatchEvent(new Event(EVT));
    } catch {}
  };
  if (hidden)
    return (
      <div className="text-right">
        <button type="button" onClick={() => set(false)} className="text-xs font-medium text-thunder-blue hover:underline dark:text-blue-400">
          Show steps{total ? ` (${step} of ${total})` : ""}
        </button>
      </div>
    );
  return (
    <aside
      aria-label={total ? `Step ${step} of ${total}` : `Step ${step}`}
      className="rounded-xl bg-blue-50 px-3 py-2.5 ring-1 ring-thunder-blue/20 ring-inset dark:bg-blue-500/10 dark:ring-blue-400/20"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold tracking-wide text-thunder-blue uppercase dark:text-blue-300">
          Step {step}
          {total ? ` of ${total}` : ""} · {title}
        </p>
        <button type="button" onClick={() => set(true)} className="shrink-0 text-xs text-zinc-500 hover:underline dark:text-zinc-400">
          Hide
        </button>
      </div>
      <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-200">{children}</p>
      {total && (
        <div className="mt-2 flex gap-1" aria-hidden>
          {Array.from({ length: total }, (_, i) => (
            <span key={i} className={`h-1 flex-1 rounded-full ${i < step ? "bg-thunder-blue dark:bg-blue-400" : "bg-thunder-blue/15 dark:bg-white/10"}`} />
          ))}
        </div>
      )}
    </aside>
  );
}

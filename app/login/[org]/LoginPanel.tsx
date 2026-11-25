"use client";

import { useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { BRAND_KEY } from "@/lib/brand-script";

const never = () => () => {};
// This phone has been logged in before (RememberBrand is only on signed-in pages).
const loggedInBefore = () => {
  try {
    return localStorage.getItem(BRAND_KEY) !== null;
  } catch {
    return false;
  }
};

// The login box on an organization's main page. A wide screen: always open. A phone: one row that opens in place, so a
// visitor sees the organization first; already open on a phone that has logged in before, so coaches don't tap twice.
export default function LoginPanel({ children }: { children: ReactNode }) {
  const known = useSyncExternalStore(never, loggedInBefore, () => false);
  const [picked, setPicked] = useState<boolean | null>(null);
  const open = picked ?? known;
  const box = useRef<HTMLDivElement>(null);
  return (
    <section id="login" className="rounded-2xl bg-white shadow-sm ring-1 ring-zinc-950/5 dark:bg-zinc-900 dark:ring-white/10">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          flushSync(() => setPicked(!open));
          if (!open) box.current?.querySelector("input")?.focus();
        }}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left lg:hidden"
      >
        <span>
          <span className="block font-semibold">Log in</span>
          <span className="block text-xs text-zinc-500">Coaches, staff and families</span>
        </span>
        <span aria-hidden className={`text-zinc-400 transition ${open ? "rotate-90" : ""}`}>
          ›
        </span>
      </button>
      <div ref={box} className={`p-5 lg:block ${open ? "border-t border-zinc-100 lg:border-t-0 dark:border-white/5" : "hidden"}`}>
        {children}
      </div>
    </section>
  );
}

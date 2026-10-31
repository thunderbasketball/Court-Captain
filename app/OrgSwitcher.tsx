"use client";

import { useEffect, useRef, useState } from "react";

// The logo next to Log out, for people in more than one organization: tap it, pick an organization.
// /switch checks on the server that they still have a role there.
export default function OrgSwitcher({ current, orgs }: { current: string; orgs: { slug: string; name: string; logo: string }[] }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const here = orgs.find((o) => o.slug === current) ?? orgs[0];

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <div ref={box} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${here.name}. Switch organization`}
        className="flex items-center gap-0.5 rounded-full p-0.5 ring-1 ring-zinc-950/10 hover:bg-zinc-100 dark:ring-white/15 dark:hover:bg-zinc-800"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- tiny logo, already sized */}
        <img src={here.logo} alt="" className="size-8 rounded-full object-contain" />
        <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden className="mr-1 size-3.5 text-zinc-500">
          <path d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-2 w-64 rounded-2xl bg-white p-1.5 shadow-lg ring-1 ring-zinc-950/10 dark:bg-zinc-900 dark:ring-white/15"
        >
          <p className="px-3 pt-1.5 pb-1 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">Switch organization</p>
          {orgs.map((o) => (
            <a
              key={o.slug}
              role="menuitem"
              href={`/switch?org=${o.slug}`}
              aria-current={o.slug === current ? "true" : undefined}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                o.slug === current ? "bg-zinc-100 dark:bg-zinc-800" : ""
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- tiny logo, already sized */}
              <img src={o.logo} alt="" className="size-8 rounded-full object-contain" />
              <span className="flex-1">{o.name}</span>
              {o.slug === current && <span className="text-xs text-zinc-500">Here</span>}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

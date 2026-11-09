"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import OrgLogo from "./OrgLogo";
import { GROUP_OVER, groupByFeatures } from "@/lib/org-groups";

type Org = { slug: string; name: string; logo: string | null; color?: string; group: string }; // group: by its features

// The logo next to Log out, for anyone in an organization: tap it, pick an organization (/switch checks on the server that
// they still have a role there), open their dashboard, or create a new organization (they become its Owner). More than 4
// organizations: grouped by their CourtCaptain features ("CourtOrg + CourtSync"), each group tapped open (the one
// they're in starts open); CourtCaptain (staff) stays on top.
export default function OrgSwitcher({
  current,
  orgs,
}: {
  current: string;
  orgs: Org[];
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const here = orgs.find((o) => o.slug === current) ?? orgs[0];
  const top = orgs.filter((o) => o.group === "Platform");
  const rest = orgs.filter((o) => o.group !== "Platform");
  const groups = rest.length > GROUP_OVER ? groupByFeatures(rest) : null;
  const [shown, setShown] = useState<Set<string>>(
    () => new Set(groups?.filter((g) => g.orgs.some((o) => o.slug === current)).map((g) => g.label) ?? []),
  );
  const item = (o: Org, indent = false) => (
    <a
      key={o.slug}
      role="menuitem"
      href={`/switch?org=${o.slug}`}
      aria-current={o.slug === current ? "true" : undefined}
      className={`flex items-center gap-3 rounded-xl py-2.5 pr-3 text-sm font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
        indent ? "pl-5" : "pl-3"
      } ${o.slug === current ? "bg-zinc-100 dark:bg-zinc-800" : ""}`}
    >
      <OrgLogo src={o.logo} name={o.name} color={o.color} className="size-8 rounded-full" />
      <span className="flex-1">{o.name}</span>
      {o.slug === current && <span className="text-xs text-zinc-500">Here</span>}
    </a>
  );

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
        <OrgLogo src={here.logo} name={here.name} color={here.color} className="size-8 rounded-full" />
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
          <div className="max-h-[65vh] overflow-y-auto">
            {top.map((o) => item(o))}
            {groups
              ? groups.map((g) => {
                  const isOpen = shown.has(g.label);
                  return (
                    <div key={g.label}>
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        onClick={() =>
                          setShown((s) => {
                            const n = new Set(s);
                            if (n.has(g.label)) n.delete(g.label);
                            else n.add(g.label);
                            return n;
                          })
                        }
                        className="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm font-semibold hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      >
                        <span className="min-w-0">
                          {g.label} <span className="font-normal text-zinc-500">({g.orgs.length})</span>
                          {!isOpen && (
                            <span className="mt-1 flex flex-wrap gap-1">
                              {g.orgs.map((o) => (
                                <OrgLogo key={o.slug} src={o.logo} name={o.name} color={o.color} className="size-5 rounded-full" />
                              ))}
                            </span>
                          )}
                        </span>
                        <span className={`text-zinc-400 transition-transform ${isOpen ? "rotate-90" : ""}`}>›</span>
                      </button>
                      {isOpen && g.orgs.map((o) => item(o, true))}
                    </div>
                  );
                })
              : rest.map((o) => item(o))}
          </div>
          <Link
            href="/me"
            role="menuitem"
            className="mt-1 block rounded-xl border-t border-zinc-100 px-3 py-2.5 text-sm font-medium hover:bg-zinc-100 dark:border-white/5 dark:hover:bg-zinc-800"
          >
            My dashboard
          </Link>
          <Link
            href="/register"
            role="menuitem"
            className="block rounded-xl px-3 py-2.5 text-sm font-semibold text-thunder-blue hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            + Create a new organization
          </Link>
        </div>
      )}
    </div>
  );
}

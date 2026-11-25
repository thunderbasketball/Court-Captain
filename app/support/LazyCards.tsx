"use client";

import { useState, type ReactNode } from "react";
import type { MyRelease } from "@/lib/whats-new-seen";
import { SupportLoader } from "./SupportDrop";
import WhatsNew from "./WhatsNew";
import { card, yellowCard } from "../ui";

// A card built only once it's opened.
function Lazy({ title, tint = false, children }: { title: ReactNode; tint?: boolean; children: ReactNode }) {
  const [opened, setOpened] = useState(false);
  return (
    <details className={`${tint ? yellowCard : card} overflow-hidden`} onToggle={(e) => e.currentTarget.open && setOpened(true)}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 font-semibold [&::-webkit-details-marker]:hidden">
        <span>{title}</span>
        <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden className="size-5 shrink-0 text-zinc-400 transition-transform [details[open]>summary_&]:rotate-180">
          <path
            fillRule="evenodd"
            d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
            clipRule="evenodd"
          />
        </svg>
      </summary>
      {opened && <div className="border-t border-zinc-100 p-3 dark:border-white/5">{children}</div>}
    </details>
  );
}

export function NewsCard({ releases, fresh }: { releases: MyRelease[]; fresh: string[] }) {
  return (
    <Lazy
      tint={fresh.length > 0}
      title={
        <>
          ✨ What&apos;s New {fresh.length > 0 && <span className="font-normal text-zinc-500">(Version {fresh[0]})</span>}
        </>
      }
    >
      <WhatsNew releases={releases} fresh={fresh} seen />
      <p className="px-1 pt-2 text-xs text-zinc-500">Find this later in Support, under What&apos;s New.</p>
    </Lazy>
  );
}

export function SupportLazyCard({ org, version }: { org: string | null; version: string }) {
  return (
    <Lazy title={<>Support <span className="font-normal text-zinc-500">(questions, how to, chat · v{version})</span></>}>
      <SupportLoader org={org} />
    </Lazy>
  );
}

"use client";

import { useEffect, useState, useTransition } from "react";
import HeaderDrop from "../HeaderDrop";
import { loadSupport } from "./actions";
import { SupportPanel } from "./SupportPanel";

type Loaded = Extract<Awaited<ReturnType<typeof loadSupport>>, { ok: true }>;

// The header's ? on every page, for everyone logged in: Support, opened right under the header and read only then.
export default function SupportDrop({ org, className }: { org: string | null; className: string }) {
  return (
    <HeaderDrop
      label={
        <span className="flex items-center gap-1">
          <HelpIcon />
          <span className="hidden text-xs font-semibold sm:inline">Support</span>
        </span>
      }
      ariaLabel="Support" title="Support" className={className}>
      {() => <SupportLoader org={org} />}
    </HeaderDrop>
  );
}

export function SupportLoader({ org }: { org: string | null }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  useEffect(() => {
    start(async () => {
      const r = await loadSupport(org).catch(() => null);
      if (r?.ok) setData(r);
      else setError(r?.message ?? "Support didn't load. Please try again.");
    });
  }, [org]);
  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!data) return <p className="text-sm text-zinc-500">Loading…</p>;
  return <SupportPanel org={org} articles={data.articles} mine={data.mine} inbox={data.inbox} staff={data.staff} others={data.others} news={data.news} version={data.version} />;
}

const HelpIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="size-5" aria-hidden>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.4 9.2a2.7 2.7 0 1 1 3.9 2.4c-.9.5-1.3 1-1.3 2M12 17h.01" />
  </svg>
);

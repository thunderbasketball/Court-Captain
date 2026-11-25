"use client";

import { useState, useTransition } from "react";
import FoundPlayers from "../FoundPlayers";
import SubCard from "../SubCard";
import { ArticleList } from "../support/SupportPanel";
import WhatsNew from "../support/WhatsNew";
import { Eye, ViewAsButton, eyeBtn } from "../ViewAsButton";
import { loadParentView } from "./actions";

type Loaded = Extract<Awaited<ReturnType<typeof loadParentView>>, { ok: true }>;

// 👁 by a player's parent on a roster: what that parent sees, view only, opened right below (whether or not they've logged
// in). Owners and Admins can also open the whole app as a parent with a login.
export default function ParentViewButton({ registrantId, slot, name }: { registrantId: string; slot: 1 | 2; name: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-label={`See what ${name} sees (view only)`}
        title={`See what ${name} sees (view only)`}
        className={`${eyeBtn} ${open ? "bg-orange-100 text-thunder-orange dark:bg-orange-500/15" : ""}`}
        onClick={() => {
          setOpen(!open);
          if (!open && !data)
            start(async () => {
              setError(null);
              const r = await loadParentView(registrantId, slot).catch(() => null);
              if (r?.ok) setData(r);
              else setError(r?.message ?? "It didn't load. Please try again.");
            });
        }}
      >
        <Eye />
      </button>
      {open && (
        <div className="order-last mt-1 w-full basis-full space-y-2 rounded-xl bg-white p-2 ring-2 ring-thunder-orange/60 dark:bg-zinc-900">
          <p className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-thunder-orange px-3 py-1.5 text-sm font-medium text-white">
            <span>👁 As {name} sees it · view only</span>
            <button type="button" onClick={() => setOpen(false)} className="rounded-full bg-white px-3 py-0.5 text-xs font-bold text-thunder-orange">
              Close
            </button>
          </p>
          {busy && !data && <p className="px-1 text-sm text-zinc-500">Loading…</p>}
          {error && <p className="px-1 text-sm text-red-600">{error}</p>}
          {data && (
            <>
              {!data.view.players.length && <p className="px-1 text-sm text-zinc-500">No current registrations.</p>}
              <FoundPlayers players={data.view.players} today={data.today} />
              {data.view.owed !== null && data.view.owed > 0 && (
                <p className="px-1 text-sm font-medium text-amber-700 dark:text-amber-300">Registration fees: ${data.view.owed.toFixed(2)} still owed.</p>
              )}
              <SubCard title="Support" count={data.articles.length}>
                <ArticleList articles={data.articles} empty="Nothing yet." />
              </SubCard>
              {data.releases.length > 0 && (
                <SubCard title="What's New">
                  <WhatsNew releases={data.releases} />
                </SubCard>
              )}
              <p className="px-1 text-xs text-zinc-500">
                {!data.view.whole && "Only their players on your team show here. "}
                {data.view.login?.coachId
                  ? "They have a login. "
                  : data.view.login
                    ? data.view.canLogIn
                      ? "They haven't logged in yet: they use the cell on the registration and confirm their email. "
                      : "No cell on the registration, so they can't log in or look up their player. "
                    : ""}
                Chats and alerts aren&apos;t shown.
              </p>
              {data.view.login?.coachId && (
                <p className="flex items-center gap-2 px-1 text-sm">
                  <ViewAsButton coachId={data.view.login.coachId} name={data.view.name} /> Open the whole app as them (view only)
                </p>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}

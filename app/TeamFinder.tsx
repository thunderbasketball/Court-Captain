"use client";

import { useEffect, useState, useTransition } from "react";
import type { FoundTeam } from "@/lib/team-finder";
import { findTeams } from "./league/actions";
import { PublicTeam } from "./FollowTeams";
import { genderOf, genderTint, inputCls, primaryBtn } from "./ui";

// The start of Register (a League's page, its Register page): registering is for NEW teams. A team already in the League is
// managed by its organization (`onNew` left out: just the search, on another organization's view of the League): found here by its coach's last name as they type, and opened to its public view right there.
export default function TeamFinder({ org, league, onNew }: { org: string; league: string; onNew?: () => void }) {
  const [text, setText] = useState("");
  const [found, setFound] = useState<{ for: string; teams: FoundTeam[] } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const typed = text.trim();
  const ready = typed.replace(/[^\p{L}\p{N}]/gu, "").length >= 2;

  // Searches a moment after they stop typing.
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(
      () =>
        start(async () => {
          const r = await findTeams(org, typed).catch(() => null);
          if (r?.ok) {
            setFound({ for: typed, teams: r.teams });
            setError(null);
          } else setError(r?.message ?? "The search didn't work. Please try again.");
        }),
      250,
    );
    return () => clearTimeout(t);
  }, [org, typed, ready]);

  const teams = ready && found ? found.teams : [];
  return (
    <div className="space-y-4">
      {onNew && <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-600/25 ring-inset dark:bg-amber-500/10 dark:text-amber-200">
        <p className="text-base font-bold">Registration is for NEW teams only.</p>
        <p className="mt-1">
          Is your team part of an organization already in {league}? It&apos;s already managed for you: <b>don&apos;t register it again</b>. Find it below, and contact
          your organization for help.
        </p>
      </div>}
      <div className="space-y-2">
        <label className="block">
          <span className="mb-1 block text-sm font-semibold">Find your team by its coach&apos;s last name</span>
          <input
            className={inputCls}
            value={text}
            maxLength={40}
            autoComplete="off"
            placeholder="Coach's last name"
            onChange={(e) => {
              setText(e.target.value);
              setOpen(null);
            }}
          />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {ready && found && !teams.length && !busy && found.for === typed && (
          <p className="text-sm text-zinc-600 dark:text-zinc-300">No team found for &ldquo;{typed}&rdquo;. Check the spelling{onNew ? ", or register it below if it's new" : ""}.</p>
        )}
        {busy && !teams.length && <p className="text-sm text-zinc-500">Searching…</p>}
        {teams.length > 0 && (
          <ul aria-live="polite" className="space-y-2">
            {teams.map((t) => (
              <li key={t.id} className={`overflow-hidden rounded-xl ring-1 ${genderTint(genderOf(t.group)) ?? "ring-zinc-950/10 dark:ring-white/10"}`}>
                <button
                  type="button"
                  aria-expanded={open === t.id}
                  onClick={() => setOpen((x) => (x === t.id ? null : t.id))}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
                >
                  <span className="min-w-0">
                    <span className="block font-semibold">{t.name}</span>
                    <span className="block text-xs text-zinc-500">
                      {t.group}
                      {t.org && ` · ${t.org}`}
                    </span>
                  </span>
                  <span aria-hidden className={`text-zinc-400 transition ${open === t.id ? "rotate-90" : ""}`}>
                    ›
                  </span>
                </button>
                {open === t.id && (
                  <div className="space-y-2 px-3 pb-3">
                    <PublicTeam org={org} id={t.id} />
                    <p className="text-sm text-zinc-600 dark:text-zinc-300">
                      {t.org ? (
                        <>
                          This team is already registered by <b>{t.org}</b>. Questions? Contact {t.org}
                          {t.orgSlug && (
                            <>
                              {" "}
                              (
                              <a href={`/login/${t.orgSlug}`} className="font-medium text-thunder-blue hover:underline dark:text-blue-400">
                                its page
                              </a>
                              )
                            </>
                          )}
                          . Coaching it? Log in with your cell.
                        </>
                      ) : (
                        "This team is already registered. Coaching it? Log in with your cell."
                      )}
                    </p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {onNew && <div className="space-y-2 border-t border-zinc-100 pt-4 dark:border-white/5">
        <button type="button" onClick={onNew} className={`${primaryBtn} w-full`}>
          My team is new: register it
        </button>
        <p className="text-center text-xs text-zinc-500">Run an organization here already? This also takes you to your own teams.</p>
      </div>}
    </div>
  );
}

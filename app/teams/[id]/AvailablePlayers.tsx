"use client";

import { useRef, useState } from "react";
import type { Fields } from "@/lib/evaluation-fields";
import type { EvalCard } from "@/lib/evaluations";
import { gradeLabel } from "@/lib/grades";
import { CloseButton, Toast, dialogCls } from "../../client-ui";
import { saveEvaluation } from "../actions";
import { Card } from "./evaluate/EvalBoard";

type Filter = "all" | "unrated" | "interested";
const rated = (c: Fields) => !!(c.position || c.height || c.speed || c.score || c.notes);

// Roster tab: eligible players not on any team yet. ★ marks this team's interest; Evaluate opens the player's card.
export default function AvailablePlayers({ teamId, teamName, cards }: { teamId: string; teamName: string; cards: EvalCard[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  // The latest fields of each player, so the star, the filters and the pop-up agree.
  const [live, setLive] = useState<Record<string, Partial<EvalCard>>>({});
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<EvalCard | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  const cur = (c: EvalCard): EvalCard => ({ ...c, ...live[c.registrantId] });
  const update = (id: string, patch: Partial<EvalCard>) => setLive((m) => ({ ...m, [id]: { ...m[id], ...patch } }));
  const matches = (c: EvalCard, f: Filter) => f === "all" || (f === "unrated" ? !rated(cur(c)) : cur(c).interested);
  const q = search.trim().toLowerCase();
  const shown = cards.filter((c) => matches(c, filter) && (!q || `${c.firstName} ${c.lastName}`.toLowerCase().includes(q)));
  const grades = [...new Set(shown.map((c) => c.grade))];

  async function star(c: EvalCard) {
    const interested = !cur(c).interested;
    update(c.registrantId, { interested });
    const r = await saveEvaluation(teamId, c.registrantId, { interested });
    if (r.ok) return update(c.registrantId, { updatedBy: r.updatedBy, updatedAt: r.updatedAt });
    update(c.registrantId, { interested: !interested });
    setError(`${c.firstName} ${c.lastName}: ${r.message}`);
  }

  return (
    <>
      {error && <Toast key={error} message={error} />}
      <div className="flex gap-2 overflow-x-auto px-4 pb-3">
        {(
          [
            ["all", "All"],
            ["unrated", "Not rated"],
            ["interested", "★ Interested"],
          ] as const
        ).map(([f, label]) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium whitespace-nowrap ${
              filter === f
                ? "bg-thunder-blue text-white shadow-sm"
                : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
            }`}
          >
            {label} ({cards.filter((c) => matches(c, f)).length})
          </button>
        ))}
      </div>
      {cards.length > 8 && (
        <div className="px-4 pb-3">
          <input
            className="w-full rounded-xl border-0 bg-white px-3 py-2.5 text-base ring-1 ring-zinc-950/10 outline-none focus:ring-2 focus:ring-thunder-blue dark:bg-zinc-900 dark:ring-white/15"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find a player…"
          />
        </div>
      )}
      {!shown.length && <p className="px-4 pb-4 text-sm text-zinc-500">No players here.</p>}
      {grades.map((g) => (
        <div key={g}>
          <h3 className="border-t border-zinc-100 bg-zinc-50 px-4 py-1.5 text-xs font-bold tracking-wide text-zinc-500 uppercase dark:border-white/5 dark:bg-white/5">
            {gradeLabel(g)}
          </h3>
          <ul className="divide-y divide-zinc-100 dark:divide-white/5">
            {shown
              .filter((c) => c.grade === g)
              .map((c) => {
                const f = cur(c);
                const others = c.interestedTeams.filter((t) => t !== teamName);
                return (
                  <li key={c.registrantId} className="flex items-center gap-3 px-4 py-2.5">
                    <button
                      type="button"
                      aria-pressed={f.interested}
                      aria-label={
                        f.interested
                          ? `Interested in ${c.firstName} ${c.lastName}`
                          : `Mark interest in ${c.firstName} ${c.lastName}`
                      }
                      title={f.interested ? "Interested (tap to clear)" : "Mark interested"}
                      onClick={() => star(c)}
                      className={`shrink-0 text-2xl leading-none ${f.interested ? "text-orange-500" : "text-zinc-300 hover:text-orange-400 dark:text-zinc-600"}`}
                    >
                      {f.interested ? "★" : "☆"}
                    </button>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {c.firstName} <span className="font-semibold">{c.lastName}</span>
                      </span>
                      <span className="block truncate text-xs text-zinc-400">
                        {rated(f)
                          ? [f.position, f.height, f.speed, f.score && `${f.score}/5`].filter(Boolean).join(" · ") || "Notes"
                          : "Not rated"}
                        {others.length > 0 && (
                          <span className="text-orange-700 dark:text-orange-300"> · ★ {others.join(", ")}</span>
                        )}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(f);
                        dialog.current?.showModal();
                      }}
                      className="shrink-0 rounded-full px-3 py-1.5 text-sm font-semibold text-thunder-blue ring-1 ring-thunder-blue/30 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-500/10"
                    >
                      Evaluate
                    </button>
                  </li>
                );
              })}
          </ul>
        </div>
      ))}
      <dialog
        ref={dialog}
        className={dialogCls}
        onClose={() => setOpen(null)}
        onClick={(e) => e.target === dialog.current && dialog.current?.close()}
      >
        <div className="p-3">
          <div className="flex justify-end">
            <CloseButton onClick={() => dialog.current?.close()} />
          </div>
          {open && (
            <Card
              key={open.registrantId}
              teamId={teamId}
              teamName={teamName}
              card={open}
              onChange={(next) => update(open.registrantId, next)}
              onError={setError}
            />
          )}
        </div>
      </dialog>
    </>
  );
}

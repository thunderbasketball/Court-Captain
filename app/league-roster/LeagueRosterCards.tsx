"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { LeagueRoster, SnapshotPlayer } from "@/lib/roster-snapshot";
import { addToLeagueRoster, setOnLeagueRoster } from "./actions";

const field = "w-full min-w-0 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-white/15 dark:bg-zinc-900";
const day = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

// A team page's League rosters (inside its card): locked at the team's 1st game. The League's Directors of Teams fix one:
// + Add player, Take off, Put back. Who did it shows to Owners and Admins (`who`).
export default function LeagueRosterCards({ rosters, teamId, who }: { rosters: LeagueRoster[]; teamId: string; who: boolean }) {
  return (
    <div className="space-y-4 px-4 pb-4">
      {rosters.map((r) => (
        <section key={r.programId}>
          <p className="text-sm">
            <span className="font-semibold">{r.program}</span>
            <span className="text-zinc-500"> · locked {day(r.firstGame)} (1st game)</span>
          </p>
          <ul className="mt-1 divide-y divide-zinc-100 dark:divide-white/5">
            {r.players.map((p) => (
              <Player key={p.id} p={p} mayFix={r.mayFix} who={who} />
            ))}
          </ul>
          {!r.players.length && <p className="text-sm text-red-600 dark:text-red-400">No players were on the roster at its 1st game.</p>}
          {r.mayFix && <AddPlayer programId={r.programId} teamId={teamId} />}
        </section>
      ))}
    </div>
  );
}

function Player({ p, mayFix, who }: { p: SnapshotPlayer; mayFix: boolean; who: boolean }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const off = p.removedBy !== null;
  const born = p.birthdate && `${Number(p.birthdate.slice(5, 7))}/${Number(p.birthdate.slice(8, 10))}/${p.birthdate.slice(0, 4)}`;
  return (
    <li className="flex items-start justify-between gap-3 py-1.5 text-sm">
      <span className="min-w-0">
        <span className={off ? "text-zinc-400 line-through" : ""}>
          <span className="inline-block w-8 text-zinc-500 tabular-nums">{p.jersey && `#${p.jersey}`}</span>
          <span className="font-medium">
            {p.first} {p.last}
          </span>
        </span>
        <span className="block pl-8 text-xs text-zinc-500">
          {born ? `Born ${born}` : <span className="font-medium text-red-600 dark:text-red-400">no birthdate</span>}
          {p.addedBy && (who ? ` · added by ${p.addedBy}` : " · added by the League")}
          {p.removedBy && (who ? ` · taken off by ${p.removedBy}` : " · taken off by the League")}
        </span>
        {err && <span className="block pl-8 text-xs text-red-600 dark:text-red-400">{err}</span>}
      </span>
      {mayFix && (
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            start(async () => {
              setErr(null);
              const r = await setOnLeagueRoster(p.id, !off);
              if (!r.ok) return setErr(r.message);
              router.refresh();
            })
          }
          className={`shrink-0 text-xs font-medium disabled:opacity-50 ${off ? "text-thunder-blue dark:text-blue-400" : "text-red-600 dark:text-red-400"}`}
        >
          {off ? "Put back" : "Take off"}
        </button>
      )}
    </li>
  );
}

function AddPlayer({ programId, teamId }: { programId: string; teamId: string }) {
  const router = useRouter();
  const blank = { first: "", last: "", grade: "", jersey: "", birthdate: "" };
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(blank);
  const [err, setErr] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-1 text-sm font-medium text-thunder-blue dark:text-blue-400">
        + Add player
      </button>
    );
  return (
    <form
      className="mt-2 space-y-2 rounded-xl bg-zinc-50 p-3 dark:bg-white/5"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setErr(null);
          const r = await addToLeagueRoster(programId, teamId, f);
          if (!r.ok) return setErr(r.message);
          setF(blank);
          setOpen(false);
          router.refresh();
        });
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <input className={field} placeholder="First name" autoComplete="off" value={f.first} onChange={set("first")} />
        <input className={field} placeholder="Last name" autoComplete="off" value={f.last} onChange={set("last")} />
        <input className={field} placeholder="Grade (K–12)" value={f.grade} onChange={set("grade")} />
        <input className={field} placeholder="Jersey #" inputMode="numeric" maxLength={2} value={f.jersey} onChange={set("jersey")} />
        <input className={`${field} col-span-2`} placeholder="Birthdate (5/3/2014)" value={f.birthdate} onChange={set("birthdate")} />
      </div>
      {err && <p className="text-sm text-red-600 dark:text-red-400">{err}</p>}
      <div className="flex gap-2">
        <button disabled={busy} className="rounded-full bg-thunder-blue px-3.5 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
          {busy ? "Adding…" : "Add player"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-zinc-500">
          Cancel
        </button>
      </div>
    </form>
  );
}

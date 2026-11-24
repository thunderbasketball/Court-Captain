"use client";

import { useState, useTransition } from "react";
import type { FoundPlayer } from "@/lib/find-player";
import { formatCell } from "@/lib/phone";
import { ScheduleList } from "../LeagueGames";
import { sendFindCode, showMyPlayers } from "./actions";
import { PhoneLink, inputCls, primaryBtn } from "../ui";

// Find my player's team (public pages, no login): the parent's cell, then the code emailed to the parent's email on the
// registration, then each of their players with their team, its staff, and its coming practices and published games.
// Checked on the server (lib/find-player.ts); the answer to the cell is the same whether or not it's registered.
export default function FindMyPlayer({ today }: { today: string }) {
  const [cell, setCell] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [players, setPlayers] = useState<FoundPlayer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const send = () =>
    start(async () => {
      setError(null);
      const s = await sendFindCode(cell);
      if (s.step === "error") return setError(s.message);
      if (s.step === "code") {
        setSent(s.message);
        setCode("");
      }
    });
  const show = () =>
    start(async () => {
      setError(null);
      const s = await showMyPlayers(cell, code);
      if (s.step === "error") return setError(s.message);
      if (s.step === "found") setPlayers(s.players);
    });
  const again = () => {
    setSent(null);
    setPlayers(null);
    setCode("");
    setError(null);
  };

  if (players)
    return (
      <div className="space-y-3">
        {!players.length && <p className="text-sm text-zinc-500">No current registrations with that cell.</p>}
        {players.map((p) => (
          <div key={p.id} className="space-y-2 rounded-xl p-3 ring-1 ring-zinc-950/10 dark:ring-white/10">
            <div>
              <p className="font-semibold">{p.name}</p>
              <p className="text-xs text-zinc-500">
                {p.grade} · {p.org}
                {p.program ? ` · ${p.program}` : ""}
              </p>
            </div>
            {p.team ? (
              <>
                <p className="text-sm">
                  Team: <span className="font-semibold">{p.team.name}</span>
                </p>
                {p.team.staff.length > 0 && (
                  <ul className="space-y-0.5 text-sm">
                    {p.team.staff.map((s) => (
                      <li key={`${s.role}-${s.name}`} className="flex flex-wrap gap-x-2">
                        <span className="text-zinc-500">{s.role}</span>
                        <span>{s.name}</span>
                        <PhoneLink cell={s.cell} label={formatCell(s.cell)} />
                      </li>
                    ))}
                  </ul>
                )}
                {p.team.soon.length > 0 && (
                  <p className="text-sm font-medium text-amber-700 dark:text-amber-300">{p.team.soon.join(" and ")} Schedule will be published soon.</p>
                )}
                <ScheduleList
                  games={p.team.games}
                  practices={p.team.practices}
                  own={p.team.own}
                  today={today}
                  empty="No practices booked or games published yet."
                />
              </>
            ) : (
              <p className="text-sm text-zinc-500">Not on a team yet. Check back once teams are made.</p>
            )}
          </div>
        ))}
        <button type="button" onClick={again} className="text-sm font-medium text-thunder-blue dark:text-blue-400">
          Look up another number
        </button>
      </div>
    );

  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-600 dark:text-zinc-300">
        Enter the cell on your player&apos;s registration. We&apos;ll email a code to the parent email on it.
      </p>
      <label className="block text-sm font-medium">
        Your cell
        <input
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={cell}
          disabled={!!sent}
          onChange={(e) => setCell(e.target.value)}
          className={`${inputCls} mt-1`}
          placeholder="(423) 555-0123"
        />
      </label>
      {sent ? (
        <>
          <p className="text-sm text-emerald-700 dark:text-emerald-400">{sent}</p>
          <label className="block text-sm font-medium">
            Code
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className={`${inputCls} mt-1`}
            />
          </label>
          <div className="space-y-2">
            <button type="button" disabled={busy || code.length !== 6} onClick={show} className={primaryBtn}>
              {busy ? "Checking…" : "Show my player's team"}
            </button>
            <div className="flex justify-between gap-3">
              <button type="button" disabled={busy} onClick={send} className="text-sm font-medium text-thunder-blue dark:text-blue-400">
                Send a new code
              </button>
              <button type="button" disabled={busy} onClick={again} className="text-sm font-medium text-zinc-500">
                Different number
              </button>
            </div>
          </div>
        </>
      ) : (
        <button type="button" disabled={busy || !cell.trim()} onClick={send} className={primaryBtn}>
          {busy ? "Sending…" : "Email me a code"}
        </button>
      )}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

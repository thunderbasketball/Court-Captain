"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FbListTeam } from "@/lib/fastbreak/register";
import { loadFastbreakList, registerFromFastbreak } from "../../actions";
import { Toast } from "../../../../client-ui";

const short = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
const grade = (g: number) => (g === 0 ? "K" : `${g}${g === 1 ? "st" : g === 2 ? "nd" : g === 3 ? "rd" : "th"}`);

// The FastBreak pill on Scenic City's Teams (Directors of Teams): FastBreak's teams in the current League, one list, the
// ones not in Scenic City first. Each new team shows its Scenic City name (the Team Name filled in from FastBreak,
// editable), COMP or REC, and its weeks as chips (tap one: 1GG ⇄ 2GG). Register adds it to the FastBreak club (or links the team
// its coach already has here) and registers those weeks, and the Brackets when it's in FastBreak's Championship.
export default function FastbreakList() {
  const [teams, setTeams] = useState<FbListTeam[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  useEffect(() => {
    start(async () => {
      const r = await loadFastbreakList();
      if (r.ok) setTeams(r.teams);
      else setError(r.message);
    });
  }, []);
  if (error) return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  if (!teams) return <p className="text-sm text-zinc-500">Reading FastBreak…</p>;
  const out = teams.filter((t) => !t.here).length;
  const waiting = teams.filter((t) => t.here && !t.here.registered).length;
  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-600 dark:text-zinc-300">
        <strong>{teams.length}</strong> team{teams.length === 1 ? "" : "s"} in FastBreak ·{" "}
        <strong className={out ? "text-red-600 dark:text-red-400" : ""}>{out} not in Scenic City</strong>
        {waiting > 0 && (
          <>
            {" "}
            · <strong className="text-amber-700 dark:text-amber-300">{waiting} not registered yet</strong>
          </>
        )}
        . Register adds it to the FastBreak club with the name shown (its Head Coach coaches it), for its weeks: tap a week to switch 1GG ⇄ 2GG.
        REC here isn&apos;t limited by &quot;REC open to&quot;.
      </p>
      {teams.length > 0 ? (
        <ul className="divide-y divide-zinc-100 rounded-xl ring-1 ring-zinc-950/10 dark:divide-white/5 dark:ring-white/10">
          {teams.map((t) => (
            <Row key={t.fbId} team={t} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-zinc-500">No teams in FastBreak&apos;s current events.</p>
      )}
      <Link href="/org/scenic-city/teams/fastbreak" className="block text-sm text-thunder-blue hover:underline dark:text-blue-400">
        FastBreak sync settings →
      </Link>
    </div>
  );
}

function Row({ team }: { team: FbListTeam }) {
  const router = useRouter();
  const [here, setHere] = useState(team.here);
  const [part, setPart] = useState(team.part);
  const [level, setLevel] = useState<"COMP" | "REC">(team.here?.level === "REC" ? "REC" : "COMP"); // COMP for a new team
  const pickLevel = !team.here || !team.here.registered; // new, or not registered yet: its level can still change
  const [two, setTwo] = useState<Set<string>>(new Set()); // weeks picked as 2GG (the rest 1GG)
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const done = here?.how === "linked" && here.registered; // nothing left to do
  const code = `${grade(team.grade).replace(/(st|nd|rd|th)$/, "")}${team.gender === "Boys" ? "B" : team.gender === "Girls" ? "G" : ""}`;
  const pill = (on: boolean) =>
    `rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${on ? "bg-thunder-blue text-white ring-thunder-blue" : "text-zinc-600 ring-zinc-950/15 dark:text-zinc-300 dark:ring-white/20"}`;
  const flip = (d: string) =>
    setTwo((s) => {
      const n = new Set(s);
      if (n.has(d)) n.delete(d);
      else n.add(d);
      return n;
    });
  return (
    <li className="flex items-start justify-between gap-3 px-3 py-2.5 text-sm">
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-semibold">
          {team.name} <span className="text-xs font-normal text-zinc-500">in FastBreak</span>
        </p>
        <p className="text-xs text-zinc-500">
          {grade(team.grade)} {team.gender}
          {team.coach && ` · Coach ${team.coach}`}
        </p>
        {!here && (
          <>
            {/* Its Scenic City name: grade and gender, the Team Name (filled in from FastBreak, editable), the coach's last name. */}
            <label className="flex flex-wrap items-center gap-1.5 text-sm">
              <span className="text-xs text-zinc-500">Scenic City name:</span>
              <span className="font-semibold">{code}</span>
              <input
                value={part}
                maxLength={30}
                onChange={(e) => setPart(e.target.value)}
                aria-label="Team Name"
                className="w-40 min-w-0 rounded-lg border border-zinc-300 bg-white px-2 py-1 text-sm font-semibold dark:border-white/15 dark:bg-zinc-900"
              />
              <span className="font-semibold">{team.coachLast ?? "TBD"}</span>
            </label>
          </>
        )}
        {pickLevel && !done && (
          <div className="flex items-center gap-1.5" role="group" aria-label="Level">
            <span className="text-xs text-zinc-500">Level:</span>
            {(["COMP", "REC"] as const).map((l) => (
              <button key={l} type="button" aria-pressed={level === l} onClick={() => setLevel(l)} className={pill(level === l)}>
                {l}
              </button>
            ))}
          </div>
        )}
        {/* Its weeks: tap one to switch 1GG ⇄ 2GG (until it's registered). */}
        <div className="flex flex-wrap items-center gap-1.5">
          {team.weeks.map((d) =>
            done ? (
              <span key={d} className="rounded-full px-2 py-0.5 text-xs text-zinc-500 ring-1 ring-zinc-950/10 dark:ring-white/15">
                {short(d)}
              </span>
            ) : (
              <button
                key={d}
                type="button"
                aria-pressed={two.has(d)}
                title="Tap to switch 1GG ⇄ 2GG"
                onClick={() => flip(d)}
                className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${
                  two.has(d)
                    ? "bg-amber-100 text-amber-900 ring-amber-400 dark:bg-amber-500/20 dark:text-amber-200"
                    : "text-zinc-700 ring-zinc-950/15 dark:text-zinc-200 dark:ring-white/20"
                }`}
              >
                {short(d)} · {two.has(d) ? "2GG" : "1GG"}
              </button>
            ),
          )}
          {!team.weeks.length && <span className="text-xs text-zinc-500">No weeks</span>}
          {team.brackets && <span className="text-xs font-medium text-violet-700 dark:text-violet-300">Championship → Brackets</span>}
        </div>
        {here ? (
          <p className={`text-xs font-medium ${here.registered ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-300"}`}>
            ✓ In Scenic City: {here.name}
            {here.how === "coach" && " (same coach)"}
            {!here.registered && " · not registered yet"}
          </p>
        ) : (
          <p className="text-xs font-medium text-red-600 dark:text-red-400">Not in Scenic City</p>
        )}
      </div>
      {!done && (
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            start(async () => {
              const r = await registerFromFastbreak(team.fbId, { part: here ? undefined : part, level: pickLevel ? level : undefined, twoGames: [...two] });
              if (!r.ok) return setMsg(r.message);
              setHere({ id: "", name: r.name, level, how: "linked", registered: true });
              setMsg(`${r.how === "added" ? "Added" : "Linked"} ${r.name} and registered its weeks${team.brackets ? " and the Brackets" : ""}.`);
              router.refresh();
            })
          }
          className="shrink-0 rounded-full bg-thunder-blue px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Registering…" : here ? (here.registered ? "Link" : "Link + register") : "Register"}
        </button>
      )}
      {msg && <Toast key={msg} message={msg} />}
    </li>
  );
}

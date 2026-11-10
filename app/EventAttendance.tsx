"use client";

import { useState, useTransition, type ReactNode } from "react";
import type { EventPlayer, Mark, Rsvp } from "@/lib/event-attendance";
import { answerEvent, loadEventRoster, markEventPlayer } from "./team-events/actions";

const roundBtn = (on: boolean, tone: "green" | "red", size = "size-9 text-lg") =>
  `flex ${size} shrink-0 items-center justify-center rounded-full font-bold ring-1 disabled:opacity-40 ${
    tone === "green"
      ? on
        ? "bg-emerald-600 text-white ring-emerald-600"
        : "text-emerald-600 ring-emerald-300 hover:bg-emerald-50 dark:ring-emerald-500/40 dark:hover:bg-emerald-500/10"
      : on
        ? "bg-red-600 text-white ring-red-600"
        : "text-red-600 ring-red-300 hover:bg-red-50 dark:ring-red-500/40 dark:hover:bg-red-500/10"
  }`;

export type MyPlayer = { player: string; firstName: string; rsvp: Rsvp | null };

// A parent's ✓ coming / ✗ not coming for each of their players on one event, right on the line (no need to open it).
// Tap the lit one again to clear. Closed once the event starts.
export function RsvpButtons({
  org,
  teamId,
  kind,
  eventId,
  players,
  open,
}: {
  org: string;
  teamId: string;
  kind: string;
  eventId: string;
  players: MyPlayer[];
  open: boolean;
}) {
  const [list, setList] = useState(players);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const answer = (p: MyPlayer, want: Rsvp) => {
    const rsvp = p.rsvp === want ? null : want;
    const before = list;
    setList((l) => l.map((x) => (x.player === p.player ? { ...x, rsvp } : x)));
    start(async () => {
      setError(null);
      const r = await answerEvent(org, teamId, kind, eventId, p.player, rsvp);
      if (!r.ok) {
        setList(before);
        setError(r.message);
      }
    });
  };
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pb-1.5 pl-[4.25rem]">
      {list.map((p) => (
        <span key={p.player} className="flex items-center gap-1.5">
          <span className="text-xs font-semibold">{p.firstName}</span>
          <button
            type="button"
            disabled={!open}
            aria-label={`${p.firstName} is coming`}
            aria-pressed={p.rsvp === "yes"}
            onClick={() => answer(p, "yes")}
            className={roundBtn(p.rsvp === "yes", "green", "size-7 text-sm")}
          >
            ✓
          </button>
          <button
            type="button"
            disabled={!open}
            aria-label={`${p.firstName} is not coming`}
            aria-pressed={p.rsvp === "no"}
            onClick={() => answer(p, "no")}
            className={roundBtn(p.rsvp === "no", "red", "size-7 text-sm")}
          >
            ✗
          </button>
        </span>
      ))}
      {!open && <span className="text-xs text-zinc-400">Answers closed at the start</span>}
      {error && <span className="basis-full text-xs text-red-600">{error}</span>}
    </div>
  );
}

// One event in Next 7 days. The team's staff tap it to open its roster right here: a green ✓ (here) or red ✗ (absent)
// by each player (tap the lit one again to clear), open from 15 minutes before the start until 24 hours after; each
// parent's answer shows by the name. A staff member who is also a parent answers for their own player on the line.
export function EventLine({
  org,
  teamId,
  kind,
  eventId,
  date,
  dim,
  staff,
  mine,
  rsvpOpen,
  children,
}: {
  org: string;
  teamId: string;
  kind: string;
  eventId: string;
  date: string;
  dim: boolean;
  staff: boolean;
  mine: MyPlayer[];
  rsvpOpen: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [players, setPlayers] = useState<EventPlayer[] | null>(null);
  const [closed, setClosed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoad] = useTransition();
  const [, startMark] = useTransition();

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next)
      startLoad(async () => {
        setError(null);
        const r = await loadEventRoster(org, teamId, kind, eventId);
        if (r.ok) {
          setPlayers(r.players);
          setClosed(r.closed);
        } else setError(r.message);
      });
  };

  const mark = (p: EventPlayer, want: Mark) => {
    const status: Mark = p.status === want ? "unknown" : want;
    const before = players;
    setPlayers((list) => list?.map((x) => (x.player === p.player ? { ...x, status } : x)) ?? null);
    startMark(async () => {
      setError(null);
      const r = await markEventPlayer(org, teamId, kind, eventId, p.player, status);
      if (!r.ok) {
        setPlayers(before);
        setError(r.message);
      }
    });
  };

  const here = players?.filter((p) => p.status === "here").length ?? 0;
  const absent = players?.filter((p) => p.status === "absent").length ?? 0;
  const line = (
    <>
      <span className="w-14 shrink-0 text-zinc-500">{date}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </>
  );
  return (
    <li className={dim ? "opacity-50" : ""}>
      {staff ? (
        <button type="button" aria-expanded={open} onClick={toggle} className="flex w-full gap-3 py-1.5 text-left">
          {line}
          <span className={`shrink-0 self-center text-zinc-400 transition ${open ? "rotate-90" : ""}`}>›</span>
        </button>
      ) : (
        <div className="flex gap-3 py-1.5">{line}</div>
      )}
      {mine.length > 0 && <RsvpButtons org={org} teamId={teamId} kind={kind} eventId={eventId} players={mine} open={rsvpOpen} />}
      {open && (
        <div className="mb-2 rounded-xl bg-white p-2 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-white/10">
          {loading && !players && <p className="p-2 text-sm text-zinc-500">Loading…</p>}
          {error && <p className="p-2 text-sm text-red-600">{error}</p>}
          {players && !players.length && <p className="p-2 text-sm text-zinc-500">No players on the roster yet.</p>}
          {players && players.length > 0 && (
            <>
              <p className="px-2 pb-1 text-xs text-zinc-500">
                ✓ {here} here · ✗ {absent} absent · {players.length - here - absent} not marked
                {players.some((p) => p.rsvp) &&
                  ` · Parents: ${players.filter((p) => p.rsvp === "yes").length} coming, ${players.filter((p) => p.rsvp === "no").length} not`}
              </p>
              {closed && <p className="px-2 pb-1 text-xs font-medium text-amber-700 dark:text-amber-400">{closed}</p>}
              <ul className="divide-y divide-zinc-100 dark:divide-white/5">
                {players.map((p) => (
                  <li key={p.player} className="flex items-center gap-2 px-2 py-1.5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {p.firstName} <span className="font-semibold">{p.lastName}</span>
                      </span>
                      {p.rsvp && (
                        <span className={`text-xs ${p.rsvp === "yes" ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                          Parent: {p.rsvp === "yes" ? "✓ coming" : "✗ not coming"}
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      disabled={!!closed}
                      aria-label={`${p.firstName} ${p.lastName} here`}
                      aria-pressed={p.status === "here"}
                      onClick={() => mark(p, "here")}
                      className={roundBtn(p.status === "here", "green")}
                    >
                      ✓
                    </button>
                    <button
                      type="button"
                      disabled={!!closed}
                      aria-label={`${p.firstName} ${p.lastName} absent`}
                      aria-pressed={p.status === "absent"}
                      onClick={() => mark(p, "absent")}
                      className={roundBtn(p.status === "absent", "red")}
                    >
                      ✗
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </li>
  );
}

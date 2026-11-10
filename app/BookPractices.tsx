"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { GymChoice } from "@/lib/practice/schedule";
import { bookSlot } from "./org/thunder/practice/actions";
import { OwnPracticeAdd } from "./OwnPractices";
import { Alert } from "./client-ui";
import { BookIcon } from "./CardIcons";

const EVENT = "book-practices";

// "Book practices" on the Practices card's title line, as a calendar icon: opens the card and its choices right there
// (no pop-up).
export function BookPracticesButton({ teamId, label = "Book practices" }: { teamId: string; label?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        const d = e.currentTarget.closest(".relative")?.querySelector("details");
        if (d) d.open = true;
        window.dispatchEvent(new CustomEvent(EVENT, { detail: teamId }));
      }}
      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-thunder-blue text-white shadow-sm hover:bg-thunder-blue-dark"
    >
      <BookIcon />
    </button>
  );
}

const optionCls = (on: boolean) =>
  `flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left text-sm ring-1 ${
    on ? "bg-blue-50 ring-thunder-blue/40 dark:bg-blue-500/10" : "ring-zinc-200 hover:bg-zinc-50 dark:ring-white/10 dark:hover:bg-white/5"
  }`;

// The choices under Book practices: each of the team's practice gyms with its open times this week and next (tap one to
// see them and book), and Own gym (a place the team found itself). Each opens right here.
export function BookPracticesPanel({
  org,
  teamId,
  choices,
  own,
  scheduleHref,
}: {
  org: string;
  teamId: string;
  choices: { status: string; canBookRole: boolean; gyms: GymChoice[] } | null;
  own: { locations: string[]; today: string } | null; // null: can't add own-gym practices
  scheduleHref: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState<string | null>(null);
  useEffect(() => {
    const on = (e: Event) => {
      if ((e as CustomEvent).detail === teamId) setOpen((o) => !o);
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, [teamId]);
  if (!open) return null;
  const toggle = (k: string) => setPick((p) => (p === k ? null : k));
  return (
    <div className="space-y-2 border-t border-zinc-100 bg-zinc-50/60 px-4 py-3 dark:border-white/5 dark:bg-white/[0.02]">
      {choices && <p className="text-sm text-amber-700 dark:text-amber-400">{choices.status}</p>}
      {choices?.gyms.map((g) => (
        <div key={g.gym}>
          <button type="button" aria-expanded={pick === g.gym} onClick={() => toggle(g.gym)} className={optionCls(pick === g.gym)}>
            <span className="font-semibold">🏀 {g.gym}</span>
            <span className="text-xs text-zinc-500">
              {g.open} open this week and next{g.bookable < g.open ? ` · ${g.bookable} you can book now` : ""}
            </span>
          </button>
          {pick === g.gym && <GymTimes teamId={teamId} gym={g} />}
        </div>
      ))}
      {choices && !choices.gyms.length && <p className="text-sm text-zinc-500">No open times at the team&apos;s gyms this week or next.</p>}
      {own && (
        <div>
          <button type="button" aria-expanded={pick === "own"} onClick={() => toggle("own")} className={optionCls(pick === "own")}>
            <span className="font-semibold">📍 Own gym</span>
            <span className="text-xs text-zinc-500">A place your team found: any time, no limits</span>
          </button>
          {pick === "own" && (
            <div className="pt-3">
              <OwnPracticeAdd org={org} teamId={teamId} locations={own.locations} today={own.today} bare />
            </div>
          )}
        </div>
      )}
      {scheduleHref && (
        <Link href={scheduleHref} className="block pt-1 text-sm font-semibold text-thunder-blue hover:underline dark:text-blue-400">
          Full schedule →
        </Link>
      )}
    </div>
  );
}

// A gym's open times, by day: each court that's open, with Book (or why it can't be booked). Booking asks "every week"
// right here, then books with the same limits as the schedule.
function GymTimes({ teamId, gym }: { teamId: string; gym: GymChoice }) {
  const router = useRouter();
  const [slot, setSlot] = useState<string | null>(null);
  const [everyWeek, setEveryWeek] = useState(false);
  const [msg, setMsg] = useState<{ tone: "red" | "green"; text: string } | null>(null);
  const [busy, start] = useTransition();
  const book = (id: string) =>
    start(async () => {
      setMsg(null);
      const r = await bookSlot({ slotId: id, teamId, everyWeek, asTeam: true });
      if (!r.ok) return setMsg({ tone: "red", text: r.message });
      const n = r.booked.length;
      setMsg({
        tone: "green",
        text: `Booked ${n} practice${n === 1 ? "" : "s"}.${r.skipped.length ? ` ${r.skipped.length} later week${r.skipped.length === 1 ? "" : "s"} couldn't be booked.` : ""}`,
      });
      setSlot(null);
      setEveryWeek(false);
      router.refresh();
    });
  return (
    <div className="space-y-2 pt-2">
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {gym.days.map((d) => (
        <div key={d.iso}>
          <p className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">{d.label}</p>
          {d.times.map((t) => (
            <div key={t.label} className="flex flex-wrap items-center gap-2 py-1">
              <span className="w-16 shrink-0 text-sm font-semibold">{t.label}</span>
              {t.slots.map((s) =>
                s.team ? (
                  <span
                    key={s.id}
                    className={`rounded-full px-3 py-1 text-xs ${
                      s.mine
                        ? "bg-thunder-blue font-semibold text-white"
                        : "bg-zinc-100 text-zinc-600 dark:bg-white/10 dark:text-zinc-300"
                    }`}
                  >
                    {s.court} · {s.mine ? "Your team" : s.team}
                  </span>
                ) : s.canBook ? (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSlot((x) => (x === s.id ? null : s.id))}
                    className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ${
                      slot === s.id ? "bg-thunder-blue text-white ring-thunder-blue" : "text-thunder-blue ring-thunder-blue/30 hover:bg-blue-50 dark:text-blue-400"
                    }`}
                  >
                    {s.court}
                  </button>
                ) : (
                  <span key={s.id} className="rounded-full px-3 py-1 text-xs text-zinc-400 ring-1 ring-zinc-200 dark:ring-white/10">
                    {s.court}
                  </span>
                ),
              )}
              {t.slots.some((s) => s.id === slot) && (
                <span className="order-last flex basis-full flex-wrap items-center gap-3 pt-1">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" className="size-4" checked={everyWeek} onChange={(e) => setEveryWeek(e.target.checked)} />
                    Every week at this time
                  </label>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => book(slot!)}
                    className="rounded-full bg-thunder-blue px-4 py-1.5 text-sm font-semibold text-white hover:bg-thunder-blue-dark"
                  >
                    {busy ? "Booking…" : "Book"}
                  </button>
                </span>
              )}
            </div>
          ))}
        </div>
      ))}
      {[...new Set(gym.days.flatMap((d) => d.times.flatMap((t) => t.slots.flatMap((s) => (!s.team && !s.canBook && s.reason ? [s.reason] : [])))))].map(
        (why) => (
          <p key={why} className="text-xs text-zinc-500">
            Grey courts: {why}
          </p>
        ),
      )}
    </div>
  );
}

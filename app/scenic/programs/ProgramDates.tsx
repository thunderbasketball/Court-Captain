"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveProgramDates } from "../actions";
import { Alert, Toast } from "../../client-ui";
import { pillCls } from "../../ui";
import MonthCalendar, { monthOf, type DayLook } from "../MonthCalendar";

const navyBtn =
  "w-full rounded-full bg-scenic-navy px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-scenic-navy";

// A program's dates on a calendar, within its season: Game Days (regular season) and Bracket Days (post-season, purple).
// Directors of Programs (`editable`) pick Game Day or Bracket Day, tap dates to add them (or switch an existing date to
// that kind), tap a date of that kind again to remove it, then Submit; each one also becomes a Scenic City game day.
export default function ProgramDates({
  programId,
  today,
  starts,
  ends,
  dates,
  brackets,
  editable,
}: {
  programId: string;
  today: string;
  starts: string;
  ends: string;
  dates: string[];
  brackets: string[];
  editable: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"game" | "bracket">("game");
  const [add, setAdd] = useState<string[]>([]);
  const [addB, setAddB] = useState<string[]>([]);
  const [remove, setRemove] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const isGame = new Set(dates);
  const isBracket = new Set(brackets);
  const changeable = (d: string) => editable && d >= starts && d <= ends && d >= today;

  const look = (date: string): DayLook => {
    if (remove.includes(date)) return { tappable: true, tone: "remove", note: "Remove" };
    if (add.includes(date)) return { tappable: true, tone: "selected", note: "Game" };
    if (addB.includes(date)) return { tappable: true, tone: "selected", note: "Bracket" };
    if (isGame.has(date)) return { tappable: changeable(date), tone: "game", note: "Game" };
    if (isBracket.has(date)) return { tappable: changeable(date), tone: "bracket", note: "Bracket" };
    return { tappable: changeable(date), tone: "plain" };
  };
  const toggle = (list: string[], d: string) => (list.includes(d) ? list.filter((x) => x !== d) : [...list, d]);
  const tap = (d: string) => {
    if (!changeable(d)) return;
    if (remove.includes(d)) return setRemove(toggle(remove, d));
    if (add.includes(d)) return setAdd(toggle(add, d));
    if (addB.includes(d)) return setAddB(toggle(addB, d));
    const kind = isGame.has(d) ? "game" : isBracket.has(d) ? "bracket" : null;
    // The same kind again: remove it. Otherwise add it as (or switch it to) the kind picked.
    if (kind === mode) setRemove(toggle(remove, d));
    else if (mode === "game") setAdd(toggle(add, d));
    else setAddB(toggle(addB, d));
  };
  const submit = () =>
    start(async () => {
      setError(null);
      const r = await saveProgramDates(programId, { add, addBrackets: addB, remove });
      if (!r.ok) return setError(r.message);
      setAdd([]);
      setAddB([]);
      setRemove([]);
      const kept = r.kept ? ` (${r.kept} kept on Game days: another program plays then or partners gave court hours)` : "";
      setDone(
        ([r.added && `${r.added} added`, r.removed && `${r.removed} removed`].filter(Boolean).join(", ") || "Saved.") + kept,
      );
      router.refresh();
    });

  const first = monthOf(today > starts ? (today > ends ? ends : today) : starts);
  const adding = add.length + addB.length;
  const changes = adding + remove.length;
  return (
    <div className="space-y-3">
      {editable && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={pillCls(mode === "game")} onClick={() => setMode("game")}>
            Game Day
          </button>
          <button type="button" className={pillCls(mode === "bracket")} onClick={() => setMode("bracket")}>
            Bracket Day
          </button>
        </div>
      )}
      <MonthCalendar today={today} firstMonth={first} lastMonth={monthOf(ends)} look={look} onTap={tap} />
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
        <span>
          <span className="mr-1 inline-block size-2.5 rounded-sm bg-white ring-2 ring-scenic-navy/60" />
          Game Day
        </span>
        <span>
          <span className="mr-1 inline-block size-2.5 rounded-sm bg-violet-50 ring-2 ring-violet-600/60" />
          Bracket Day
        </span>
      </p>
      {editable && (
        <>
          <p className="text-xs text-zinc-500">
            Pick Game Day or Bracket Day, then tap dates in the season to add them; tap a date of that kind again to remove it.
            Every date also shows on Scenic City&apos;s Game days.
          </p>
          {error && <Alert tone="red">{error}</Alert>}
          <button type="button" className={navyBtn} disabled={busy || !changes} onClick={submit}>
            {busy
              ? "Saving…"
              : changes
                ? `Submit (${[adding && `+${adding}`, remove.length && `−${remove.length}`].filter(Boolean).join(", ")})`
                : "Tap dates to add or remove"}
          </button>
        </>
      )}
      {done && <Toast key={done} message={done} />}
    </div>
  );
}

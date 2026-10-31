"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveProgramDates } from "../actions";
import { Alert, Toast } from "../../client-ui";
import MonthCalendar, { monthOf, type DayLook } from "../MonthCalendar";

const navyBtn =
  "w-full rounded-full bg-scenic-navy px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-scenic-navy";

// A program's game dates on a calendar, within its season. Directors of Programs (`editable`) tap dates to add or remove
// them, then Submit; each one also becomes a Scenic City game day.
export default function ProgramDates({
  programId,
  today,
  starts,
  ends,
  dates,
  editable,
}: {
  programId: string;
  today: string;
  starts: string;
  ends: string;
  dates: string[];
  editable: boolean;
}) {
  const router = useRouter();
  const [add, setAdd] = useState<string[]>([]);
  const [remove, setRemove] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const isGame = new Set(dates);
  const changeable = (d: string) => editable && d >= starts && d <= ends && d >= today;

  const look = (date: string): DayLook => {
    if (remove.includes(date)) return { tappable: true, tone: "remove", note: "Remove" };
    if (add.includes(date)) return { tappable: true, tone: "selected", note: "Add" };
    if (isGame.has(date)) return { tappable: changeable(date), tone: "game", note: "Game" };
    return { tappable: changeable(date), tone: "plain" };
  };
  const toggle = (list: string[], d: string) => (list.includes(d) ? list.filter((x) => x !== d) : [...list, d]);
  const tap = (d: string) => {
    if (!changeable(d)) return;
    if (isGame.has(d)) setRemove(toggle(remove, d));
    else setAdd(toggle(add, d));
  };
  const submit = () =>
    start(async () => {
      setError(null);
      const r = await saveProgramDates(programId, { add, remove });
      if (!r.ok) return setError(r.message);
      setAdd([]);
      setRemove([]);
      const kept = r.kept ? ` (${r.kept} kept on Game days: another program plays then or partners gave court hours)` : "";
      setDone(
        ([r.added && `${r.added} added`, r.removed && `${r.removed} removed`].filter(Boolean).join(", ") || "No changes.") + kept,
      );
      router.refresh();
    });

  const first = monthOf(today > starts ? (today > ends ? ends : today) : starts);
  const changes = add.length + remove.length;
  return (
    <div className="space-y-3">
      <MonthCalendar today={today} firstMonth={first} lastMonth={monthOf(ends)} look={look} onTap={tap} />
      {editable && (
        <>
          <p className="text-xs text-zinc-500">
            Tap dates in the season to add or remove them. Game dates also show on Scenic City&apos;s Game days.
          </p>
          {error && <Alert tone="red">{error}</Alert>}
          <button type="button" className={navyBtn} disabled={busy || !changes} onClick={submit}>
            {busy
              ? "Saving…"
              : changes
                ? `Submit (${[add.length && `+${add.length}`, remove.length && `−${remove.length}`].filter(Boolean).join(", ")})`
                : "Tap dates to add or remove"}
          </button>
        </>
      )}
      {done && <Toast key={done} message={done} />}
    </div>
  );
}

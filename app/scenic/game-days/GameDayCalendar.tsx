"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveGameDays } from "../actions";
import { Alert, Toast, useConfirm } from "../../client-ui";
import { primaryBtn } from "../../ui";
import MonthCalendar, { addMonths, monthOf, type DayLook } from "../MonthCalendar";

// Game days on a calendar. Directors (`editable`) tap future dates to add them or tap game days to remove them, then Submit.
// `openCourts`: for Directors, how many partner courts are open each game day.
export default function GameDayCalendar({
  today,
  days,
  openCourts,
  editable,
}: {
  today: string;
  days: string[];
  openCourts: Record<string, number>;
  editable: boolean;
}) {
  const router = useRouter();
  const [add, setAdd] = useState<string[]>([]);
  const [remove, setRemove] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [confirm, confirmDialog] = useConfirm();
  const isGame = new Set(days);

  const look = (date: string): DayLook => {
    const n = openCourts[date];
    const courts = n ? `${n} ${n === 1 ? "court" : "courts"}` : undefined;
    if (remove.includes(date)) return { tappable: true, tone: "remove", note: "Remove" };
    if (add.includes(date)) return { tappable: true, tone: "selected", note: "Add" };
    if (isGame.has(date)) return { tappable: editable, tone: n ? "open" : "game", note: courts ?? "Game day" };
    return { tappable: editable && date >= today, tone: "plain" };
  };
  const toggle = (list: string[], date: string) => (list.includes(date) ? list.filter((d) => d !== date) : [...list, date]);
  const tap = (date: string) => {
    if (!editable) return;
    if (isGame.has(date)) setRemove(toggle(remove, date));
    else if (date >= today) setAdd(toggle(add, date));
  };

  const submit = () =>
    start(async () => {
      setError(null);
      const withHours = remove.filter((d) => openCourts[d]);
      if (
        withHours.length &&
        !(await confirm({
          title: "Remove game days with court hours?",
          message: `${withHours.length} of the days you're removing already have partner court hours. Those hours are removed too.`,
          confirmLabel: "Remove them",
        }))
      )
        return;
      const r = await saveGameDays({ add, remove });
      if (!r.ok) return setError(r.message);
      setAdd([]);
      setRemove([]);
      setDone([r.added && `${r.added} added`, r.removed && `${r.removed} removed`].filter(Boolean).join(", ") || "No changes.");
      router.refresh();
    });

  const first = monthOf(today);
  const last = editable ? addMonths(first, 12) : days.length ? (monthOf(days.at(-1)!) > first ? monthOf(days.at(-1)!) : first) : first;
  const changes = add.length + remove.length;

  return (
    <div className="space-y-4">
      <MonthCalendar today={today} firstMonth={first} lastMonth={last} look={look} onTap={tap} />
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
        <span>
          <span className="mr-1 inline-block size-2.5 rounded-sm ring-2 ring-scenic-navy/60" />
          Game day
        </span>
        <span>
          <span className="mr-1 inline-block size-2.5 rounded-sm bg-emerald-100 ring-2 ring-emerald-600/50" />
          Courts open
        </span>
        {editable && (
          <>
            <span>
              <span className="mr-1 inline-block size-2.5 rounded-sm bg-scenic-navy" />
              Adding
            </span>
            <span>
              <span className="mr-1 inline-block size-2.5 rounded-sm bg-red-100 ring-2 ring-red-500/60" />
              Removing
            </span>
          </>
        )}
      </p>
      {editable && (
        <>
          {error && <Alert tone="red">{error}</Alert>}
          <button type="button" className={primaryBtn} disabled={busy || !changes} onClick={submit}>
            {busy
              ? "Saving…"
              : changes
                ? `Submit (${[add.length && `+${add.length}`, remove.length && `−${remove.length}`].filter(Boolean).join(", ")})`
                : "Tap dates to add or remove"}
          </button>
        </>
      )}
      {done && <Toast key={done} message={done} />}
      {confirmDialog}
    </div>
  );
}

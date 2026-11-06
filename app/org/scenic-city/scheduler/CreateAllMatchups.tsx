"use client";

// Scheduler Matchups: one button to create every division's matchups for the Game Day, in the program being scheduled.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createDayMatchups } from "../actions";
import { Alert, useConfirm } from "../../../client-ui";

export function CreateAllMatchups({
  day,
  programId,
  label,
  created,
}: {
  day: string;
  programId: string;
  label: string;
  created: boolean;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [note, setNote] = useState<{ tone: "green" | "red"; lines: string[] } | null>(null);
  const [confirm, dialog] = useConfirm();

  const run = async () => {
    if (
      !(await confirm({
        title: `Create all of ${label}'s matchups?`,
        message: created
          ? "The app pairs every division's teams again, replacing all of this day's matchups. Games that stay the same keep their grid slots."
          : "The app pairs every division's teams playing this day.",
        confirmLabel: created ? "Create all again" : "Create all",
      }))
    )
      return;
    start(async () => {
      setNote(null);
      const r = await createDayMatchups(day, programId);
      if (!r.ok) return setNote({ tone: "red", lines: [r.message] });
      setNote({
        tone: "green",
        lines: [
          `${r.created} matchup${r.created === 1 ? "" : "s"} created in ${r.divisions} division${r.divisions === 1 ? "" : "s"}.`,
          ...r.notes,
        ],
      });
      router.refresh();
    });
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={busy}
        onClick={run}
        className="w-full rounded-lg bg-scenic-navy px-3 py-2.5 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-50"
      >
        {busy
          ? "Creating every division's matchups…"
          : `${created ? "Create all matchups again" : "Create all matchups"} · ${label}`}
      </button>
      {note && (
        <Alert tone={note.tone}>
          {note.lines.map((l) => (
            <span key={l} className="block">
              {l}
            </span>
          ))}
        </Alert>
      )}
      {dialog}
    </div>
  );
}

"use client";

// Scheduler Matchups: Create REC matchups and Create COMP matchups for the Game Day, each for every division at once, in the
// program being scheduled. The other level's games stay as they are; a published level is locked.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createDayMatchups } from "../actions";
import { Alert, useConfirm } from "../../../client-ui";

export type LevelState = { level: "REC" | "COMP"; created: boolean; published: boolean };

export function CreateAllMatchups({ day, programId, label, levels }: { day: string; programId: string; label: string; levels: LevelState[] }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [doing, setDoing] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "green" | "red"; lines: string[] } | null>(null);
  const [confirm, dialog] = useConfirm();

  const run = async ({ level, created }: LevelState) => {
    if (
      !(await confirm({
        title: `Create ${label}'s ${level} matchups${created ? " again" : ""}?`,
        message: created
          ? `The app pairs every division's ${level} teams again, replacing this day's ${level} matchups. Games that stay the same keep their grid slots.`
          : `The app pairs every division's ${level} teams playing this day.`,
        confirmLabel: created ? `Create ${level} again` : `Create ${level}`,
      }))
    )
      return;
    setDoing(level);
    start(async () => {
      setNote(null);
      const r = await createDayMatchups(day, programId, level);
      if (!r.ok) return setNote({ tone: "red", lines: [r.message] });
      setNote({
        tone: "green",
        lines: [
          `${r.created} ${level} matchup${r.created === 1 ? "" : "s"} created in ${r.divisions} division${r.divisions === 1 ? "" : "s"}.`,
          ...r.notes,
        ],
      });
      router.refresh();
    });
  };

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-zinc-500">{label}, every division</p>
      <div className="flex flex-col gap-2">
        {levels.map((l) => (
          <button
            key={l.level}
            type="button"
            disabled={busy || l.published}
            title={l.published ? `${l.level} is published: unpublish it for this day first` : undefined}
            onClick={() => run(l)}
            className="flex-1 rounded-lg bg-scenic-navy px-3 py-2.5 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-50"
          >
            {busy && doing === l.level ? `Creating ${l.level}…` : `${l.published ? "🔒 " : ""}Create ${l.level} matchups${l.created ? " again" : ""}`}
          </button>
        ))}
      </div>
      {note && (
        <Alert tone={note.tone}>
          {note.lines.map((l, i) => (
            <span key={i} className="block">
              {l}
            </span>
          ))}
        </Alert>
      )}
      {dialog}
    </div>
  );
}

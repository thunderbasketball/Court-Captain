"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Toast, useConfirm } from "../../../client-ui";
import { decideScheduleRemoval } from "../actions";

// Approve (TBD in its games, then withdrawn; asks first) or Decline a team's request to come off the schedule.
export function RemovalDecision({ id, team, games }: { id: string; team: string; games: number }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [confirm, dialog] = useConfirm();
  const decide = (approve: boolean) =>
    start(async () => {
      const r = await decideScheduleRemoval(id, approve);
      if (!r.ok) return setMsg(r.message);
      setMsg(approve ? `${team} is off the schedule: TBD in ${r.games} game${r.games === 1 ? "" : "s"}.` : `Declined: ${team} stays on.`);
      router.refresh();
    });
  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          if (
            await confirm({
              title: `Take ${team} off the schedule?`,
              message: `TBD takes its place in its ${games} game${games === 1 ? "" : "s"} (a game it had against TBD goes), and it's withdrawn from this League.`,
              confirmLabel: "Approve",
              tone: "warning",
            })
          )
            decide(true);
        }}
        className="rounded-full bg-thunder-blue px-3.5 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        Approve
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => decide(false)}
        className="rounded-full px-3.5 py-1.5 text-sm font-medium text-zinc-600 ring-1 ring-zinc-950/10 dark:text-zinc-300 dark:ring-white/15"
      >
        Decline
      </button>
      {msg && <Toast key={msg} message={msg} />}
      {dialog}
    </div>
  );
}

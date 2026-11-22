"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { DeleteBlock } from "@/lib/schedule-removal";
import { requestScheduleRemoval } from "./leagues/actions";

const when = (d: Date) =>
  new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });

// Asks the League's Scheduler to take the team off an event's schedule (or says it's been asked).
export function RequestRemovalButton({
  programId,
  teamId,
  requested,
}: {
  programId: string;
  teamId: string; // its copy in the League
  requested: { by: string; at: Date } | null;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (requested || sent)
    return (
      <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
        Removal requested{requested ? ` by ${requested.by} on ${when(requested.at)}` : ""}. The Scheduler will put TBD in its games and withdraw it.
      </p>
    );
  return (
    <div className="space-y-1">
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          start(async () => {
            const r = await requestScheduleRemoval(programId, teamId);
            if (!r.ok) return setErr(r.message);
            setSent(true);
            router.refresh();
          })
        }
        className="rounded-full bg-amber-600 px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
      >
        {busy ? "Sending…" : "Request removal from the schedule"}
      </button>
      {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}
    </div>
  );
}

// Why a scheduled team can't be deleted, and what to do instead (the Delete team pop-up shows this with just Close).
export function DeleteBlockedNote({ block }: { block: Extract<DeleteBlock, { why: "scheduled" }> }) {
  return (
    <span className="flex flex-col items-center gap-3">
      <span>
        It&apos;s on the schedule for <strong>{block.program}</strong>, so it can&apos;t withdraw or be deleted. Ask the League&apos;s
        Scheduler to take it off the schedule; they&apos;ll put TBD in its games and withdraw it. Then you can delete it.
      </span>
      <RequestRemovalButton programId={block.programId} teamId={block.teamId} requested={block.requested} />
    </span>
  );
}

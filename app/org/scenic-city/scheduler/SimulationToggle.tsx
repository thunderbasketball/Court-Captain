"use client";

// Simulation mode (development only): a switch at the top of the Scheduler, for the League picked there. On fills it with
// random (DEV) teams (0–2 per grade per organization); New random set replaces them; Off deletes them all. They're in one
// League at a time: turning it on for another League moves them there.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setSimulation } from "../actions";
import { Alert, useConfirm } from "../../../client-ui";

export function SimulationToggle({
  teams,
  inProgram,
  inProgramName,
  programId,
  programName,
}: {
  teams: number; // (DEV) teams now
  inProgram: string | null; // the League they're in
  inProgramName: string | null;
  programId: string; // the League being scheduled
  programName: string;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirm, confirmDialog] = useConfirm();
  const on = teams > 0 && inProgram === programId;
  const elsewhere = teams > 0 && !on;
  const run = (value: boolean) =>
    start(async () => {
      setError(null);
      const r = await setSimulation(value, programId);
      if (r.ok) router.refresh();
      else setError(r.message);
    });
  const replace = async () =>
    (await confirm({
      title: on ? "Make a new random set?" : `Turn on Simulation mode for ${programName}?`,
      message: on
        ? "Every (DEV) team is deleted, with its matchups and grid slots, and a new random set is made."
        : `Random (DEV) teams (0–2 per grade from each organization, 125 at most) are added to ${programName}, registered ALL Season.${
            elsewhere ? ` The ${teams} (DEV) teams in ${inProgramName ?? "another League"} are deleted first.` : ""
          }`,
      confirmLabel: on ? "New set" : "Turn on",
    })) && run(true);

  return (
    <section className="space-y-2 rounded-2xl border border-dashed border-amber-400 bg-amber-50 px-4 py-3 dark:border-amber-500/50 dark:bg-amber-500/10">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={on}
          disabled={busy}
          onClick={async () => {
            if (!on) return replace();
            if (
              await confirm({
                title: "Turn off Simulation mode?",
                message: `All ${teams} (DEV) teams are deleted, with their matchups and grid slots.`,
                confirmLabel: "Turn off",
              })
            )
              run(false);
          }}
          className={`relative h-7 w-12 shrink-0 rounded-full transition disabled:opacity-50 ${on ? "bg-amber-500" : "bg-zinc-300 dark:bg-zinc-600"}`}
        >
          <span className={`absolute top-1 size-5 rounded-full bg-white shadow transition-all ${on ? "left-6" : "left-1"}`} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
            Simulation mode · {programName} {busy ? "· working…" : on ? `· On · ${teams} (DEV) teams` : "· Off"}
          </p>
          <p className="text-xs text-amber-800/80 dark:text-amber-200/70">
            {elsewhere
              ? `On in ${inProgramName ?? "another League"} (${teams} teams). Turning it on here moves it.`
              : "Development only: random practice teams for scheduling this program."}
          </p>
        </div>
        {on && (
          <button
            type="button"
            disabled={busy}
            onClick={replace}
            className="rounded-full px-3 py-1.5 text-sm font-semibold text-amber-900 ring-1 ring-amber-500/50 disabled:opacity-50 dark:text-amber-200"
          >
            New random set
          </button>
        )}
      </div>
      {error && <Alert tone="red">{error}</Alert>}
      {confirmDialog}
    </section>
  );
}

import type { CoachUse } from "@/lib/coach-use";

// Home: the share of its coaches using the app in the last 7 days, at a glance.
export default function CoachUseTile({ use }: { use: CoachUse }) {
  const tone = use.percent >= 70 ? ["text-emerald-600 dark:text-emerald-400", "bg-emerald-500"] : use.percent >= 40 ? ["text-amber-600 dark:text-amber-400", "bg-amber-500"] : ["text-red-600 dark:text-red-400", "bg-red-500"];
  return (
    <div className="flex items-center gap-3 rounded-xl bg-white px-4 py-2.5 ring-1 ring-zinc-950/10 dark:bg-zinc-900 dark:ring-white/10">
      <span className={`text-2xl font-semibold tabular-nums ${tone[0]}`}>{use.percent}%</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm">
          of coaches used the app in the last 7 days{" "}
          <span className="text-zinc-500 tabular-nums">
            ({use.using} of {use.total})
          </span>
        </p>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-white/10">
          <div className={`h-full rounded-full ${tone[1]}`} style={{ width: `${use.percent}%` }} />
        </div>
      </div>
    </div>
  );
}

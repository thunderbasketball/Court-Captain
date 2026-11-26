import type { CoachUse } from "@/lib/coach-use";

const tone = (percent: number) =>
  percent >= 70
    ? ["text-emerald-600 dark:text-emerald-400", "bg-emerald-500"]
    : percent >= 40
      ? ["text-amber-600 dark:text-amber-400", "bg-amber-500"]
      : ["text-red-600 dark:text-red-400", "bg-red-500"];

function Bar({ percent }: { percent: number }) {
  return (
    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-white/10">
      <div className={`h-full rounded-full ${tone(percent)[1]}`} style={{ width: `${percent}%` }} />
    </div>
  );
}

// Home: the share of its coaches using the app in the last 7 days, at a glance. Tap to open each organization's (a League)
// or each team's, fewest using first.
export default function CoachUseTile({ use }: { use: CoachUse }) {
  return (
    <details className="group rounded-xl bg-white ring-1 ring-zinc-950/10 dark:bg-zinc-900 dark:ring-white/10">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-2.5 [&::-webkit-details-marker]:hidden">
        <span className={`text-2xl font-semibold tabular-nums ${tone(use.percent)[0]}`}>{use.percent}%</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm">
            of coaches used the app in the last 7 days{" "}
            <span className="text-zinc-500 tabular-nums">
              ({use.using} of {use.total})
            </span>
          </p>
          <Bar percent={use.percent} />
        </div>
        <span aria-hidden className="text-zinc-400 transition-transform group-open:rotate-90">
          ›
        </span>
      </summary>
      <div className="border-t border-zinc-950/5 px-4 py-2.5 dark:border-white/10">
        <p className="mb-2 text-xs text-zinc-500">By {use.by}, fewest using first. A coach on several counts in each.</p>
        <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {use.parts.map((p) => (
            <li key={p.name} className="text-sm">
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate font-medium">{p.name}</span>
                <span className="shrink-0 tabular-nums">
                  <span className={`font-semibold ${tone(p.percent)[0]}`}>{p.percent}%</span>{" "}
                  <span className="text-xs text-zinc-500">
                    ({p.using} of {p.total})
                  </span>
                </span>
              </div>
              <Bar percent={p.percent} />
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

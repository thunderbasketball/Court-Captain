"use client";

import { useState } from "react";

// Home metrics bar chart (registrations per day, site visits): one bar per time bucket, oldest first. Hover or tap a bar
// (or tab to it) for its label; "Show as table" lists every bar, newest first.
// label: "Tue, Nov 3: 4 visits". m: a second value drawn as a green bar beside the blue one (e.g. coach visits).
export type Bar = { key: string; n: number; m?: number; label: string };

export default function BarChart({
  bars,
  summary,
  first,
  last,
  ariaLabel,
  legend,
}: {
  bars: Bar[];
  summary: string; // shown when no bar is picked, e.g. "52 in 30 days"
  first: string; // under the first bar
  last: string; // under the last bar
  ariaLabel: string;
  legend?: [string, string]; // names of the blue and green bars, when there are two per bucket
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...bars.map((d) => d.n));
  const shown = hover === null ? null : bars[hover];
  return (
    <div>
      <div className="mb-1 flex h-5 items-baseline justify-between gap-2 text-xs text-zinc-500">
        <span>{shown ? <span className="font-medium text-zinc-900 dark:text-white">{shown.label}</span> : summary}</span>
        <span>Most: {max}</span>
      </div>
      {legend && (
        <div className="mb-1 flex gap-4 text-xs text-zinc-600 dark:text-zinc-300">
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-sm bg-thunder-blue dark:bg-[#4f6dff]" />
            {legend[0]}
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-sm bg-[#059669] dark:bg-[#0f9f73]" />
            {legend[1]}
          </span>
        </div>
      )}
      <div className="relative h-28" onPointerLeave={() => setHover(null)}>
        {/* One recessive line at the top bar's height, then the baseline. */}
        <div className="absolute inset-x-0 top-0 border-t border-dashed border-zinc-200 dark:border-white/10" aria-hidden />
        <div
          role="list"
          aria-label={ariaLabel}
          className="absolute inset-0 flex items-end gap-[2px] border-b border-zinc-300 dark:border-white/20"
        >
          {bars.map((d, i) => (
            <div
              key={d.key}
              role="listitem"
              tabIndex={0}
              aria-label={d.label}
              onPointerEnter={() => setHover(i)}
              onPointerDown={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              className="flex h-full min-w-0 flex-1 cursor-default items-end justify-center gap-px outline-none"
            >
              <div
                className={`w-full max-w-6 rounded-t-[4px] ${
                  hover === i ? "bg-thunder-blue-dark dark:bg-[#7d95ff]" : "bg-thunder-blue dark:bg-[#4f6dff]"
                }`}
                style={{ height: d.n ? `${(d.n / max) * 100}%` : 0 }}
              />
              {d.m !== undefined && (
                <div
                  className={`w-full max-w-6 rounded-t-[4px] ${hover === i ? "bg-[#047857] dark:bg-[#34d399]" : "bg-[#059669] dark:bg-[#0f9f73]"}`}
                  style={{ height: d.m ? `${(d.m / max) * 100}%` : 0 }}
                />
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-zinc-500">
        <span>{first}</span>
        <span>{last}</span>
      </div>
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer text-zinc-500">Show as table</summary>
        <table className="mt-1 w-full">
          <tbody>
            {[...bars].reverse().map((d) => {
              const [what, n] = d.label.split(/: (?=[^:]*$)/);
              return (
                <tr key={d.key} className="border-t border-zinc-100 dark:border-white/5">
                  <td className="py-0.5">{what}</td>
                  <td className="py-0.5 text-right tabular-nums">{n}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </details>
    </div>
  );
}

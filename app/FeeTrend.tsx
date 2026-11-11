"use client";

import { useState } from "react";
import type { FeeDay } from "@/lib/fee-trend";

// Home metrics: Thunder's fees paid and owed to date (two running totals, one point a day from the first payment to
// today). Hover or tap for a day's numbers (a crosshair and both values); "Show as table" lists every day. Paid is a
// solid green line, owed a dashed amber one, each named in the legend and at its line's end (never color alone).
const PAID = "stroke-[#059669] dark:stroke-[#0f9f73]";
const OWED = "stroke-[#d97706] dark:stroke-[#cf7d0a]";
const PAID_DOT = "bg-[#059669] dark:bg-[#0f9f73]";
const OWED_DOT = "bg-[#d97706] dark:bg-[#cf7d0a]";
const OWED_DASH = "border-[#d97706] dark:border-[#cf7d0a]";

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const short = (n: number) => (n >= 1000 ? `$${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : `$${Math.round(n)}`);
const fmt = (day: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", ...opts });
// A round top for the scale: 1, 2 or 5 × a power of ten.
const niceMax = (n: number) => {
  if (n <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(n));
  return ([1, 2, 5, 10].find((m) => m * p >= n) ?? 10) * p;
};

export default function FeeTrend({ days }: { days: FeeDay[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  if (!days.length) return <p className="text-sm text-zinc-500">No payments yet.</p>;
  const W = 300;
  const H = 120;
  const top = niceMax(Math.max(...days.map((d) => Math.max(d.paid, d.owed))));
  const x = (i: number) => (days.length === 1 ? W / 2 : (i / (days.length - 1)) * W);
  const y = (v: number) => H - (v / top) * H;
  const path = (key: "paid" | "owed") => days.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(2)},${y(d[key]).toFixed(2)}`).join("");
  const last = days[days.length - 1];
  const shown = hover === null ? null : days[hover];
  const pct = (i: number) => (x(i) / W) * 100;
  const pick = (clientX: number, box: DOMRect) =>
    setHover(Math.max(0, Math.min(days.length - 1, Math.round(((clientX - box.left) / box.width) * (days.length - 1)))));

  return (
    <div>
      {/* Legend (always), and the picked day's numbers or today's. */}
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-600 dark:text-zinc-300">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className={`h-0.5 w-4 rounded ${PAID_DOT}`} />
          Fees paid <span className="font-semibold text-zinc-900 tabular-nums dark:text-white">{money((shown ?? last).paid)}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className={`w-4 border-t-2 border-dashed ${OWED_DASH}`} />
          Fees owed <span className="font-semibold text-zinc-900 tabular-nums dark:text-white">{money((shown ?? last).owed)}</span>
        </span>
        <span className="ml-auto text-zinc-500">{shown ? fmt(shown.day, { weekday: "short", month: "short", day: "numeric" }) : "To date"}</span>
      </div>

      <div className="flex gap-2">
        {/* The scale: top, middle, zero (recessive). */}
        <div className="flex h-32 w-9 shrink-0 flex-col justify-between text-right text-[10px] text-zinc-400 tabular-nums">
          <span>{short(top)}</span>
          <span>{short(top / 2)}</span>
          <span>$0</span>
        </div>
        <div
          className="relative h-32 min-w-0 flex-1 touch-pan-y"
          onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
          onPointerDown={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
          onPointerLeave={() => setHover(null)}
          role="img"
          aria-label={`Fees to date: ${money(last.paid)} paid and ${money(last.owed)} owed, since ${fmt(days[0].day, { month: "short", day: "numeric" })}`}
        >
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" aria-hidden>
            {[0, 0.5, 1].map((f) => (
              <line
                key={f}
                x1={0}
                x2={W}
                y1={H * f}
                y2={H * f}
                vectorEffect="non-scaling-stroke"
                className="stroke-zinc-200 dark:stroke-white/10"
                strokeWidth={1}
              />
            ))}
            <path d={path("owed")} fill="none" vectorEffect="non-scaling-stroke" strokeWidth={2} strokeDasharray="5 3" strokeLinejoin="round" className={OWED} />
            <path d={path("paid")} fill="none" vectorEffect="non-scaling-stroke" strokeWidth={2} strokeLinejoin="round" className={PAID} />
          </svg>
          {/* Each line named at its end (moved apart when they're close). */}
          {(() => {
            const yp = (y(last.paid) / H) * 100;
            let yo = (y(last.owed) / H) * 100;
            if (Math.abs(yp - yo) < 12) yo = yp + (yo >= yp ? 12 : -12);
            return (
              <>
                <span aria-hidden className="absolute right-0 -translate-y-full pb-0.5 text-[10px] font-medium text-zinc-600 dark:text-zinc-300" style={{ top: `${yp}%` }}>
                  Paid
                </span>
                <span aria-hidden className="absolute right-0 -translate-y-full pb-0.5 text-[10px] font-medium text-zinc-600 dark:text-zinc-300" style={{ top: `${yo}%` }}>
                  Owed
                </span>
              </>
            );
          })()}
          {/* Crosshair and the two points for the picked day. */}
          {hover !== null && shown && (
            <>
              <div aria-hidden className="absolute inset-y-0 w-px bg-zinc-400/70" style={{ left: `${pct(hover)}%` }} />
              {(["paid", "owed"] as const).map((k) => (
                <span
                  key={k}
                  aria-hidden
                  className={`absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white dark:ring-zinc-900 ${k === "paid" ? PAID_DOT : OWED_DOT}`}
                  style={{ left: `${pct(hover)}%`, top: `${(y(shown[k]) / H) * 100}%` }}
                />
              ))}
            </>
          )}
        </div>
      </div>
      <div className="mt-1 flex justify-between pl-11 text-[10px] text-zinc-400">
        <span>{fmt(days[0].day, { month: "short", day: "numeric" })}</span>
        <span>Today</span>
      </div>

      <button type="button" onClick={() => setTable(!table)} className="mt-2 text-xs font-medium text-thunder-blue hover:underline">
        {table ? "Hide table" : "Show as table"}
      </button>
      {table && (
        <div className="mt-2 max-h-64 overflow-y-auto rounded-lg ring-1 ring-zinc-950/10 dark:ring-white/10">
          <table className="w-full text-xs tabular-nums">
            <thead className="sticky top-0 bg-zinc-50 text-zinc-500 dark:bg-zinc-800">
              <tr>
                <th className="px-2 py-1.5 text-left font-medium">Day</th>
                <th className="px-2 py-1.5 text-right font-medium">Fees paid</th>
                <th className="px-2 py-1.5 text-right font-medium">Fees owed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
              {[...days].reverse().map((d) => (
                <tr key={d.day}>
                  <td className="px-2 py-1">{fmt(d.day, { weekday: "short", month: "short", day: "numeric" })}</td>
                  <td className="px-2 py-1 text-right">{money(d.paid)}</td>
                  <td className="px-2 py-1 text-right">{money(d.owed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

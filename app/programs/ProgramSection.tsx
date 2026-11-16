import type { ReactNode } from "react";

// One step of the program form: a color-coded card that opens and closes, its number and title, and while closed a line
// of what's set.
export const TONES = {
  blue: "bg-blue-50 ring-blue-200 dark:bg-blue-500/10 dark:ring-blue-400/30",
  violet: "bg-violet-50 ring-violet-200 dark:bg-violet-500/10 dark:ring-violet-400/30",
  amber: "bg-amber-50 ring-amber-200 dark:bg-amber-500/10 dark:ring-amber-400/30",
  emerald: "bg-emerald-50 ring-emerald-200 dark:bg-emerald-500/10 dark:ring-emerald-400/30",
  orange: "bg-orange-50 ring-orange-200 dark:bg-orange-500/10 dark:ring-orange-400/30",
  sky: "bg-sky-50 ring-sky-200 dark:bg-sky-500/10 dark:ring-sky-400/30",
} as const;
const DOTS = { blue: "bg-blue-600", violet: "bg-violet-600", amber: "bg-amber-500", emerald: "bg-emerald-600", orange: "bg-orange-500", sky: "bg-sky-600" } as const;
export default function ProgramSection({
  n,
  tone,
  title,
  summary,
  open = false,
  children,
}: {
  n: number;
  tone: keyof typeof TONES;
  title: string;
  summary: string;
  open?: boolean;
  children: ReactNode;
}) {
  return (
    <details open={open} className={`group rounded-xl ring-1 ${TONES[tone]}`}>
      <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-2.5 select-none [&::-webkit-details-marker]:hidden">
        <span className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${DOTS[tone]}`}>{n}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{title}</span>
          <span className="block truncate text-xs text-zinc-500 group-open:hidden dark:text-zinc-400">{summary}</span>
        </span>
        <span aria-hidden className="text-zinc-400 transition-transform group-open:rotate-180">⌄</span>
      </summary>
      <div className="space-y-3 border-t border-zinc-950/5 px-3 pt-3 pb-3 dark:border-white/10">{children}</div>
    </details>
  );
}

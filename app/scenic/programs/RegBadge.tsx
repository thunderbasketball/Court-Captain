import type { RegStatus } from "@/lib/scenic-programs";

const LOOK: Record<RegStatus, [string, string]> = {
  open: ["Registration open", "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300"],
  upcoming: ["Registration soon", "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"],
  closed: ["Registration closed", "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"],
};

export function RegBadge({ status }: { status: RegStatus }) {
  const [label, cls] = LOOK[status];
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${cls}`}>{label}</span>;
}

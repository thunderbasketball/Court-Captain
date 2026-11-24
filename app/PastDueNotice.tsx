import Link from "next/link";
import type { Invoice } from "@/lib/invoices";

const money = (c: number) => `$${(c / 100).toFixed(2).replace(/\.00$/, "")}`;
const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

// In the Home card: invoices past due (the League's Owners: every organization's; an organization: its own).
export default function PastDueNotice({ list, mine }: { list: Invoice[]; mine: boolean }) {
  return (
    <div className="space-y-1 rounded-xl bg-red-50 p-3 ring-1 ring-red-200 dark:bg-red-500/10 dark:ring-red-500/30">
      <p className="text-sm font-semibold text-red-700 dark:text-red-300">
        {list.length} invoice{list.length === 1 ? "" : "s"} past due
      </p>
      <ul className="space-y-1">
        {list.map((i) => (
          <li key={`${i.org} ${i.programId}`} className="flex items-baseline justify-between gap-3 text-sm">
            <Link href={`/invoice/${encodeURIComponent(i.org)}/${i.programId}`} className="min-w-0 font-medium text-thunder-blue dark:text-blue-400">
              {mine ? `${i.from}: ${i.program}` : `${i.orgName} · ${i.program}`}
            </Link>
            <span className="shrink-0 text-red-700 tabular-nums dark:text-red-300">
              {money(i.dueCents)} · was due {day(i.dueOn!)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

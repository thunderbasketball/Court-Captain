import Link from "next/link";
import type { BusyCoach } from "@/lib/busy-coaches";

// Coaches on more than 2 of the organization's teams: each coach, how many, and their teams to open.
export default function BusyCoachList({ list, base }: { list: BusyCoach[]; base: string }) {
  return (
    <>
      <ul className="divide-y divide-zinc-100 dark:divide-white/5">
        {list.map((c) => (
          <li key={c.coachId} className="py-1.5 text-sm">
            <span className="flex justify-between gap-3">
              <span className="font-medium">{c.name}</span>
              <span className="shrink-0 text-xs font-semibold text-red-600 dark:text-red-400">{c.teams.length} teams</span>
            </span>
            <span className="block text-xs text-zinc-500">
              {c.teams.map((t, i) => (
                <span key={t.id}>
                  {i > 0 && ", "}
                  <Link href={`${base}/teams/${t.id}`} className="text-thunder-blue hover:underline dark:text-blue-400">
                    {t.name}
                  </Link>
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
      <p className="pt-2 text-xs text-zinc-500">A Head or Assistant Coach on 3 or more teams. Check they can be at every game and practice.</p>
    </>
  );
}

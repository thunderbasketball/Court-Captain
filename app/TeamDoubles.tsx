import { connection } from "next/server";
import { cache } from "react";
import { db } from "@/lib/db";
import { teamDoubles } from "@/lib/roster-conflicts";

const read = cache(async (org: string, id: string) => {
  await connection();
  return teamDoubles(db, org === "thunder" ? { thunderTeamId: id } : org === "scenic-city" ? { teamId: id } : { orgTeamId: id }, new Date());
});

// A team page (its card and its Roster): players on another roster in its League too. Not allowed is a red warning with the
// rule; allowed is only noted, with why.
export default async function TeamDoubles({ org, id, className = "mt-2" }: { org: string; id: string; className?: string }) {
  if (!/^\d{1,18}$/.test(id)) return null;
  const list = await read(org, id);
  if (!list.length) return null;
  const line = (d: (typeof list)[number]) => `${d.name} ${d.maybe && !d.allowed ? "may also be" : "is also"} on ${d.other} (${d.program})`;
  const bad = list.filter((d) => !d.allowed);
  const fine = list.filter((d) => d.allowed);
  return (
    <div className={`space-y-2 ${className}`}>
      {bad.length > 0 && (
        <ul className="space-y-1 rounded-xl bg-red-50 p-3 text-sm text-red-700 ring-1 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30">
          <li className="font-semibold">ON TWO ROSTERS, NOT ALLOWED</li>
          {bad.map((d, i) => (
            <li key={i}>
              {line(d)}: {d.broken.join(", ")}.
            </li>
          ))}
        </ul>
      )}
      {fine.length > 0 && (
        <ul className="space-y-1 rounded-xl bg-zinc-50 p-3 text-sm text-zinc-600 ring-1 ring-zinc-950/10 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10">
          <li className="font-semibold">On two rosters, allowed</li>
          {fine.map((d, i) => (
            <li key={i}>
              {line(d)}. {d.allowed}.
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

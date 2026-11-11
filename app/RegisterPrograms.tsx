import type { OrgProgram } from "@/lib/org-leagues";
import { LastRegisterAll, RegisterAllButton } from "./leagues/LeagueButtons";
import { card } from "./ui";

const day = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

// The Register card on a Teams page (Thunder and every organization): the league's programs whose registration hasn't
// closed, how many of this organization's teams are in each, and Register all unregistered (ALL Season), with the last
// Register all and its Undo (while registration is open).
export default function RegisterPrograms({
  org,
  progs,
  bare = false,
}: {
  org: string;
  progs: { league: string; programs: OrgProgram[] };
  bare?: boolean; // inside another card: no card of its own
}) {
  const slug = org;
  return (
    <section className={bare ? "px-1" : `${card} p-4`}>
      <h2 className="font-semibold">{progs.league} programs</h2>
      <p className="mb-2 text-sm text-zinc-500">
        Register your teams: each goes into its division (gender, grade and level). Coaches can be added later.
      </p>
      <ul className="divide-y divide-zinc-100 dark:divide-white/5">
        {progs.programs.map((p) => (
          <li key={p.id} className="flex flex-wrap items-start justify-between gap-3 py-2.5">
            <div className="min-w-0 text-sm">
              <p className="font-semibold">
                {p.name} <span className="font-normal text-zinc-500">· {p.kind}</span>
              </p>
              <p className="text-zinc-500">
                {day(p.startsOn)}–{day(p.endsOn)}
                {p.feeCents !== null && ` · $${(p.feeCents / 100).toFixed(0)} per team, paid later`}
              </p>
              <p className="text-zinc-500">
                {p.registered} of {p.registered + p.unregistered} teams registered
                {p.status === "open" ? ` · open until ${day(p.regCloses)}` : " · registration opens soon"}
              </p>
              {p.lastBatch && <LastRegisterAll batch={p.lastBatch} program={p.name} canUndo={p.status === "open"} />}
            </div>
            {p.status === "open" && p.unregistered > 0 && (
              <RegisterAllButton org={slug} programId={p.id} program={p.name} count={p.unregistered} />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

import type { OrgProgram } from "@/lib/org-leagues";
import { LastRegisterAll, RegisterAllButton } from "./leagues/LeagueButtons";
import SubCard from "./SubCard";

const day = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

// Inside Home's Register ALL Teams card (Thunder and every organization): a card for each organization offering
// registrations (Scenic City Basketball for now), holding its events whose registration hasn't closed: open ones with
// how many of this organization's teams are in each and Register ALL unregistered (ALL Season), with the last Register
// ALL and its Undo; future ones greyed out with the day registration opens. (Past events: later.)
export default function RegisterPrograms({
  org,
  progs,
}: {
  org: string;
  progs: { league: string; leagueName: string; programs: OrgProgram[] };
}) {
  const open = progs.programs.filter((p) => p.status === "open").length;
  return (
    <SubCard title={progs.leagueName} count={open ? `${open} open` : undefined} open>
      <ul className="divide-y divide-zinc-100 dark:divide-white/5">
        {progs.programs.map((p) => {
          const later = p.status !== "open";
          return (
            <li key={p.id} className={`flex items-center justify-between gap-3 py-2 ${later ? "opacity-50" : ""}`}>
              <div className="min-w-0 text-sm">
                <p className="font-semibold">
                  {p.name} <span className="font-normal text-zinc-500">· {p.kind}</span>
                </p>
                <p className="text-xs text-zinc-500">
                  {day(p.startsOn)}–{day(p.endsOn)}
                  {p.feeCents !== null && ` · $${(p.feeCents / 100).toFixed(0)}`}
                  {later
                    ? ` · opens ${day(p.regOpens)}`
                    : ` · ${p.registered}/${p.registered + p.unregistered} registered · until ${day(p.regCloses)}`}
                </p>
                {p.lastBatch && <LastRegisterAll batch={p.lastBatch} program={p.name} canUndo={!later} />}
              </div>
              {!later && p.unregistered > 0 && (
                <RegisterAllButton org={org} programId={p.id} program={p.name} count={p.unregistered} compact />
              )}
            </li>
          );
        })}
      </ul>
    </SubCard>
  );
}

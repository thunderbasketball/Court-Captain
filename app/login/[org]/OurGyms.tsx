import type { HostDay, PublicGym } from "@/lib/public-org";
import { timeLabel } from "@/lib/time";
import FinalScore from "../../FinalScore";
import DirectionsLink from "../../DirectionsLink";
import SubCard from "../../SubCard";
import { genderBg, genderOf } from "../../ui";

const weekday = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

// A hosting organization's public page: the coming day of published games at its gyms, then its gyms with Directions.
export default function OurGyms({ gyms, day }: { gyms: PublicGym[]; day: HostDay | null }) {
  if (!gyms.length) return null;
  return (
    <section id="gyms" className="scroll-mt-4 space-y-2">
      <h2 className="px-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase">Our gyms</h2>
      {day && (
        <SubCard title={`Games here ${weekday(day.date)}`} count={day.games.length} open>
          <ul className="divide-y divide-zinc-100 text-sm dark:divide-white/5">
            {day.games.map((g, i) => (
              <li key={i} className={`flex gap-3 rounded-lg px-2 py-2 ${genderBg(genderOf(g.group))}`}>
                <span className="w-16 shrink-0 font-medium tabular-nums">{g.starts ? timeLabel(g.starts) : "TBA"}</span>
                <span className="min-w-0">
                  <span className="block">
                    <span className="font-medium">{g.away}</span> <span className="text-zinc-500">at</span> <span className="font-medium">{g.home}</span>
                  </span>
                  <span className="block text-xs text-zinc-500">
                    {g.group}
                    {g.gym && ` · ${g.gym}${g.court ? `, ${g.court}` : ""}`}
                  </span>
                  <FinalScore final={g.final} first={g.away} second={g.home} firstIs="away" group={g.group} />
                </span>
              </li>
            ))}
          </ul>
        </SubCard>
      )}
      <ul className="grid gap-2 sm:grid-cols-2">
        {gyms.map((g) => (
          <li key={g.name} className="rounded-xl bg-white p-3 ring-1 ring-zinc-950/10 dark:bg-zinc-900 dark:ring-white/10">
            <span className="block font-semibold">{g.name}</span>
            <span className="block text-xs text-zinc-500">
              {g.address?.replace(/, USA$/, "")}
              <DirectionsLink href={g.map} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

import { currentUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { isScheduler } from "@/lib/scenic-programs";
import { removalRequests } from "@/lib/schedule-removal";
import SubCard from "../../../SubCard";
import { RemovalDecision } from "./RemovalDecision";

const when = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });

// Teams asking to come off this League's schedule (Directors of Scheduling): flashes while any wait. Approve puts TBD in
// each of its games and withdraws it; Decline leaves it on.
export default async function RemovalRequests({ programId }: { programId: string }) {
  const user = await currentUser();
  if (!user || !(await isScheduler(db, user))) return null;
  const list = await removalRequests(db, programId);
  if (!list.length) return null;
  return (
    <SubCard title="Removal requests" count={list.length} alert open>
      <ul className="divide-y divide-zinc-100 dark:divide-white/5">
        {list.map((r) => (
          <li key={r.id} className="space-y-2 py-2.5 text-sm">
            <p>
              <span className="font-semibold">{r.team}</span>{" "}
              <span className="text-zinc-500">
                · in {r.games} game{r.games === 1 ? "" : "s"} · asked by {r.by} on {when(r.at)}
              </span>
            </p>
            <RemovalDecision id={r.id} team={r.team} games={r.games} />
          </li>
        ))}
      </ul>
    </SubCard>
  );
}

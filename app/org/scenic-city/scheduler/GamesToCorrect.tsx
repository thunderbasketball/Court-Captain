import { currentUser } from "@/lib/auth/server";
import { gamesToCorrect, type GameToCorrect } from "@/lib/schedule-corrections";
import { db } from "@/lib/db";
import { isScheduler } from "@/lib/scenic-programs";
import { timeLabel } from "@/lib/time";
import SubCard from "../../../SubCard";
import CorrectButtons from "./CorrectButtons";

const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

// Games to correct (Directors of Scheduling): a team's grade, level or gender changed after its games were made. Flashes until each
// is corrected: TBD in the team's place, or the game removed.
export default async function GamesToCorrect({ programId }: { programId: string }) {
  const user = await currentUser();
  if (!user || !(await isScheduler(db, user))) return null;
  const list = await gamesToCorrect(db, { programId }, new Date());
  if (!list.length) return null;
  return (
    <SubCard title="Games to correct" count={list.length} alert open>
      <CorrectList list={list} canAct={!user.actingBy} />
    </SubCard>
  );
}

// Home's To Do shows them too.
export function CorrectList({ list, canAct }: { list: GameToCorrect[]; canAct: boolean }) {
  return (
    <>
      <p className="mb-2 text-xs text-zinc-500">A team changed grade, level or gender after these games were made.</p>
      <ul className="space-y-2">
        {list.map((g) => (
          <li key={g.id} className="space-y-1.5 rounded-xl p-2.5 text-sm ring-1 ring-red-300 dark:ring-red-500/40">
            <p className="font-semibold">
              {g.a.name} vs {g.b?.name ?? "TBD"}
            </p>
            <p className="text-xs text-zinc-500">
              {day(g.day)} · {g.division} {g.level}
              {g.starts ? ` · ${timeLabel(g.starts)}${g.gym ? ` at ${g.gym}` : ""}` : " · not on the grid"}
              {g.published && <span className="font-semibold text-red-600 dark:text-red-400"> · published</span>}
            </p>
            {g.why.map((w) => (
              <p key={w} className="text-xs font-medium text-red-700 dark:text-red-300">
                ⚠ {w}
              </p>
            ))}
            {canAct &&
              (g.published ? (
                <p className="text-xs text-zinc-500">
                  Unpublish {g.level} for that day, then correct it here.
                </p>
              ) : (
                <CorrectButtons id={g.id} teams={[g.a, ...(g.b ? [g.b] : [])].filter((t) => g.teams.includes(t.id))} />
              ))}
          </li>
        ))}
      </ul>
    </>
  );
}

import type { LeagueConflicts } from "@/lib/roster-conflicts";
import { ConflictGroups } from "./org/scenic-city/programs/RosterConflicts";

// An organization's own teams' roster conflicts in a League it plays in (Home's To Do, Teams → Warnings): what to do, then each
// pair with its teams to open. Only the League marks them.
export default function OurConflicts({ list, base }: { list: LeagueConflicts[]; base: string }) {
  return (
    <>
      <p className="mb-2 text-xs text-zinc-500">
        Players who look like they&rsquo;re on two rosters in the League. Not allowed: take the player off one, fix a name or birthdate that&rsquo;s wrong, or ask the League. Allowed ones are just noted, with why.
      </p>
      {list.map((p) => (
        <ConflictGroups key={p.programId} p={p} canAct={false} base={base} />
      ))}
    </>
  );
}

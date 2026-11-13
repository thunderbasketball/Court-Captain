// Team Practice Facilities (Facilities → Team Practice Facilities): which of Thunder's gyms each team may book practices
// at. Kept in teams.practice_locations (gym names) with practice_gyms_set (never set = every gym; set with none = it
// practices at its own gym only). A team's coaches only see and book the gyms
// checked for it; the Director's own grid can still book a team anywhere (lib/practice/booking.ts).
import type { Pool } from "pg";
import type { SessionUser } from "../auth/service";
import { hasArea } from "../org-admin";
import { withTx } from "../sql";

type Deps = { pool: Pool; now: () => Date };
type Result = { ok: true } | { ok: false; message: string };

export type TeamGymsRow = {
  id: string;
  name: string;
  level: string;
  gender: "Boys" | "Girls";
  grades: string[];
  gyms: string[]; // the active gyms checked for it (every gym when never set)
  everyGym: boolean; // never set: every gym, including ones added later
  setBy: string | null;
  setAt: Date | null;
};
export type TeamGyms = { gyms: string[]; teams: TeamGymsRow[] };

export const canSetTeamGyms = (viewer: SessionUser) => hasArea(viewer, "facilities", "practices");

const activeGyms = async (q: Pick<Pool, "query">) =>
  (await q.query<{ name: string }>("select name from gyms where org = 'thunder' and active order by lower(name)")).rows.map((g) => g.name);

// Teams by Level (COMP first), Gender, youngest grade, then name.
export async function teamGyms(deps: Pick<Deps, "pool">, viewer: SessionUser): Promise<TeamGyms | null> {
  if (!canSetTeamGyms(viewer)) return null;
  const gyms = await activeGyms(deps.pool);
  const r = await deps.pool.query<{
    id: string;
    name: string;
    level: string;
    gender: "Boys" | "Girls";
    grades: string[];
    locations: string[];
    set: boolean;
    setBy: string | null;
    setAt: Date | null;
  }>(
    `select id::text, name, level, gender, grades, practice_locations as locations,
            practice_gyms_set or practice_locations <> '{}' as set,
            practice_locations_by as "setBy", practice_locations_at as "setAt"
     from teams order by level = 'COMP' desc, gender, grade_sort, lower(name)`,
  );
  return {
    gyms,
    teams: r.rows.map((t) => {
      const mine = t.locations.map((l) => l.toLowerCase());
      return {
        id: t.id,
        name: t.name,
        level: t.level,
        gender: t.gender,
        grades: t.grades,
        gyms: t.set ? gyms.filter((g) => mine.includes(g.toLowerCase())) : gyms,
        everyGym: !t.set,
        setBy: t.setBy,
        setAt: t.setAt,
      };
    }),
  };
}

// Check or uncheck one gym for a team. Unchecking them all leaves it with Own gym only. Anything else it lists (a name
// that isn't one of the gyms) is left as it is.
export async function setTeamGym(
  deps: Deps,
  viewer: SessionUser,
  input: { teamId: unknown; gym: unknown; on: unknown },
): Promise<Result> {
  if (!canSetTeamGyms(viewer)) return { ok: false, message: "Only a Director of Facilities or Practices can set this." };
  const teamId = String(input.teamId ?? "");
  const gym = typeof input.gym === "string" ? input.gym.trim() : "";
  if (!/^\d{1,18}$/.test(teamId) || !gym || gym.length > 80 || typeof input.on !== "boolean")
    return { ok: false, message: "Pick a team and a gym." };
  return withTx(deps.pool, async (q) => {
    const gyms = await activeGyms(q);
    const name = gyms.find((g) => g.toLowerCase() === gym.toLowerCase());
    if (!name) return { ok: false as const, message: "That gym no longer exists." };
    const t = await q.query<{ locations: string[]; set: boolean }>(
      "select practice_locations as locations, practice_gyms_set or practice_locations <> '{}' as set from teams where id = $1 for update",
      [teamId],
    );
    if (!t.rows[0]) return { ok: false as const, message: "That team no longer exists." };
    const listed = t.rows[0].locations;
    const isGym = (l: string) => gyms.some((g) => g.toLowerCase() === l.toLowerCase());
    const others = listed.filter((l) => !isGym(l));
    const checked = (t.rows[0].set ? listed.filter(isGym) : gyms).filter((g) => g.toLowerCase() !== name.toLowerCase());
    if (input.on) checked.push(name);
    const next = [...gyms.filter((g) => checked.some((c) => c.toLowerCase() === g.toLowerCase())), ...others];
    await q.query("update teams set practice_locations = $2, practice_gyms_set = true, practice_locations_by = $3, practice_locations_at = $4 where id = $1", [
      teamId,
      next,
      `${viewer.firstName} ${viewer.lastName}`,
      deps.now(),
    ]);
    return { ok: true as const };
  });
}

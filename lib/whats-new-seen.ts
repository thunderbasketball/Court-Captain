// Which versions a person sees, and whether there's something new for them (SPEC.md section 14): highlighted from their next
// login until they open it, and for the rest of that login; after that it's in Support.
import type { Pool } from "pg";
import { isFor, type For } from "./support";
import { RELEASES, newer, type NewsItem, type Release } from "./whats-new";

type Deps = { pool: Pick<Pool, "query">; now: () => Date };
export type MyRelease = Omit<Release, "items"> & { items: NewsItem[] };

// Pure: the versions with something for them, each with only their items.
export function releasesFor(list: For[], releases: readonly Release[] = RELEASES): MyRelease[] {
  const mine = (i: NewsItem) => list.some((f) => isFor({ audiences: [...i.who], features: [...(i.needs ?? [])], areas: [...(i.areas ?? [])] }, f));
  return releases.map((r) => ({ ...r, items: r.items.filter(mine) })).filter((r) => r.items.length > 0);
}

export type News = { releases: MyRelease[]; fresh: string[]; highlight: boolean; show: boolean };

// `fresh`: the versions they haven't looked at (a login made after a version's date isn't told about it). `highlight`: there
// are some. `show`: those, or they looked during this login.
export async function newsFor(deps: Deps, coachId: string, list: For[]): Promise<News> {
  const releases = releasesFor(list);
  const u = await deps.pool.query<{ version: string | null; seen_at: Date | null; last_login_at: Date | null; made: string }>(
    `select s.version, s.seen_at, u.last_login_at, (u.created_at at time zone 'America/New_York')::date::text as made
       from users u left join whats_new_seen s on s.coach_id = u.coach_id where u.coach_id = $1`,
    [coachId],
  );
  const me = u.rows[0];
  if (!me) return { releases, fresh: [], highlight: false, show: false };
  const fresh = releases.filter((r) => !r.history && newer(r.version, me.version) && me.made < r.date).map((r) => r.version);
  const thisLogin = !!me.seen_at && !!me.last_login_at && me.seen_at >= me.last_login_at && releases.length > 0;
  return { releases, fresh, highlight: fresh.length > 0, show: fresh.length > 0 || thisLogin };
}

// They looked: everything up to the newest version is seen.
export async function markSeen(deps: Deps, coachId: string): Promise<void> {
  await deps.pool.query(
    `insert into whats_new_seen (coach_id, version, seen_at) values ($1, $2, $3)
     on conflict (coach_id) do update set version = excluded.version, seen_at = excluded.seen_at where whats_new_seen.version <> excluded.version`,
    [coachId, RELEASES[0].version, deps.now()],
  );
}

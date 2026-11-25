// Parent view (an organization with CourtPlayers; SPEC.md section 14): on a team's roster, 👁 by a parent shows what that
// parent sees, whether or not they've logged in, view only, right there. The team's Head and Assistant Coaches: that
// parent's players on their own team(s). Directors of Teams or Players, Admins and Owners: all of that parent's players, and
// (Players, Admins) fees owed. Never anyone's session, chats or alerts (an Admin's View as is for that).
import type { Deps } from "./auth/service";
import type { SessionUser } from "./auth/service";
import { playersBy, type FoundPlayer } from "./find-player";
import { hasArea, isThunderAdmin } from "./org-admin";
import { normalizeCell } from "./phone";

export type ParentView = {
  name: string;
  players: FoundPlayer[];
  owed: number | null; // Directors of Players and Admins
  whole: boolean; // every player of theirs (a coach: only their team's)
  login: { coachId: string | null; verified: boolean } | null; // Admins: to open the app as them
  canLogIn: boolean; // they have a cell on the registration
};

export async function parentView(deps: Pick<Deps, "pool" | "now">, viewer: SessionUser, registrantId: unknown, slot: unknown): Promise<ParentView | null> {
  if (typeof registrantId !== "string" || !/^[\w-]{1,40}$/.test(registrantId) || (slot !== 1 && slot !== 2)) return null;
  const whole = hasArea(viewer, "teams", "players");
  const teams = whole
    ? []
    : (
        await deps.pool.query<{ id: string }>(
          `select s.team_id::text as id from team_staff s join team_players p on p.team_id = s.team_id and p.registrant_id = $2
            where s.coach_id = $1 and s.role in ('HeadCoach', 'AsstCoach')`,
          [viewer.coachId, registrantId],
        )
      ).rows.map((t) => t.id);
  if (!whole && !teams.length) return null;
  const g = (
    await deps.pool.query<{ first: string | null; last: string | null; cell: string | null }>(
      `select parent${slot}_first as first, parent${slot}_last as last, parent${slot}_cell as cell from registrations where registrant_id = $1`,
      [registrantId],
    )
  ).rows[0];
  if (!g || !(g.first || g.last || g.cell)) return null;
  const cell = g.cell ? normalizeCell(g.cell) : null;
  // A coach sees this parent's players on the teams they coach (this player's, and a brother or sister on the same team).
  const players = await playersBy(deps, cell ? { cell } : { ids: [registrantId] }, whole ? null : teams);
  const admin = isThunderAdmin(viewer) && !viewer.actingBy;
  const [owed, login] = await Promise.all([
    whole && (hasArea(viewer, "players") || admin) && players.length
      ? deps.pool
          .query<{ owed: number | null }>("select sum(amount_remaining)::float8 as owed from registrations where registrant_id = any($1)", [players.map((p) => p.id)])
          .then((r) => r.rows[0].owed ?? 0)
      : null,
    admin && cell
      ? deps.pool
          .query<{ id: string; ok: boolean }>(
            "select coach_id as id, coalesce(lower(trim(email)) = lower(trim(verified_email)), false) as ok from users where cell = $1 and active",
            [cell],
          )
          .then((r) => ({ coachId: r.rows[0]?.id ?? null, verified: r.rows[0]?.ok ?? false }))
      : null,
  ]);
  return { name: `${g.first ?? ""} ${g.last ?? ""}`.trim() || "Parent", players, owed, whole, login, canLogIn: !!cell };
}

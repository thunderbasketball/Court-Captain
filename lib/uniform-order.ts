// A vendor order belongs to the player (SPEC.md section 15): it counts on the team it was sent for and, once they've left that
// team, on whatever team they're on now, so a player who moves isn't ordered again. A player on two teams has each team's own.
import type { PoolClient } from "pg";

// For a query with uniform_vendor_sent s and team_players p: is s this player's, here?
export const SENT_HERE = `(s.registrant_id = p.registrant_id and (s.team_id = p.team_id
  or not exists (select 1 from team_players was where was.registrant_id = s.registrant_id and was.team_id = s.team_id)))`;

type Q = Pick<PoolClient, "query">;

// Before a player leaves these teams (null: all but `keep`): their uniform there, newest first, to bring along.
export async function uniformToBring(q: Q, registrantId: string, from: string | null, keep: string | null) {
  const r = await q.query<Record<string, unknown>>(
    `select number, size, updated_by, updated_at, needs_uniform_by, needs_uniform_at, order_added_by, order_added_at, unlocked_by, unlocked_at, reorder_by, reorder_at
       from team_uniforms where registrant_id = $1 and ($2::bigint is null or team_id = $2) and team_id::text is distinct from $3
       order by updated_at desc limit 1`,
    [registrantId, from, keep],
  );
  return r.rows[0] ?? null;
}

// After a player joins a team with no uniform info there yet: what they brought (number, size, Needs a uniform and the rest),
// else the number and size they were last ordered, when that order was for a team they're no longer on.
export async function bringUniform(q: Q, registrantId: string, teamId: string, brought: Record<string, unknown> | null): Promise<void> {
  if (brought) {
    await q.query(
      `insert into team_uniforms (team_id, registrant_id, number, size, updated_by, updated_at, needs_uniform_by, needs_uniform_at, order_added_by, order_added_at,
                                  unlocked_by, unlocked_at, reorder_by, reorder_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       on conflict (team_id, registrant_id) do nothing`,
      [
        teamId,
        registrantId,
        brought.number,
        brought.size,
        brought.updated_by,
        brought.updated_at,
        brought.needs_uniform_by,
        brought.needs_uniform_at,
        brought.order_added_by,
        brought.order_added_at,
        brought.unlocked_by,
        brought.unlocked_at,
        brought.reorder_by,
        brought.reorder_at,
      ],
    );
    return;
  }
  await q.query(
    `insert into team_uniforms (team_id, registrant_id, number, size, updated_by, updated_at)
     select p.team_id, p.registrant_id, s.number, s.size, o.sent_by, o.sent_at
       from team_players p join uniform_vendor_sent s on ${SENT_HERE} join uniform_vendor_sends o on o.id = s.send_id
      where p.team_id = $1 and p.registrant_id = $2 and o.cancelled_at is null
      order by o.sent_at desc, o.id desc limit 1
     on conflict (team_id, registrant_id) do nothing`,
    [teamId, registrantId],
  );
}

// A player's parents, added or fixed in the app (SPEC.md section 14): with CourtPlayers, its Owners, Admins and Directors
// of Players or Teams change either parent; the staff of the player's team (any role) add one that's missing (or fill in
// what's blank), and fix what they added themselves. That parent then makes their own account: cell, then a code to the
// email here. Registrations are replaced on every sheet sync, so these are kept in player_parents and put back after each
// one (applyParentFixes). Who did it is recorded.
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { cleanEmail, cleanName } from "./auth/validate";
import { hasArea } from "./org-admin";
import { normalizeCell } from "./phone";
import { withTx, type Queryable } from "./sql";

type Deps = { pool: Pool; now: () => Date };
type Result = { ok: true } | { ok: false; message: string };
const isPlayer = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(v);
const by = (v: SessionUser) => `${v.firstName} ${v.lastName}`;
const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

// After the sheet's rows are in (freshFromSheet): drop those the registration now agrees with, note what it says, then put
// the rest back.
export async function applyParentFixes(q: Pick<Queryable, "query">, freshFromSheet: boolean): Promise<void> {
  for (const n of [1, 2]) {
    if (freshFromSheet) {
      await q.query(
        `delete from player_parents f using registrations g
          where f.slot = ${n} and g.registrant_id = f.registrant_id and g.added_by is null and g.parent${n}_cell = f.cell
            and lower(trim(coalesce(g.parent${n}_first, ''))) = lower(f.first_name) and lower(trim(coalesce(g.parent${n}_last, ''))) = lower(f.last_name)
            and lower(trim(coalesce(g.parent${n}_email, ''))) = lower(coalesce(f.email, ''))`,
      );
      await q.query(
        `update player_parents f set sheet = jsonb_build_object('first', g.parent${n}_first, 'last', g.parent${n}_last, 'cell', g.parent${n}_cell, 'email', g.parent${n}_email)
           from registrations g where f.slot = ${n} and g.registrant_id = f.registrant_id and g.added_by is null`,
      );
    }
    await q.query(
      `update registrations g set parent${n}_first = f.first_name, parent${n}_last = f.last_name, parent${n}_cell = f.cell, parent${n}_email = f.email
         from player_parents f where f.slot = ${n} and g.registrant_id = f.registrant_id
          and (g.parent${n}_first, g.parent${n}_last, g.parent${n}_cell, g.parent${n}_email) is distinct from (f.first_name, f.last_name, f.cell, f.email)`,
    );
  }
}

type P = { first: string | null; last: string | null; cell: string | null; email: string | null };
export type ParentSlot = P & { slot: 1 | 2; setBy: string | null; canEdit: boolean; canUndo: boolean };

const ANY = ["first", "last", "cell", "email"] as const;
const whole = (p: P) => ANY.every((k) => !!p[k]?.trim());

async function rights(q: Pick<Queryable, "query">, viewer: SessionUser, ids: string[]): Promise<{ director: boolean; staffOf: Set<string> }> {
  if (hasArea(viewer, "players", "teams")) return { director: true, staffOf: new Set() };
  const r = await q.query<{ id: string }>(
    `select distinct p.registrant_id as id from team_players p join team_staff s on s.team_id = p.team_id
      where s.coach_id = $1 and p.registrant_id = any($2)`,
    [viewer.coachId, ids],
  );
  return { director: false, staffOf: new Set(r.rows.map((x) => x.id)) };
}

// These players' two parent places, with what this person may do to each. Players they have no part in are left out.
export async function parentSlots(q: Pick<Queryable, "query">, viewer: SessionUser, ids: string[]): Promise<Map<string, ParentSlot[]>> {
  const out = new Map<string, ParentSlot[]>();
  if (!ids.length) return out;
  const [may, r, fixes] = await Promise.all([
    rights(q, viewer, ids),
    q.query<{ id: string } & Record<string, string | null>>(
      `select registrant_id as id, parent1_first, parent1_last, parent1_cell, parent1_email, parent2_first, parent2_last, parent2_cell, parent2_email
         from registrations where registrant_id = any($1)`,
      [ids],
    ),
    q.query<{ id: string; slot: number; set_by: string; set_by_id: string }>(
      "select registrant_id as id, slot, set_by, set_by_id from player_parents where registrant_id = any($1)",
      [ids],
    ),
  ]);
  for (const g of r.rows) {
    if (!may.director && !may.staffOf.has(g.id)) continue;
    out.set(
      g.id,
      ([1, 2] as const).map((n) => {
        const p: P = { first: g[`parent${n}_first`], last: g[`parent${n}_last`], cell: g[`parent${n}_cell`], email: g[`parent${n}_email`] };
        const f = fixes.rows.find((x) => x.id === g.id && x.slot === n);
        const mine = f?.set_by_id === viewer.coachId;
        return { slot: n, ...p, setBy: f?.set_by ?? null, canEdit: may.director || mine || !whole(p), canUndo: !!f && (may.director || mine) };
      }),
    );
  }
  return out;
}

// Add or fix one parent (place 1 or 2). Name and cell required; the email is how they verify their account.
export async function saveParent(
  deps: Deps,
  viewer: SessionUser,
  registrantId: unknown,
  slot: unknown,
  input: { first?: unknown; last?: unknown; cell?: unknown; email?: unknown },
): Promise<Result> {
  if (!isPlayer(registrantId) || (slot !== 1 && slot !== 2)) return { ok: false, message: "That player isn't registered." };
  const first = cleanName(input?.first);
  const last = cleanName(input?.last);
  const cell = normalizeCell(typeof input?.cell === "string" ? input.cell : "");
  if (!first || !last || !cell) return { ok: false, message: "Enter the parent's first name, last name and 10-digit cell." };
  const text = typeof input.email === "string" ? input.email.trim() : "";
  const email = text ? cleanEmail(text) : null;
  if (text && !email) return { ok: false, message: "That email doesn't look right." };
  return withTx(deps.pool, async (q) => {
    const row = (
      await q.query<Record<string, string | null>>(
        `select parent1_first, parent1_last, parent1_cell, parent1_email, parent2_first, parent2_last, parent2_cell, parent2_email
           from registrations where registrant_id = $1 for update`,
        [registrantId],
      )
    ).rows[0];
    const may = await rights(q, viewer, [registrantId]);
    if (!may.director && !may.staffOf.has(registrantId))
      return { ok: false as const, message: "Only the player's team staff, or a Director, can change their parents." };
    if (!row) return { ok: false as const, message: "That player isn't registered." };
    const at = (n: number): P => ({ first: row[`parent${n}_first`], last: row[`parent${n}_last`], cell: row[`parent${n}_cell`], email: row[`parent${n}_email`] });
    const now = at(slot);
    if (at(3 - slot).cell === cell) return { ok: false as const, message: "That cell is already this player's other parent." };
    const fix = (
      await q.query<{ set_by_id: string; sheet: P }>("select set_by_id, sheet from player_parents where registrant_id = $1 and slot = $2 for update", [registrantId, slot])
    ).rows[0];
    if (!may.director) {
      // Staff add what's missing; what the family gave on the registration is changed by a Director. A parent's cell and
      // email open the family's account, so they can't take over one that's on another registration, or add themselves.
      const kept = fix?.set_by_id === viewer.coachId ? fix.sheet : now;
      if (
        (kept.first?.trim() && !same(kept.first, first)) ||
        (kept.last?.trim() && !same(kept.last, last)) ||
        (kept.cell?.trim() && kept.cell !== cell) ||
        (kept.email?.trim() && !same(kept.email, email))
      )
        return { ok: false as const, message: "That parent came with the registration: ask a Director to change them." };
      const me = (await q.query<{ cell: string }>("select cell from users where coach_id = $1", [viewer.coachId])).rows[0]?.cell;
      if (me === cell && now.cell !== cell) return { ok: false as const, message: "Ask a Director to add you as a parent." };
      const others = await q.query<{ e: string | null }>(
        `select case when parent1_cell = $1 then parent1_email else parent2_email end as e from registrations
          where registrant_id <> $2 and (parent1_cell = $1 or parent2_cell = $1)`,
        [cell, registrantId],
      );
      if (email && others.rows.length && !others.rows.some((x) => same(x.e, email)))
        return { ok: false as const, message: "That cell is on another player with a different email: ask a Director to add this parent." };
    }
    await q.query(
      `insert into player_parents (registrant_id, slot, first_name, last_name, cell, email, sheet, set_by, set_by_id, set_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       on conflict (registrant_id, slot) do update set first_name = $3, last_name = $4, cell = $5, email = $6, set_by = $8, set_by_id = $9, set_at = $10`,
      [registrantId, slot, first, last, cell, email, JSON.stringify(now), by(viewer), viewer.coachId, deps.now()],
    );
    await q.query(`update registrations set parent${slot}_first = $2, parent${slot}_last = $3, parent${slot}_cell = $4, parent${slot}_email = $5 where registrant_id = $1`, [
      registrantId,
      first,
      last,
      cell,
      email,
    ]);
    return { ok: true as const };
  });
}

// Back to what the registration says: a Director, or whoever entered it.
export async function undoParent(deps: Deps, viewer: SessionUser, registrantId: unknown, slot: unknown): Promise<Result> {
  if (!isPlayer(registrantId) || (slot !== 1 && slot !== 2)) return { ok: false, message: "That player isn't registered." };
  return withTx(deps.pool, async (q) => {
    await q.query("select 1 from registrations where registrant_id = $1 for update", [registrantId]);
    const f = (
      await q.query<{ set_by_id: string; sheet: P }>("select set_by_id, sheet from player_parents where registrant_id = $1 and slot = $2 for update", [registrantId, slot])
    ).rows[0];
    const may = await rights(q, viewer, [registrantId]);
    if (!may.director && !(may.staffOf.has(registrantId) && f?.set_by_id === viewer.coachId))
      return { ok: false as const, message: "Only a Director, or whoever added this parent, can undo it." };
    if (!f) return { ok: true as const };
    await q.query("delete from player_parents where registrant_id = $1 and slot = $2", [registrantId, slot]);
    await q.query(`update registrations set parent${slot}_first = $2, parent${slot}_last = $3, parent${slot}_cell = $4, parent${slot}_email = $5 where registrant_id = $1`, [
      registrantId,
      f.sheet.first,
      f.sheet.last,
      f.sheet.cell,
      f.sheet.email,
    ]);
    return { ok: true as const };
  });
}

// Order Spares (Thunder's Uniforms card, Directors of Uniforms; SPEC.md section 15): spare uniform sets, jerseys and shooting
// shirts (a number and size each) and shorts (how many of each size). They're added to the next order to the vendor (no names),
// wait there until it's sent (lib/uniform-vendor), and can be taken off until then. Who added them is recorded. No player is on
// one, so they never change who's been ordered for.
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { hasArea } from "./org-admin";
import { MAX_SHORTS, MAX_SPARES, SPARE_ITEMS, checkSpares, sortSpares, spareCount, type Spare } from "./spare-items";
import { withTx, type Queryable } from "./sql";

type Deps = { pool: Pool; now: () => Date };
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };
const no = { ok: false as const, message: "Only a Director of Uniforms can order spares." };
const may = (viewer: SessionUser) => hasArea(viewer, "uniforms") && !viewer.actingBy;
const LOCK = "select pg_advisory_xact_lock(hashtext('uniform-vendor:thunder'))"; // one change to the next order at a time

export type PendingSpare = Spare & { id: string; addedBy: string | null };

// Waiting for the next order, in order (the caller has checked who may see them).
export async function pendingSpares(q: Pick<Queryable, "query">): Promise<PendingSpare[]> {
  const r = await q.query<PendingSpare>(`select id::text, item, number, size, qty, added_by as "addedBy" from uniform_vendor_spares where send_id is null order by id`);
  return sortSpares(r.rows);
}

// Onto the next order. Shorts of a size already waiting are added to.
export async function addSpares(deps: Deps, viewer: SessionUser, input: unknown): Promise<Result<{ added: number; waiting: number }>> {
  if (!may(viewer)) return no;
  const c = checkSpares(input);
  if (!c.ok) return c;
  return withTx(deps.pool, async (q) => {
    await q.query(LOCK);
    const waiting = await pendingSpares(q);
    for (const i of SPARE_ITEMS)
      if (i.key !== "shorts" && [...waiting, ...c.rows].filter((r) => r.item === i.key).length > MAX_SPARES)
        return { ok: false as const, message: `${i.many}: at most ${MAX_SPARES} in one order, with those already waiting.` };
    const by = `${viewer.firstName} ${viewer.lastName}`;
    for (const r of c.rows) {
      const same = r.item === "shorts" ? waiting.find((w) => w.item === "shorts" && w.size === r.size) : undefined;
      if (same && same.qty + r.qty > MAX_SHORTS) return { ok: false as const, message: `Shorts ${r.size}: at most ${MAX_SHORTS} in one order (${same.qty} already waiting).` };
      if (same) await q.query("update uniform_vendor_spares set qty = qty + $2, added_by = $3, added_at = $4 where id = $1", [same.id, r.qty, by, deps.now()]);
      else await q.query("insert into uniform_vendor_spares (item, number, size, qty, added_by, added_at) values ($1, $2, $3, $4, $5, $6)", [r.item, r.number, r.size, r.qty, by, deps.now()]);
    }
    const added = spareCount(c.rows);
    return { ok: true as const, added, waiting: spareCount(waiting) + added };
  });
}

// Off the next order (one already sent stays with its order).
export async function removeSpare(deps: Deps, viewer: SessionUser, id: unknown): Promise<Result> {
  if (!may(viewer)) return no;
  if (typeof id !== "string" || !/^\d{1,18}$/.test(id)) return { ok: false, message: "That isn't there any more." };
  return withTx(deps.pool, async (q) => {
    await q.query(LOCK);
    const r = await q.query("delete from uniform_vendor_spares where id = $1 and send_id is null", [id]);
    return r.rowCount ? { ok: true as const } : { ok: false as const, message: "It's not waiting any more (removed, or already sent)." };
  });
}

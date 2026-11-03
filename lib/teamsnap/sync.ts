// Keeps registrations in step with the Google Sheet's TeamSnapAPI tab.
// Only replaces the list when the tab changed, and never with a sheet that has errors
// or that suddenly lost more than half the players (e.g. a filter or a half-cleared tab).
import type { Pool } from "pg";
import { createHash } from "node:crypto";
import { withTx } from "../sql";
import { replaceRegistrations } from "./import";
import { parseRegistrations, schoolYearOf } from "./parse";

export const SYNC_NAME = "registrations";
export const AUTO_IMPORTED_BY = "Google Sheet (auto)";

export type SyncResult =
  { status: "updated"; imported: number } | { status: "unchanged" } | { status: "busy" } | { status: "failed"; message: string };

type Deps = { pool: Pool; readRows: () => Promise<string[][]>; now: () => Date };

export async function syncRegistrations(deps: Deps): Promise<SyncResult> {
  const now = deps.now();
  let rows: string[][];
  try {
    rows = await deps.readRows();
  } catch (e) {
    return fail(deps, now, e instanceof Error ? e.message : String(e));
  }
  const hash = createHash("sha256").update(JSON.stringify(rows)).digest("hex");

  const result = await withTx(deps.pool, async (q): Promise<SyncResult> => {
    // One sync at a time, even across server processes.
    const lock = await q.query<{ ok: boolean }>("select pg_try_advisory_xact_lock(hashtext('sync:registrations')) as ok");
    if (!lock.rows[0].ok) return { status: "busy" };

    const prev = await q.query<{ source_hash: string | null }>("select source_hash from sync_status where name = $1", [
      SYNC_NAME,
    ]);
    if (prev.rows[0]?.source_hash === hash) {
      await q.query("update sync_status set checked_at = $2, ok = true, message = null where name = $1", [SYNC_NAME, now]);
      return { status: "unchanged" };
    }

    const parsed = parseRegistrations(rows, { schoolYear: schoolYearOf(now) });
    if (parsed.errors.length) {
      const first = parsed.errors[0];
      return {
        status: "failed",
        message: `The sheet has ${parsed.errors.length} error(s), so the player list was not changed. First: row ${first.row}${first.name ? ` (${first.name})` : ""}: ${first.message}`,
      };
    }
    const current = (await q.query<{ n: number }>("select count(*)::int as n from registrations where added_by is null")).rows[0]
      .n;
    if (parsed.players.length < current / 2) {
      return {
        status: "failed",
        message: `The sheet has ${parsed.players.length} players but the app has ${current}, so the list was not changed. If that's right, run the import by hand.`,
      };
    }

    const { imported } = await replaceRegistrations(q, parsed, AUTO_IMPORTED_BY, now);
    await q.query(
      `insert into sync_status (name, checked_at, changed_at, source_hash, ok, message) values ($1, $2, $2, $3, true, null)
       on conflict (name) do update set checked_at = $2, changed_at = $2, source_hash = $3, ok = true, message = null`,
      [SYNC_NAME, now, hash],
    );
    return { status: "updated", imported };
  });

  return result.status === "failed" ? fail(deps, now, result.message) : result;
}

async function fail(deps: Deps, now: Date, message: string): Promise<SyncResult> {
  await deps.pool.query(
    `insert into sync_status (name, checked_at, ok, message) values ($1, $2, false, $3)
     on conflict (name) do update set checked_at = $2, ok = false, message = $3`,
    [SYNC_NAME, now, message],
  );
  return { status: "failed", message };
}

export type SyncStatus = { checkedAt: Date | null; changedAt: Date | null; ok: boolean; message: string | null };

export async function getSyncStatus(pool: Pick<Pool, "query">): Promise<SyncStatus | null> {
  const r = await pool.query<SyncStatus>(
    `select checked_at as "checkedAt", changed_at as "changedAt", ok, message from sync_status where name = $1`,
    [SYNC_NAME],
  );
  return r.rows[0] ?? null;
}

import type { Pool } from "pg";
import { withTx, type Queryable } from "../sql";
import type { ParseResult } from "./parse";
import { applyBirthdateFixes } from "../birthdate-fix";

// Replaces TeamSnap's registrations in one transaction (players added in the app stay); players no longer registered
// come off their teams. Refuses if the file had errors,
// so a bad file never clears the old data.
export async function importRegistrations(
  pool: Pool,
  parsed: ParseResult,
  importedBy: string,
  now: Date,
): Promise<{ imported: number }> {
  return withTx(pool, (q) => replaceRegistrations(q, parsed, importedBy, now));
}

// Same, inside a transaction the caller already opened.
export async function replaceRegistrations(
  q: Queryable,
  parsed: ParseResult,
  importedBy: string,
  now: Date,
): Promise<{ imported: number }> {
  if (parsed.errors.length) throw new Error(`File has ${parsed.errors.length} error(s); nothing was changed.`);
  if (!parsed.players.length) throw new Error("No players in the file; nothing was changed.");
  const rows = parsed.players.map((p) => ({ ...p, imported_at: now.toISOString(), imported_by: importedBy }));
  await q.query("delete from registrations where added_by is null"); // players added in the app stay
  const r = await q.query("insert into registrations select * from jsonb_populate_recordset(null::registrations, $1)", [
    JSON.stringify(rows),
  ]);
  await applyBirthdateFixes(q, true); // birthdays fixed in the app stay fixed
  // A player no longer in registrations comes off every roster (with their uniform there); past check-ins stay.
  await q.query(
    "delete from team_players p where not exists (select 1 from registrations g where g.registrant_id = p.registrant_id)",
  );
  await q.query(
    "delete from team_uniforms u where not exists (select 1 from registrations g where g.registrant_id = u.registrant_id)",
  );
  // A hand import overrides the sheet until the sheet changes again.
  await q.query("update sync_status set source_hash = null where name = 'registrations'");
  return { imported: r.rowCount ?? 0 };
}

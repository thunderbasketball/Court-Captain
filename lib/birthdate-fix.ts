// Fixing a player's birthday in the app (SPEC.md section 14, To remove later: until registrations are taken here).
// Registrations come from the sheet and are replaced on every sync, so a fix is kept in birthdate_fixes and put back
// after each sync (applyBirthdateFixes). Once the sheet says the same date, the fix is dropped. Thunder's Owners,
// Admins and Directors of Players.
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { hasArea } from "./org-admin";
import { withTx, type Queryable } from "./sql";
import { easternDate } from "./time";

type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

// After the sheet's rows are in: drop fixes the sheet now agrees with, note what the sheet says, then put fixes back.
export async function applyBirthdateFixes(q: Pick<Queryable, "query">, freshFromSheet: boolean): Promise<void> {
  if (freshFromSheet) {
    await q.query(
      `delete from birthdate_fixes f using registrations g
        where g.registrant_id = f.registrant_id and g.added_by is null and g.birthdate = f.birthdate`,
    );
    await q.query(
      `update birthdate_fixes f set sheet_birthdate = g.birthdate from registrations g
        where g.registrant_id = f.registrant_id and g.added_by is null and f.sheet_birthdate is distinct from g.birthdate`,
    );
  }
  await q.query(
    `update registrations g set birthdate = f.birthdate from birthdate_fixes f
      where g.registrant_id = f.registrant_id and g.birthdate is distinct from f.birthdate`,
  );
}

export type BirthdateFix = { setBy: string; sheetBirthdate: string | null };

// Players with a fixed birthday: who fixed it and what the sheet says.
export async function birthdateFixes(q: Pick<Queryable, "query">): Promise<Map<string, BirthdateFix>> {
  const r = await q.query<{ id: string; set_by: string; sheet: string | null }>(
    "select registrant_id as id, set_by, to_char(sheet_birthdate, 'YYYY-MM-DD') as sheet from birthdate_fixes",
  );
  return new Map(r.rows.map((x) => [x.id, { setBy: x.set_by, sheetBirthdate: x.sheet }]));
}

// Fix a player's birthday (YYYY-MM-DD), or (null) go back to what the sheet says.
export async function fixBirthdate(
  deps: { pool: Pool; now: () => Date },
  viewer: SessionUser,
  registrantId: unknown,
  date: unknown,
): Promise<Result> {
  if (!hasArea(viewer, "players")) return { ok: false, message: "Only an Admin or Director of Players can fix birthdays." };
  if (typeof registrantId !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(registrantId))
    return { ok: false, message: "That player isn't registered." };
  let day: string | null = null;
  if (date !== null) {
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T12:00:00Z`)))
      return { ok: false, message: "Pick the birthday." };
    const today = easternDate(deps.now());
    const year = Number(date.slice(0, 4));
    if (date > today || year < Number(today.slice(0, 4)) - 25) return { ok: false, message: "That birthday doesn't look right." };
    day = date;
  }
  const by = `${viewer.firstName} ${viewer.lastName}`;
  return withTx(deps.pool, async (q) => {
    const g = await q.query<{ birthdate: string | null; fixed: string | null; sheet: string | null }>(
      `select to_char(g.birthdate, 'YYYY-MM-DD') as birthdate, to_char(f.birthdate, 'YYYY-MM-DD') as fixed,
              to_char(f.sheet_birthdate, 'YYYY-MM-DD') as sheet
         from registrations g left join birthdate_fixes f on f.registrant_id = g.registrant_id
        where g.registrant_id = $1 for update of g`,
      [registrantId],
    );
    const row = g.rows[0];
    if (!row) return { ok: false as const, message: "That player isn't registered." };
    const sheet = row.fixed ? row.sheet : row.birthdate; // what the sheet says
    if (day === null || day === sheet) {
      await q.query("delete from birthdate_fixes where registrant_id = $1", [registrantId]);
      await q.query("update registrations set birthdate = $2 where registrant_id = $1", [registrantId, sheet]);
      return { ok: true as const };
    }
    await q.query(
      `insert into birthdate_fixes (registrant_id, birthdate, sheet_birthdate, set_by, set_at) values ($1, $2, $3, $4, $5)
       on conflict (registrant_id) do update set birthdate = $2, set_by = $4, set_at = $5`,
      [registrantId, day, sheet, by, deps.now()],
    );
    await q.query("update registrations set birthdate = $2 where registrant_id = $1", [registrantId, day]);
    return { ok: true as const };
  });
}

// Players added in the app (SPEC.md section 14): a side registration next to TeamSnap's, for a player who didn't register
// there (a scholarship, a late add). They're stored with TeamSnap's registrations, so they show everywhere those do
// (Players, Families, rosters, uniforms, Home metrics), marked "Added in app"; the sheet sync never removes them.
// Owners, Admins and Directors of Players add them, and may waive their fees.
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { cleanEmail, cleanName } from "./auth/validate";
import { hasFeature } from "./features";
import { hasArea } from "./org-admin";
import { normalizeCell } from "./phone";
import { withTx } from "./sql";
import { SIZES } from "./uniform-fields";

type Deps = { pool: Pool; now: () => Date };
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

export type AddedPlayerInput = {
  first: unknown;
  last: unknown;
  gender: unknown;
  grade: unknown; // "K", "1" … "12"
  birthdate: unknown; // YYYY-MM-DD, optional
  parentFirst: unknown;
  parentLast: unknown;
  parentCell: unknown;
  parentEmail: unknown; // optional
  uniformSize: unknown; // optional: they want a uniform in this size
  waive: unknown; // true: fees waived
  fee: unknown; // the fee when not waived, in dollars (optional)
  notes: unknown; // optional
};

const NOT_ALLOWED = "Only an Owner, Admin or Director of Players can add players.";
const by = (v: SessionUser) => `${v.firstName} ${v.lastName}`;
const mayAdd = async (deps: Deps, viewer: SessionUser) =>
  hasArea(viewer, "players") && (await hasFeature(deps.pool, "thunder", "player-registration"));
const ordinal = (g: string) => (g === "K" ? "Kindergarten" : `${g}${["", "st", "nd", "rd"][Number(g)] ?? "th"}`);
// Notes: plain text, never a spreadsheet formula.
const cleanNote = (v: unknown) => {
  const s = typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "";
  return s ? s.replace(/^[=+\-@]+/, "").slice(0, 300) || null : null;
};

export async function addPlayer(deps: Deps, viewer: SessionUser, input: AddedPlayerInput): Promise<Result<{ id: string }>> {
  if (!(await mayAdd(deps, viewer))) return { ok: false, message: NOT_ALLOWED };
  const first = cleanName(input.first);
  const last = cleanName(input.last);
  if (!first || !last) return { ok: false, message: "Enter the player's first and last name." };
  const gender = input.gender === "Boys" || input.gender === "Girls" ? input.gender : null;
  if (!gender) return { ok: false, message: "Pick Boys or Girls." };
  const grade = typeof input.grade === "string" && /^(K|[1-9]|1[0-2])$/.test(input.grade) ? input.grade : null;
  if (!grade) return { ok: false, message: "Pick a grade." };
  let birthdate: string | null = null;
  if (typeof input.birthdate === "string" && input.birthdate.trim()) {
    const d = input.birthdate.trim();
    const t = new Date(`${d}T12:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(t.getTime()) || t > deps.now() || t.getUTCFullYear() < 1990)
      return { ok: false, message: "Birthdate: a real date in the past." };
    birthdate = d;
  }
  const parentFirst = cleanName(input.parentFirst);
  const parentLast = cleanName(input.parentLast);
  const parentCell = normalizeCell(typeof input.parentCell === "string" ? input.parentCell : "");
  if (!parentFirst || !parentLast || !parentCell)
    return { ok: false, message: "Enter a parent's first name, last name and 10-digit cell." };
  const emailText = typeof input.parentEmail === "string" ? input.parentEmail.trim() : "";
  const parentEmail = emailText ? cleanEmail(emailText) : null;
  if (emailText && !parentEmail) return { ok: false, message: "That email doesn't look right." };
  const size = typeof input.uniformSize === "string" && input.uniformSize ? input.uniformSize : null;
  if (size && !(SIZES as readonly string[]).includes(size)) return { ok: false, message: "Pick a uniform size from the list." };
  const waive = input.waive === true;
  let fee: number | null = null;
  if (!waive && typeof input.fee === "string" && input.fee.trim()) {
    const f = Number(input.fee.trim().replace(/^\$/, ""));
    if (!Number.isFinite(f) || f < 0 || f > 10_000) return { ok: false, message: "Fee: an amount in dollars, like 150." };
    fee = Math.round(f * 100) / 100;
  }
  const notes = cleanNote(input.notes);

  return withTx(deps.pool, async (q) => {
    // One add at a time, so the same player can't be added twice by two taps.
    await q.query("select pg_advisory_xact_lock(hashtext('added-players'))");
    const same = await q.query(
      `select 1 from registrations where lower(first_name) = lower($1) and lower(last_name) = lower($2)
         and (birthdate = $3::date or ($3::date is null and grade = $4))`,
      [first, last, birthdate, grade],
    );
    if (same.rowCount) return { ok: false as const, message: `${first} ${last} is already registered.` };
    const id = `app-${(await q.query<{ n: string }>("select nextval('added_player_seq')::text as n")).rows[0].n}`;
    const now = deps.now();
    await q.query(
      `insert into registrations (registrant_id, registration_id, first_name, last_name, birthdate, gender, grade, grade_sort, program,
                                  parent1_first, parent1_last, parent1_email, parent1_cell, uniform_needed, uniform_size,
                                  total_fees, amount_paid, amount_remaining, notes, registered_at, raw, imported_at, imported_by,
                                  added_by, added_at, fees_waived_by, fees_waived_at)
       values ($1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, '{}', $19, $20, $20, $19, $21, $22)`,
      [
        id,
        first,
        last,
        birthdate,
        gender,
        grade,
        grade === "K" ? 0 : Number(grade),
        `${ordinal(grade)} ${gender}`,
        parentFirst,
        parentLast,
        parentEmail,
        parentCell,
        size !== null,
        size,
        fee,
        fee === null ? null : 0,
        fee,
        notes ? [notes] : [],
        now,
        by(viewer),
        waive ? by(viewer) : null,
        waive ? now : null,
      ],
    );
    return { ok: true as const, id };
  });
}

// Remove a player added in the app (TeamSnap's come and go with the sheet). Not while they're on a team.
export async function removeAddedPlayer(deps: Deps, viewer: SessionUser, id: unknown): Promise<Result> {
  if (!(await mayAdd(deps, viewer))) return { ok: false, message: NOT_ALLOWED };
  if (typeof id !== "string" || !/^app-\d{1,18}$/.test(id))
    return { ok: false, message: "That player isn't one added in the app." };
  return withTx(deps.pool, async (q) => {
    const p = await q.query<{ name: string }>(
      "select first_name || ' ' || last_name as name from registrations where registrant_id = $1 and added_by is not null for update",
      [id],
    );
    if (!p.rowCount) return { ok: false as const, message: "That player isn't one added in the app." };
    const team = await q.query<{ name: string }>(
      "select t.name from team_players tp join teams t on t.id = tp.team_id where tp.registrant_id = $1 limit 1",
      [id],
    );
    if (team.rowCount) return { ok: false as const, message: `Take ${p.rows[0].name} off ${team.rows[0].name} first.` };
    await q.query("select set_config('app.remove_added_player', 'on', true)"); // this transaction only
    await q.query("delete from registrations where registrant_id = $1", [id]);
    return { ok: true as const };
  });
}

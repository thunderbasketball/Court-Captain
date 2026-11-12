// Player programs (CourtPlayers; SPEC.md section 14, step 2c): a Season players register for. Its Owners, Admins and
// Directors of Events add and change them: name, registration dates, payment dates, and season dates typed in or taken
// from a team program (a League, Circuit or Tournament its teams play in).
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { hasFeature } from "./features";
import { orgHasArea } from "./org-admin";
import type { Queryable } from "./sql";
import { easternDate } from "./time";

type Deps = { pool: Pool; now: () => Date };
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

export type PlayerProgramInput = {
  name: unknown;
  regOpens: unknown;
  regCloses: unknown; // "" = open until the season ends
  payOpens: unknown;
  payCloses: unknown;
  seasonFrom: unknown; // a team program's id, or "" to type the dates
  startsOn: unknown;
  endsOn: unknown;
};
export type PlayerProgramFields = {
  id: string;
  name: string;
  regOpens: string;
  regCloses: string;
  payOpens: string;
  payCloses: string;
  seasonFrom: string;
  startsOn: string;
  endsOn: string;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (v: unknown): v is string => typeof v === "string" && DATE.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`));
const optDate = (v: unknown): string | null | undefined => (v === "" || v === null || v === undefined ? null : isDate(v) ? v : undefined);
const isId = (v: unknown): v is string => typeof v === "string" && /^\d{1,18}$/.test(v);
const by = (v: SessionUser) => `${v.firstName} ${v.lastName}`;

// Who may add and change an organization's player programs.
export async function managesPlayerPrograms(q: Pick<Queryable, "query">, viewer: SessionUser, org: string): Promise<boolean> {
  return (await hasFeature(q, org, "player-registration")) && (await orgHasArea(q, viewer.coachId, org, "events"));
}

// The team programs a season can take its dates from: Leagues, Circuits and Tournaments not ended yet, soonest first.
export async function seasonSources(q: Pick<Queryable, "query">, now: Date, keep: string | null = null) {
  const r = await q.query<{ id: string; name: string; startsOn: string; endsOn: string }>(
    `select id::text, name, to_char(starts_on, 'YYYY-MM-DD') as "startsOn", to_char(ends_on, 'YYYY-MM-DD') as "endsOn"
     from scenic_programs where ends_on >= $1::date or id::text = $2 order by starts_on, lower(name)`,
    [easternDate(now), keep],
  );
  return r.rows;
}

// A player program's fields for its form.
export async function playerProgramFields(q: Pick<Queryable, "query">, org: string, id: string): Promise<PlayerProgramFields | null> {
  if (!isId(id)) return null;
  const d = (c: string) => `coalesce(to_char(${c}, 'YYYY-MM-DD'), '')`;
  const r = await q.query<PlayerProgramFields>(
    `select id::text, name, ${d("reg_opens")} as "regOpens", ${d("reg_closes")} as "regCloses", ${d("pay_opens")} as "payOpens",
            ${d("pay_closes")} as "payCloses", coalesce(season_from::text, '') as "seasonFrom", ${d("starts_on")} as "startsOn",
            ${d("ends_on")} as "endsOn"
     from player_programs where id = $1 and org = $2`,
    [id, org],
  );
  return r.rows[0] ?? null;
}

// Add (id null) or change a player program. Returns its id.
export async function savePlayerProgram(
  deps: Deps,
  viewer: SessionUser,
  org: string,
  id: unknown,
  input: PlayerProgramInput,
): Promise<Result<{ id: string }>> {
  if (!(await managesPlayerPrograms(deps.pool, viewer, org)))
    return { ok: false, message: "Only an Admin or a Director of Events of this organization can change its programs." };
  if (id !== null && !isId(id)) return { ok: false, message: "That program no longer exists." };
  const name = typeof input.name === "string" ? input.name.trim().replace(/\s+/g, " ") : "";
  if (!name || name.length > 80) return { ok: false, message: "Give the program a name (up to 80 letters)." };
  if (!isDate(input.regOpens)) return { ok: false, message: "Pick the day registration opens." };
  const regCloses = optDate(input.regCloses);
  const payOpens = optDate(input.payOpens);
  const payCloses = optDate(input.payCloses);
  if (regCloses === undefined || payOpens === undefined || payCloses === undefined)
    return { ok: false, message: "Check the dates." };
  if (regCloses && regCloses < input.regOpens) return { ok: false, message: "Registration can't close before it opens." };
  if ((payOpens === null) !== (payCloses === null)) return { ok: false, message: "Give both payment dates, or neither." };
  if (payOpens && payCloses && payCloses < payOpens) return { ok: false, message: "Payments can't close before they open." };

  let seasonFrom: string | null = null;
  let startsOn: string | null = null;
  let endsOn: string | null = null;
  if (input.seasonFrom) {
    if (!isId(input.seasonFrom)) return { ok: false, message: "Pick the program its season follows." };
    const s = await deps.pool.query("select 1 from scenic_programs where id = $1", [input.seasonFrom]);
    if (!s.rowCount) return { ok: false, message: "That program no longer exists." };
    seasonFrom = input.seasonFrom;
  } else {
    if (!isDate(input.startsOn) || !isDate(input.endsOn)) return { ok: false, message: "Give the season's first and last days." };
    if (input.endsOn < input.startsOn) return { ok: false, message: "The season can't end before it starts." };
    startsOn = input.startsOn;
    endsOn = input.endsOn;
  }

  const values = [name, input.regOpens, regCloses, payOpens, payCloses, seasonFrom, startsOn, endsOn, by(viewer), deps.now()];
  try {
    if (id === null) {
      const r = await deps.pool.query<{ id: string }>(
        `insert into player_programs (org, name, reg_opens, reg_closes, pay_opens, pay_closes, season_from, starts_on, ends_on,
                                      created_by, created_at)
         values ($11, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id::text`,
        [...values, org],
      );
      return { ok: true, id: r.rows[0].id };
    }
    const r = await deps.pool.query(
      `update player_programs set name = $1, reg_opens = $2, reg_closes = $3, pay_opens = $4, pay_closes = $5, season_from = $6,
              starts_on = $7, ends_on = $8, updated_by = $9, updated_at = $10
       where id = $11 and org = $12`,
      [...values, id, org],
    );
    if (!r.rowCount) return { ok: false, message: "That program no longer exists." };
    return { ok: true, id: id as string };
  } catch (e) {
    if ((e as { code?: string }).code === "23505") return { ok: false, message: `There's already a program named ${name}.` };
    throw e;
  }
}

// Delete a player program, only while it's empty: no registrations and no Sessions.
export async function deletePlayerProgram(deps: Deps, viewer: SessionUser, org: string, id: unknown): Promise<Result> {
  if (!(await managesPlayerPrograms(deps.pool, viewer, org)))
    return { ok: false, message: "Only an Admin or a Director of Events of this organization can change its programs." };
  if (!isId(id)) return { ok: false, message: "That program no longer exists." };
  const r = await deps.pool.query(
    `delete from player_programs p where p.id = $1 and p.org = $2
       and not exists (select 1 from registrations r where r.program_id = p.id)
       and not exists (select 1 from events e where e.program_id = p.id)`,
    [id, org],
  );
  if (r.rowCount) return { ok: true };
  const there = await deps.pool.query("select 1 from player_programs where id = $1 and org = $2", [id, org]);
  return there.rowCount
    ? { ok: false, message: "This program has players or Sessions, so it can't be deleted." }
    : { ok: false, message: "That program no longer exists." };
}

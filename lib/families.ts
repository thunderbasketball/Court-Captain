import "server-only";
import { db } from "./db";
import type { SessionUser } from "./auth/service";
import { buildFamilies, type Family, type RegRow } from "./family-build";
import { hasArea } from "./org-admin";

export type { Family };

// Members → Families and a Family login's home: families built from registrations (lib/family-build.ts).
async function allFamilies(): Promise<Family[]> {
  const r = await db.query<RegRow>(
    `select r.registrant_id as "registrantId", r.registration_id as "registrationId", r.first_name as first, r.last_name as last,
            r.gender, r.grade, r.grade_sort as "gradeSort", to_char(r.birthdate, 'YYYY-MM-DD') as birthdate,
            (select t.name from team_players p join teams t on t.id = p.team_id where p.registrant_id = r.registrant_id
             order by t.name limit 1) as team,
            r.uniform_size as "uniformSize", r.uniform_number as "uniformNumber",
            json_build_array(
              json_build_object('first', r.parent1_first, 'last', r.parent1_last, 'cell', r.parent1_cell, 'email', r.parent1_email),
              json_build_object('first', r.parent2_first, 'last', r.parent2_last, 'cell', r.parent2_cell, 'email', r.parent2_email)
            ) as parents,
            nullif(concat_ws(', ', nullif(trim(r.address), ''), nullif(trim(r.city), ''),
                             nullif(trim(concat_ws(' ', nullif(trim(r.state), ''), nullif(trim(r.zip), ''))), '')), '') as address,
            r.registered_at::text as "registeredAt",
            r.total_fees::float8 as "totalFees", r.amount_paid::float8 as "amountPaid", r.amount_remaining::float8 as "amountRemaining"
     from registrations r`,
  );
  const logins = await db.query<{ cell: string; name: string }>(
    "select cell, first_name || ' ' || last_name as name from users where active",
  );
  return buildFamilies(r.rows, new Map(logins.rows.map((u) => [u.cell, u.name])));
}

// Members → Families (Directors of Players or Teams, Admins).
export async function listFamilies(viewer: SessionUser): Promise<Family[]> {
  if (!hasArea(viewer, "players", "teams")) throw new Error("Director only");
  return allFamilies();
}

// A Family login's own family: the one where one of its guardians has this login's cell.
export async function familyOf(coachId: string): Promise<Family | null> {
  const u = await db.query<{ cell: string }>("select cell from users where coach_id = $1", [coachId]);
  const cell = u.rows[0]?.cell;
  if (!cell) return null;
  return (await allFamilies()).find((f) => f.guardians.some((g) => g.cell === cell)) ?? null;
}

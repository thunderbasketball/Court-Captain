// A team's current registrations (events that haven't ended, not taken out), for its card on the Teams list: "✓ Winter
// (26/27) · Paid" under its name (Thunder's and every organization's teams).
import type { Queryable } from "./sql";
import { easternDate } from "./time";

export type CurrentRegistration = { program: string; paid: boolean };

// By the team's id in its organization: `thunder` for Thunder's teams (teams), else an organization's (org_teams).
export async function currentRegistrations(
  q: Pick<Queryable, "query">,
  kind: "thunder" | "org",
  ids: string[],
  now: Date,
): Promise<Record<string, CurrentRegistration[]>> {
  if (!ids.length) return {};
  const col = kind === "thunder" ? "st.thunder_team_id" : "st.org_team_id";
  const r = await q.query<{ id: string; program: string; paid: boolean }>(
    `select ${col}::text as id, p.name as program, r.paid from scenic_registrations r
       join scenic_teams st on st.id = r.team_id join scenic_programs p on p.id = r.program_id
      where ${col} = any($1::bigint[]) and p.ends_on >= $2::date and r.removed_by is null
      order by p.starts_on, lower(p.name)`,
    [ids, easternDate(now)],
  );
  const out: Record<string, CurrentRegistration[]> = {};
  for (const x of r.rows) (out[x.id] ??= []).push({ program: x.program, paid: x.paid });
  return out;
}

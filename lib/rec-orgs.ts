// Who may have REC teams (SPEC.md section 13, REC open to): CourtSync with teams of its own (CourtOrg, or CourtPlayers)
// is the basis (no CourtSync, no REC). With it, an organization makes REC teams while a current Scenic City League (not ended yet) has REC open to everyone or has picked
// it for REC; no current League: nothing more limits it. COMP is always open. Thunder's own teams aren't limited here.
import type { Queryable } from "./sql";
import { REC_ORG_SQL } from "./scenic-programs";
import { easternDate } from "./time";

export const REC_CLOSED =
  "REC is only for organizations with CourtSync that a League has invited to REC. Make it COMP, or ask Scenic City to add you.";

export async function recAllowed(q: Pick<Queryable, "query">, org: string, now: Date): Promise<boolean> {
  const r = await q.query<{ ok: boolean }>(
    `select ${REC_ORG_SQL("$1")}
        and (not exists (select 1 from scenic_programs p where p.kind = 'League' and p.ends_on >= $2::date)
         or exists (select 1 from scenic_programs p
                     where p.kind = 'League' and p.ends_on >= $2::date
                       and (p.rec_limited_by is null
                            or exists (select 1 from scenic_program_rec_partners x join partners pa on pa.id = x.partner_id
                                        where x.program_id = p.id and pa.org_slug = $1)))) as ok`,
    [org, easternDate(now)],
  );
  return r.rows[0]?.ok ?? false;
}

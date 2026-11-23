// Thunder's teams in Scenic City programs (SPEC.md section 14), like every organization's: Thunder's Directors of Teams
// register its teams (all unregistered ones at once, as ALL Season). Each team gets a copy in Scenic City under Thunder's
// partner record, named like every organization's team: grade and gender, its Alternate name (else Thunder's short
// name), its Head Coach's last name ("4G Thunder Epps"); read-only there and kept in step with the team.
import type { Pool, PoolClient } from "pg";
import type { SessionUser } from "./auth/service";
import { hasFeature } from "./features";
import { hasArea } from "./org-admin";
import { partnerFor, type OrgProgram } from "./org-leagues";
import { orgName, orgShort } from "./org-registry";
import { lastBatches } from "./register-batches";
import { previewTx, programRegStatus, registerBatch, type BatchPay, type BatchResult } from "./scenic-programs";
import { easternDate } from "./time";

type Deps = { pool: Pool; now: () => Date };
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };
const LEAGUE = "scenic-city";
const by = (v: SessionUser) => `${v.firstName} ${v.lastName}`;
const isId = (v: unknown): v is string => typeof v === "string" && /^\d{1,18}$/.test(v);
const regOpen = (today: string, opens: string, closes: string) =>
  today < opens ? "upcoming" : today > closes ? "closed" : "open";

// A Thunder team's name in leagues (SQL on its `teams` row): "5B Johnson" → "5B Thunder Johnson": its Alternate name in
// Thunder's place when it has one, else Thunder's Default Alternate name, else Thunder's short name.
const COPY_NAME = (t: string) =>
  `regexp_replace(${t}.name, '^(\\S+)\\s+', '\\1 ' || coalesce(nullif(trim(${t}.alt_name), ''),
     (select coalesce(default_alt_name, short_name) from organizations where slug = 'thunder'), 'Thunder') || ' ')`;

// The copy of a Thunder team in Scenic City, made or brought up to date: its name (COPY_NAME), gender,
// grade (one, or two in a row; a wider team plays as its top grade), level and Head Coach.
async function thunderCopy(q: PoolClient, teamId: string, partnerId: string, byName: string, now: Date): Promise<string> {
  const r = await q.query<{ id: string }>(
    `with t as (
       select t.id, t.name, t.alt_name, t.gender, t.level,
              (select min(case g when 'K' then 0 else g::int end) from unnest(t.grades) g) as lo,
              (select max(case g when 'K' then 0 else g::int end) from unnest(t.grades) g) as hi,
              (select s.coach_id from team_staff s where s.team_id = t.id and s.role = 'HeadCoach') as head
       from teams t where t.id = $1)
     insert into scenic_teams (name, gender, grade_low, grade, level, partner_id, coach_id, created_by, created_at, updated_by, updated_at, thunder_team_id)
     select ${COPY_NAME("t")}, t.gender,
            case when t.hi - t.lo > 1 then t.hi else t.lo end, t.hi, t.level, $2, t.head, $3, $4, $3, $4, t.id from t
     on conflict (thunder_team_id) do update set name = excluded.name, gender = excluded.gender, grade_low = excluded.grade_low,
       grade = excluded.grade, level = excluded.level, partner_id = excluded.partner_id, coach_id = excluded.coach_id
     returning id::text`,
    [teamId, partnerId, byName, now],
  );
  return r.rows[0].id;
}

// The Register tab: Scenic City's programs whose registration hasn't closed, with how many of Thunder's teams are in.
export async function thunderPrograms(
  deps: Deps,
  viewer: SessionUser,
): Promise<{ league: string; leagueName: string; programs: OrgProgram[] } | null> {
  if (!hasArea(viewer, "teams") || !(await hasFeature(deps.pool, LEAGUE, "programs"))) return null;
  const today = easternDate(deps.now());
  const r = await deps.pool.query<Omit<OrgProgram, "status" | "lastBatch">>(
    `select p.id::text, p.kind, p.name, p.starts_on::text as "startsOn", p.ends_on::text as "endsOn",
            p.reg_opens::text as "regOpens", p.reg_closes::text as "regCloses", p.fee_cents as "feeCents",
            count(r.team_id)::int as registered, (count(t.id) - count(r.team_id))::int as unregistered
     from scenic_programs p
     left join teams t on true
     left join scenic_teams st on st.thunder_team_id = t.id
     left join scenic_registrations r on r.program_id = p.id and r.team_id = st.id
     where p.reg_closes >= $1::date
     group by p.id order by p.starts_on, lower(p.name)`,
    [today],
  );
  const last = await lastBatches(deps.pool, "thunder");
  return {
    league: await orgShort(deps.pool, LEAGUE),
    leagueName: await orgName(deps.pool, LEAGUE),
    programs: r.rows.map((p) => ({
      ...p,
      status: regOpen(today, p.regOpens, p.regCloses) as OrgProgram["status"],
      lastBatch: last.get(p.id) ?? null,
    })),
  };
}

// Register every Thunder team not in the program yet, each into its division (as ALL Season); skipped ones say why.
// `preview`: what it would do, nothing kept (the confirmation before Register all); otherwise one batch Undo can take out.
export async function registerAllThunderTeams(
  deps: Deps,
  viewer: SessionUser,
  programId: unknown,
  preview = false,
  only?: unknown, // the teams left checked in the confirmation
  pay?: BatchPay | null, // the League takes cards: one payment for all, registered once it's paid
): Promise<Result<BatchResult>> {
  if (!hasArea(viewer, "teams")) return { ok: false, message: "Only a Director of Teams can register teams." };
  if (!isId(programId)) return { ok: false, message: "Pick a program." };
  return previewTx(
    deps.pool,
    async (q) => {
      const status = await programRegStatus(q, programId, deps.now());
      if (!status) return { ok: false as const, message: "That program no longer exists." };
      if (status !== "open") return { ok: false as const, message: "Registration isn't open for this program." };
      const teams = await q.query<{ id: string; name: string }>(
        `select t.id::text, t.name from teams t
         where not exists (select 1 from scenic_teams st join scenic_registrations r on r.team_id = st.id
                           where st.thunder_team_id = t.id and r.program_id = $1)
         order by t.gender, t.grade_sort, t.name for update`,
        [programId],
      );
      const partnerId = await partnerFor(q, "thunder", by(viewer));
      const now = deps.now();
      const r = await registerBatch(
        q,
        { programId, org: "thunder", viewer, now, preview, only, pay },
        teams.rows.map((t) => ({ id: t.id, name: t.name, teamId: () => thunderCopy(q, t.id, partnerId, by(viewer), now) })),
      );
      return { ok: true as const, ...r };
    },
    (r) => ({ ok: true as const, ...r }),
  );
}

// Every Thunder team's copy named again (after Thunder's Default Alternate name changes).
export async function syncThunderCopyNames(q: Pick<PoolClient, "query">) {
  await q.query(`update scenic_teams st set name = ${COPY_NAME("t")} from teams t where st.thunder_team_id = t.id`);
}

// After a Thunder team's name, Alternate name or Head Coach changes: its copy in Scenic City follows.
export async function syncThunderCopy(q: Pick<PoolClient, "query">, teamId: string) {
  await q.query(
    `update scenic_teams st set name = ${COPY_NAME("t")},
            coach_id = (select s.coach_id from team_staff s where s.team_id = t.id and s.role = 'HeadCoach')
     from teams t where st.thunder_team_id = t.id and t.id = $1`,
    [teamId],
  );
}

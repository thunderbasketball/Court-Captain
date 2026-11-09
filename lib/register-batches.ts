// Undo a Register all (SPEC: Registering teams). Each Register all is one batch (registerBatch in lib/scenic-programs).
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { hasArea } from "./org-admin";
import { teamsManagerOf } from "./org-teams";
import { isProgramsDirector, programRegStatus } from "./scenic-programs";
import { withTx, type Queryable } from "./sql";

type Deps = { pool: Pool; now: () => Date };
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

const by = (v: SessionUser) => `${v.firstName} ${v.lastName}`;
const isId = (v: unknown): v is string => typeof v === "string" && /^\d{1,18}$/.test(v);

export type LastBatch = {
  id: string;
  teams: number; // registered by it
  by: string;
  at: string;
  undoneBy: string | null;
  undoneAt: string | null;
  names: string[]; // its teams still registered
};

// The latest Register all of these teams (`org`) into each program, not undone and with teams still in it (each named),
// for the Register tab's Undo.
export async function lastBatches(q: Pick<Queryable, "query">, org: string): Promise<Map<string, LastBatch>> {
  const r = await q.query<LastBatch & { programId: string }>(
    `select distinct on (program_id) program_id::text as "programId", id::text, teams, done_by as by,
            done_at::text as at, undone_by as "undoneBy", undone_at::text as "undoneAt",
            array(select n.name from scenic_registrations r join scenic_teams st on st.id = r.team_id
                    left join org_teams ot on ot.id = st.org_team_id left join teams th on th.id = st.thunder_team_id
                    cross join lateral (select coalesce(ot.name, th.name, st.name) as name) n
                  where r.batch_id = b.id order by lower(n.name)) as names -- the organization's own team names
     from scenic_register_batches b
     where org = $1 and undone_at is null and exists (select 1 from scenic_registrations r where r.batch_id = b.id)
     order by program_id, done_at desc, id desc`,
    [org],
  );
  return new Map(r.rows.map(({ programId, ...b }) => [programId, b]));
}

// Who may undo: the same people who may Register all for those teams (Scenic City's own: whoever did it), and a Scenic
// City Director of Programs.
async function mayUndo(q: Queryable, viewer: SessionUser, org: string, doneById: string): Promise<boolean> {
  if (await isProgramsDirector(q, viewer)) return true;
  if (org === "thunder") return hasArea(viewer, "teams");
  if (org === "scenic-city") return doneById === viewer.coachId;
  return !!(await teamsManagerOf(q, viewer, org));
}

// Undo a Register all: its teams come out of the program (as Withdraw does), except any marked paid since. While the
// program's registration is open (a Director of Programs any time).
export async function undoRegisterAll(
  deps: Deps,
  viewer: SessionUser,
  batchId: unknown,
): Promise<Result<{ removed: number; kept: string[] }>> {
  if (!isId(batchId)) return { ok: false, message: "Pick a Register all to undo." };
  return withTx(deps.pool, async (q) => {
    const b = (
      await q.query<{ program_id: string; org: string; done_by_id: string; undone_at: Date | null }>(
        "select program_id::text, org, done_by_id, undone_at from scenic_register_batches where id = $1 for update",
        [batchId],
      )
    ).rows[0];
    if (!b) return { ok: false as const, message: "That Register all no longer exists." };
    if (!(await mayUndo(q, viewer, b.org, b.done_by_id)))
      return { ok: false as const, message: "Only whoever may register these teams can undo it." };
    if (b.undone_at) return { ok: false as const, message: "That Register all was already undone." };
    const status = await programRegStatus(q, b.program_id, deps.now());
    if (status !== "open" && !(await isProgramsDirector(q, viewer)))
      return { ok: false as const, message: "Registration is closed. Ask a Scenic City Director of Programs." };
    const kept = await q.query<{ name: string }>(
      `select st.name from scenic_registrations r join scenic_teams st on st.id = r.team_id
       where r.batch_id = $1 and r.paid order by lower(st.name)`,
      [batchId],
    );
    const del = await q.query("delete from scenic_registrations where batch_id = $1 and not paid", [batchId]);
    await q.query("update scenic_register_batches set undone_by = $2, undone_at = $3 where id = $1", [
      batchId,
      by(viewer),
      deps.now(),
    ]);
    return { ok: true as const, removed: del.rowCount ?? 0, kept: kept.rows.map((r) => r.name) };
  });
}

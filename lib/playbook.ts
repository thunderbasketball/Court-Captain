// CourtPlaybook (SPEC.md section 14): plays by type (Offense, Defense, Inbounds, Drills), each with its name, notes and
// drawing. Two kinds of playbook, the same rules for both:
// - a team's: its coaches see and change it, and so do the organization's Directors of Teams and Admins;
// - the organization's own (teamId ""): its Owners and Admins keep it.
// A team's play can be shared with the organization; the organization's plays and those shared by its teams make its
// library, which its teams' coaches copy from (and its Admins copy into the organization's playbook). Players and
// parents don't see plays (for now). Who added, changed or shared each is recorded.
import type { Pool, PoolClient } from "pg";
import type { SessionUser } from "./auth/service";
import { hasFeature } from "./features";
import { hasArea, isOrgAdmin, orgHasArea } from "./org-admin";
import type { OrgSlug } from "./orgs";
import { PLAY_KINDS, type PlayKind } from "./play-kinds";
import { cleanFrames, type Frame } from "./play-diagram";

export { PLAY_KINDS, type PlayKind };

type Q = Pick<PoolClient, "query">;
type Deps = { pool: Pool; now: () => Date };
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

// Whose playbook: a team's, or (teamId "") the organization's own.
export type TeamRef = { org: string; teamId: string };
export type Play = {
  id: string;
  name: string;
  kind: PlayKind;
  notes: string;
  frames: Frame[];
  addedBy: string;
  changedBy: string | null;
  sharedBy: string | null; // a team's play shared with the organization
};
// A play in the organization's library: its own (team null) or one a team shared.
export type LibraryPlay = Play & { team: string | null; teamId: string | null };
export type PlayInput = { name?: unknown; kind?: unknown; notes?: unknown; frames?: unknown }; // frames: its drawing

const SLUG = /^[a-z0-9-]{1,40}$/;
const ID = /^\d{1,18}$/;
const isOrgBook = (ref: TeamRef) => ref.teamId === "";
const validRef = (ref: TeamRef) => SLUG.test(String(ref.org)) && (isOrgBook(ref) || ID.test(String(ref.teamId)));
const teamCol = (org: string) => (org === "thunder" ? "thunder_team_id" : "org_team_id");
// The rows of this playbook ($1 = org, $2 = team, unused for the organization's own).
const whose = (ref: TeamRef) =>
  isOrgBook(ref) ? "org = $1 and thunder_team_id is null and org_team_id is null and $2::text = ''" : `org = $1 and ${teamCol(ref.org)} = $2::bigint`;
const COACHES = ["HeadCoach", "AsstCoach"];
const by = (v: SessionUser) => `${v.firstName} ${v.lastName}`.trim() || v.coachId;
const COLS = `id::text, name, kind, notes, frames, added_by as "addedBy", updated_by as "changedBy", shared_by as "sharedBy"`;
const ORDER = "array_position($3::text[], kind), lower(name)";

export const playbookOn = (q: Q, org: string) => hasFeature(q, org as OrgSlug, "playbook");

// The organization's own playbook: its Owners and Admins.
export async function canKeepOrgPlaybook(q: Q, viewer: SessionUser, org: string): Promise<boolean> {
  return SLUG.test(String(org)) && (await playbookOn(q, org)) && (await isOrgAdmin(q, viewer.coachId, org as OrgSlug));
}

// May this person see and change this playbook? A team's: its coaches, and the organization's Directors of Teams and
// Admins. The organization's: its Owners and Admins.
export async function canUsePlaybook(q: Q, viewer: SessionUser, ref: TeamRef): Promise<boolean> {
  if (!validRef(ref) || !(await playbookOn(q, ref.org))) return false;
  if (isOrgBook(ref)) return isOrgAdmin(q, viewer.coachId, ref.org as OrgSlug);
  if (ref.org === "thunder") {
    if (!(await q.query("select 1 from teams where id = $1", [ref.teamId])).rows[0]) return false;
    if (hasArea(viewer, "teams")) return true;
    const r = await q.query("select 1 from team_staff where team_id = $1 and coach_id = $2 and role = any($3)", [ref.teamId, viewer.coachId, COACHES]);
    return !!r.rows[0];
  }
  if (!(await q.query("select 1 from org_teams where id = $1 and org = $2", [ref.teamId, ref.org])).rows[0]) return false;
  if (await orgHasArea(q, viewer.coachId, ref.org as OrgSlug, "teams")) return true;
  const r = await q.query("select 1 from org_team_coaches where team_id = $1 and coach_id = $2 and role = any($3)", [
    ref.teamId,
    viewer.coachId,
    COACHES,
  ]);
  return !!r.rows[0];
}

const noRight = (ref: TeamRef) =>
  isOrgBook(ref) ? "Only the organization's Owners and Admins can change its playbook." : "Only this team's coaches can change its playbook.";
const nameTaken = (ref: TeamRef, name: string) =>
  isOrgBook(ref) ? `The organization's playbook already has a play named ${name}.` : `This team already has a play named ${name}.`;

// The playbook's plays, by type (Offense, Defense, Inbounds, Drills) and then name. Null when the person may not see them.
export async function listPlays(deps: Deps, viewer: SessionUser, ref: TeamRef): Promise<Play[] | null> {
  if (!(await canUsePlaybook(deps.pool, viewer, ref))) return null;
  const r = await deps.pool.query<Play>(`select ${COLS} from plays where ${whose(ref)} order by ${ORDER}`, [ref.org, ref.teamId, PLAY_KINDS]);
  return r.rows;
}

// The organization's library: its own plays and those its teams shared (with the team's name), by type and name.
// `exceptTeam`: leave out that team's own shared plays (it has them already). Null when the person may not see it: the
// organization's Owners and Admins, and anyone who keeps one of its teams' playbooks (`forTeam`).
export async function orgLibrary(deps: Deps, viewer: SessionUser, org: string, forTeam = ""): Promise<LibraryPlay[] | null> {
  const ok = forTeam ? await canUsePlaybook(deps.pool, viewer, { org, teamId: forTeam }) : await canKeepOrgPlaybook(deps.pool, viewer, org);
  if (!ok) return null;
  const col = teamCol(org);
  const teams = org === "thunder" ? "teams" : "org_teams";
  const r = await deps.pool.query<LibraryPlay>(
    `select p.id::text, p.name, p.kind, p.notes, p.frames, p.added_by as "addedBy", p.updated_by as "changedBy", p.shared_by as "sharedBy",
            t.name as team, p.${col}::text as "teamId"
       from plays p left join ${teams} t on t.id = p.${col}
      where p.org = $1
        and ((p.thunder_team_id is null and p.org_team_id is null) or p.shared_by is not null)
        and ($2::text = '' or p.${col} is distinct from $2::bigint)
      order by p.${col} is not null, array_position($3::text[], p.kind), lower(p.name)`,
    [org, forTeam, PLAY_KINDS],
  );
  return r.rows;
}

function clean(input: PlayInput): { name: string; kind: PlayKind; notes: string; frames: Frame[] } | string {
  const name = typeof input.name === "string" ? input.name.replace(/\s+/g, " ").trim() : "";
  if (!name || name.length > 60) return "Give the play a name (up to 60 letters).";
  if (/^[=+\-@]/.test(name)) return "A play's name can't start with = + - or @.";
  const kind = PLAY_KINDS.find((k) => k === input.kind);
  if (!kind) return "Pick Offense, Defense, Inbounds or Drill.";
  const notes = typeof input.notes === "string" ? input.notes.replace(/\r\n/g, "\n").trim() : "";
  if (notes.length > 2000) return "Notes can be up to 2000 letters.";
  const frames = cleanFrames(input.frames);
  if (typeof frames === "string") return frames;
  return { name, kind, notes, frames };
}

const taken = (e: unknown) => (e as { code?: string })?.code === "23505";

async function insert(deps: Deps, viewer: SessionUser, ref: TeamRef, c: { name: string; kind: PlayKind; notes: string; frames: Frame[] }) {
  // The organization's own: no team ($2 is "", stored as null).
  const cols = isOrgBook(ref) ? "org, thunder_team_id" : `org, ${teamCol(ref.org)}`;
  const vals = "$1, nullif($2::text, '')::bigint";
  try {
    const r = await deps.pool.query<{ id: string }>(
      `insert into plays (${cols}, name, kind, notes, frames, added_by, added_at)
       values (${vals}, $3, $4, $5, $6, $7, $8) returning id::text`,
      [ref.org, ref.teamId, c.name, c.kind, c.notes, JSON.stringify(c.frames), by(viewer), deps.now()],
    );
    return { ok: true as const, id: r.rows[0].id };
  } catch (e) {
    if (taken(e)) return { ok: false as const, message: nameTaken(ref, c.name) };
    throw e;
  }
}

// Adds a play to the playbook.
export async function addPlay(deps: Deps, viewer: SessionUser, ref: TeamRef, input: PlayInput): Promise<Result<{ id: string }>> {
  if (!(await canUsePlaybook(deps.pool, viewer, ref))) return { ok: false, message: noRight(ref) };
  const c = clean(input);
  if (typeof c === "string") return { ok: false, message: c };
  return insert(deps, viewer, ref, c);
}

// Changes a play's name, type, notes or (when sent) drawing.
export async function changePlay(deps: Deps, viewer: SessionUser, ref: TeamRef, id: unknown, input: PlayInput): Promise<Result> {
  if (!(await canUsePlaybook(deps.pool, viewer, ref))) return { ok: false, message: noRight(ref) };
  if (typeof id !== "string" || !ID.test(id)) return { ok: false, message: "That play no longer exists." };
  const c = clean(input);
  if (typeof c === "string") return { ok: false, message: c };
  try {
    const r = await deps.pool.query(
      `update plays set name = $3, kind = $4, notes = $5, updated_by = $6, updated_at = $7,
              frames = case when $9::boolean then $10::jsonb else frames end
        where id = $8 and ${whose(ref)}`,
      [ref.org, ref.teamId, c.name, c.kind, c.notes, by(viewer), deps.now(), id, input.frames !== undefined, JSON.stringify(c.frames)],
    );
    return r.rowCount ? { ok: true } : { ok: false, message: "That play no longer exists." };
  } catch (e) {
    if (taken(e)) return { ok: false, message: nameTaken(ref, c.name) };
    throw e;
  }
}

export async function removePlay(deps: Deps, viewer: SessionUser, ref: TeamRef, id: unknown): Promise<Result> {
  if (!(await canUsePlaybook(deps.pool, viewer, ref))) return { ok: false, message: noRight(ref) };
  if (typeof id !== "string" || !ID.test(id)) return { ok: false, message: "That play no longer exists." };
  const r = await deps.pool.query(`delete from plays where id = $3 and ${whose(ref)}`, [ref.org, ref.teamId, id]);
  return r.rowCount ? { ok: true } : { ok: false, message: "That play no longer exists." };
}

// A team's play shared with the organization (or not any more): it shows in the organization's library.
export async function sharePlay(deps: Deps, viewer: SessionUser, ref: TeamRef, id: unknown, on: boolean): Promise<Result> {
  if (isOrgBook(ref)) return { ok: false, message: "The organization's own plays are already in its library." };
  if (!(await canUsePlaybook(deps.pool, viewer, ref))) return { ok: false, message: noRight(ref) };
  if (typeof id !== "string" || !ID.test(id)) return { ok: false, message: "That play no longer exists." };
  const r = await deps.pool.query(`update plays set shared_by = $4, shared_at = $5 where id = $3 and ${whose(ref)}`, [
    ref.org,
    ref.teamId,
    id,
    on ? by(viewer) : null,
    on ? deps.now() : null,
  ]);
  return r.rowCount ? { ok: true } : { ok: false, message: "That play no longer exists." };
}

// Copies a play from the organization's library (its own, or one a team shared) into a playbook: a team's, or the
// organization's own. The copy is the team's to change; who copied it is recorded.
export async function copyPlay(deps: Deps, viewer: SessionUser, to: TeamRef, id: unknown): Promise<Result<{ id: string }>> {
  if (!(await canUsePlaybook(deps.pool, viewer, to))) return { ok: false, message: noRight(to) };
  if (typeof id !== "string" || !ID.test(id)) return { ok: false, message: "That play is no longer shared." };
  const r = await deps.pool.query<{ name: string; kind: PlayKind; notes: string; frames: Frame[] }>(
    `select name, kind, notes, frames from plays
      where id = $1 and org = $2 and ((thunder_team_id is null and org_team_id is null) or shared_by is not null)`,
    [id, to.org],
  );
  const p = r.rows[0];
  if (!p) return { ok: false, message: "That play is no longer shared." };
  return insert(deps, viewer, to, p);
}

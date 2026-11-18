// CourtPlaybook (SPEC.md section 14): plays by type (Offense, Defense, Inbounds, Drills), each with its name, notes and
// drawing. Two kinds of playbook, the same rules for both:
// - a team's: its coaches see and change it, and so do the organization's Directors of Teams and Admins;
// - the organization's own (teamId ""): its Owners and Admins keep it.
// Each play says who sees it (`visibility`): Private (only the person who made it), Team (the team's coaches; players
// and parents come next), Org (the organization's library) or Public (every organization with CourtPlaybook). The
// organization's own plays are Private, Org or Public. The organization's Org and Public plays make its library, which
// its teams' coaches copy from (and its Admins copy into the organization's playbook); every organization's Public plays
// can be copied by any organization with CourtPlaybook. Who added, changed or set who sees each is recorded.
import type { Pool, PoolClient } from "pg";
import type { SessionUser } from "./auth/service";
import { hasFeature } from "./features";
import { hasArea, isOrgAdmin, orgHasArea } from "./org-admin";
import type { OrgSlug } from "./orgs";
import { PLAY_KINDS, VISIBILITIES, type PlayKind, type Visibility } from "./play-kinds";
import { cleanFrames, type Frame } from "./play-diagram";
import { withTx } from "./sql";
import { MAX_VIDEOS, cleanVideoUrl } from "./play-video";
import { FORMATION_KINDS, type Formation } from "./play-formations";

export { PLAY_KINDS, VISIBILITIES, type PlayKind, type Visibility };

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
  visibility: Visibility;
  formation: string | null; // an Offense or Defense play's Base Formation (none: Other)
  videos: string[]; // links to videos of it being run (up to 5)
  sharedBy: string | null; // who set who sees it (when it's been set)
  mine: boolean; // the viewer made it (only they can make it Private)
};
// A play in a library: the organization's own (team null) or a team's; `orgName` is set for another organization's
// Public play.
export type LibraryPlay = Play & { team: string | null; teamId: string | null; orgName: string | null };
export type PlayInput = {
  name?: unknown;
  kind?: unknown;
  notes?: unknown;
  frames?: unknown; // its drawing
  visibility?: unknown;
  formation?: unknown;
  videos?: unknown; // links to videos of it being run (not sent: kept as they are)
};

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
// $4 = the viewer's coach id. The organization's own plays are never Team (read as Org).
const cols = (p = "") =>
  `${p}id::text, ${p}name, ${p}kind, ${p}notes, ${p}frames, ${p}added_by as "addedBy", ${p}updated_by as "changedBy", ${p}shared_by as "sharedBy", ${p}formation, ${p}videos,
   case when ${p}visibility = 'team' and ${p}thunder_team_id is null and ${p}org_team_id is null then 'org' else ${p}visibility end as visibility,
   coalesce(${p}made_by = $4, false) as mine`;
// A Private play is seen only by the person who made it.
const SEES = "(visibility <> 'private' or made_by = $4)";
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
  const r = await deps.pool.query<Play>(`select ${cols()} from plays where ${whose(ref)} and ${SEES} order by ${ORDER}`, [
    ref.org,
    ref.teamId,
    PLAY_KINDS,
    viewer.coachId,
  ]);
  return r.rows;
}

// The libraries a playbook copies from: the organization's (its own plays and its teams' Org and Public ones, with the
// team's name), then every other organization's Public plays (with the organization's name), each by type and name.
// `forTeam`: leave out that team's own plays (it has them already). Null when the person may not see it: the
// organization's Owners and Admins, and anyone who keeps one of its teams' playbooks (`forTeam`).
export async function orgLibrary(deps: Deps, viewer: SessionUser, org: string, forTeam = ""): Promise<LibraryPlay[] | null> {
  const ok = forTeam ? await canUsePlaybook(deps.pool, viewer, { org, teamId: forTeam }) : await canKeepOrgPlaybook(deps.pool, viewer, org);
  if (!ok) return null;
  const col = teamCol(org);
  const r = await deps.pool.query<LibraryPlay>(
    `select ${cols("p.")}, coalesce(t.name, o.name) as team, coalesce(p.thunder_team_id, p.org_team_id)::text as "teamId",
            case when p.org = $1 then null else coalesce(g.short_name, g.name) end as "orgName"
       from plays p
       left join teams t on t.id = p.thunder_team_id
       left join org_teams o on o.id = p.org_team_id
       join organizations g on g.slug = p.org
      where (p.org = $1 and (p.visibility in ('org', 'public') or (p.thunder_team_id is null and p.org_team_id is null and p.visibility <> 'private'))
             and ($2::text = '' or p.${col} is distinct from $2::bigint))
         or (p.org <> $1 and p.visibility = 'public')
      order by p.org <> $1, lower(coalesce(g.short_name, g.name)), coalesce(p.thunder_team_id, p.org_team_id) is not null,
               array_position($3::text[], p.kind), lower(p.name)
      limit 500`,
    [org, forTeam, PLAY_KINDS, viewer.coachId],
  );
  return r.rows;
}

type Clean = {
  name: string;
  kind: PlayKind;
  notes: string;
  frames: Frame[];
  visibility: Visibility | null;
  formation: string | null;
  videos: string[] | null; // null: not sent (kept)
};
// A formation's name: up to 40 letters, never starting with = + - @. Null when there's none; a message when it's wrong.
function cleanFormationName(v: unknown, what = "A formation's name"): string | null | { error: string } {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  if (!n || n.length > 40) return { error: `${what} can be up to 40 letters.` };
  if (/^[=+\-@]/.test(n)) return { error: `${what} can't start with = + - or @.` };
  return n;
}
function clean(input: PlayInput): Clean | string {
  const name = typeof input.name === "string" ? input.name.replace(/\s+/g, " ").trim() : "";
  if (!name || name.length > 60) return "Give the play a name (up to 60 letters).";
  if (/^[=+\-@]/.test(name)) return "A play's name can't start with = + - or @.";
  const kind = PLAY_KINDS.find((k) => k === input.kind);
  if (!kind) return "Pick Offense, Defense, Inbounds or Drill.";
  const notes = typeof input.notes === "string" ? input.notes.replace(/\r\n/g, "\n").trim() : "";
  if (notes.length > 2000) return "Notes can be up to 2000 letters.";
  const frames = cleanFrames(input.frames);
  if (typeof frames === "string") return frames;
  // Who sees it: not sent keeps it as it is (a new play: Team, or Org for the organization's own).
  let visibility: Visibility | null = null;
  if (input.visibility !== undefined) {
    visibility = VISIBILITIES.find((v) => v === input.visibility) ?? null;
    if (!visibility) return "Pick who sees it: Private, Team, Org or Public.";
  }
  // Its Base Formation (Offense and Defense only).
  const formation = kind === "Offense" || kind === "Defense" ? cleanFormationName(input.formation, "A formation") : null;
  if (formation && typeof formation === "object") return formation.error;
  // Video links: web addresses (http or https), up to 5, each once; blanks left out.
  let videos: string[] | null = null;
  if (input.videos !== undefined) {
    if (!Array.isArray(input.videos) || input.videos.length > 20 || input.videos.some((v) => typeof v !== "string"))
      return "The video links aren't readable.";
    const typed = (input.videos as string[]).filter((v) => v.trim());
    const out: string[] = [];
    for (const v of typed) {
      const u = cleanVideoUrl(v);
      if (!u) return `"${v.trim().slice(0, 60)}" isn't a web link (it should start with https://).`;
      if (!out.includes(u)) out.push(u);
    }
    if (out.length > MAX_VIDEOS) return `Up to ${MAX_VIDEOS} video links.`;
    videos = out;
  }
  return { name, kind, notes, frames, visibility, formation, videos };
}

const taken = (e: unknown) => (e as { code?: string })?.code === "23505";

// The organization's own plays have no Team setting.
const badVisibility = (ref: TeamRef, v: Visibility | null) =>
  isOrgBook(ref) && v === "team" ? "The organization's own plays are Private, Org or Public." : null;

async function insert(deps: Deps, viewer: SessionUser, ref: TeamRef, c: Clean) {
  const bad = badVisibility(ref, c.visibility);
  if (bad) return { ok: false as const, message: bad };
  const visibility = c.visibility ?? (isOrgBook(ref) ? "org" : "team");
  const asDefault = visibility === (isOrgBook(ref) ? "org" : "team");
  // The organization's own: no team ($2 is "", stored as null).
  const owner = isOrgBook(ref) ? "org, thunder_team_id" : `org, ${teamCol(ref.org)}`;
  const vals = "$1, nullif($2::text, '')::bigint";
  try {
    const r = await deps.pool.query<{ id: string }>(
      `insert into plays (${owner}, name, kind, notes, frames, added_by, added_at, made_by, visibility, shared_by, shared_at, formation, videos)
       values (${vals}, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) returning id::text`,
      [
        ref.org,
        ref.teamId,
        c.name,
        c.kind,
        c.notes,
        JSON.stringify(c.frames),
        by(viewer),
        deps.now(),
        viewer.coachId,
        visibility,
        asDefault ? null : by(viewer),
        asDefault ? null : deps.now(),
        c.formation,
        c.videos ?? [],
      ],
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
  const bad = badVisibility(ref, c.visibility);
  if (bad) return { ok: false, message: bad };
  try {
    return await withTx(deps.pool, async (q) => {
      const cur = await q.query<{ visibility: Visibility; mine: boolean }>(
        `select visibility, coalesce(made_by = $4, false) as mine from plays where id = $3 and ${whose(ref)} and ${SEES} for update`,
        [ref.org, ref.teamId, id, viewer.coachId],
      );
      const p = cur.rows[0];
      if (!p) return { ok: false as const, message: "That play no longer exists." };
      const vis = c.visibility ?? p.visibility;
      // Private hides it from everyone else, so only the person who made it may choose it.
      if (vis === "private" && p.visibility !== "private" && !p.mine)
        return { ok: false as const, message: "Only the coach who made this play can make it Private." };
      const moved = vis !== p.visibility;
      await q.query(
        `update plays set name = $3, kind = $4, notes = $5, updated_by = $6, updated_at = $7,
                frames = case when $9::boolean then $10::jsonb else frames end,
                visibility = $11, formation = $13, videos = coalesce($14::text[], videos),
                shared_by = case when $12::boolean then $6 else shared_by end,
                shared_at = case when $12::boolean then $7 else shared_at end
          where id = $8 and ${whose(ref)}`,
        [ref.org, ref.teamId, c.name, c.kind, c.notes, by(viewer), deps.now(), id, input.frames !== undefined, JSON.stringify(c.frames), vis, moved, c.formation, c.videos],
      );
      return { ok: true as const };
    });
  } catch (e) {
    if (taken(e)) return { ok: false, message: nameTaken(ref, c.name) };
    throw e;
  }
}

export async function removePlay(deps: Deps, viewer: SessionUser, ref: TeamRef, id: unknown): Promise<Result> {
  if (!(await canUsePlaybook(deps.pool, viewer, ref))) return { ok: false, message: noRight(ref) };
  if (typeof id !== "string" || !ID.test(id)) return { ok: false, message: "That play no longer exists." };
  const r = await deps.pool.query(`delete from plays where id = $3 and ${whose(ref)} and ${SEES}`, [ref.org, ref.teamId, id, viewer.coachId]);
  return r.rowCount ? { ok: true } : { ok: false, message: "That play no longer exists." };
}

// Copies a play from a library (the organization's: its own and its teams' Org and Public plays; or any organization's
// Public play) into a playbook: a team's, or the organization's own. The copy is the team's to change (Team, or Org for
// the organization's own); who copied it is recorded.
export async function copyPlay(deps: Deps, viewer: SessionUser, to: TeamRef, id: unknown): Promise<Result<{ id: string }>> {
  if (!(await canUsePlaybook(deps.pool, viewer, to))) return { ok: false, message: noRight(to) };
  if (typeof id !== "string" || !ID.test(id)) return { ok: false, message: "That play is no longer shared." };
  const r = await deps.pool.query<{ name: string; kind: PlayKind; notes: string; frames: Frame[]; formation: string | null; videos: string[] }>(
    `select name, kind, notes, frames, formation, videos from plays
      where id = $1
        and (visibility = 'public'
             or (org = $2 and (visibility = 'org' or (thunder_team_id is null and org_team_id is null and visibility <> 'private'))))`,
    [id, to.org],
  );
  const p = r.rows[0];
  if (!p) return { ok: false, message: "That play is no longer shared." };
  return insert(deps, viewer, to, { ...p, visibility: null });
}

// ---- Base Formations: a playbook's own (the built-ins are in lib/play-formations.ts) ----

const ownerOf = (ref: TeamRef) => (isOrgBook(ref) ? "org, thunder_team_id" : `org, ${teamCol(ref.org)}`);

// The playbook's own formations, by kind and name. Null when the person may not see the playbook.
export async function listFormations(deps: Deps, viewer: SessionUser, ref: TeamRef): Promise<Formation[] | null> {
  if (!(await canUsePlaybook(deps.pool, viewer, ref))) return null;
  const r = await deps.pool.query<Formation>(
    `select id::text, kind, name, spots, added_by as "addedBy", updated_by as "changedBy" from play_formations
      where ${whose(ref)} order by kind desc, lower(name)`,
    [ref.org, ref.teamId],
  );
  return r.rows;
}

export type FormationInput = { kind?: unknown; name?: unknown; spots?: unknown };

// Adds a formation, or (with `id`) changes one: its name and where the players stand. A built-in's name makes this
// playbook's own version of it. Renaming moves the playbook's plays in it along.
export async function saveFormation(
  deps: Deps,
  viewer: SessionUser,
  ref: TeamRef,
  id: unknown,
  input: FormationInput,
): Promise<Result<{ id: string }>> {
  if (!(await canUsePlaybook(deps.pool, viewer, ref))) return { ok: false, message: noRight(ref) };
  const kind = FORMATION_KINDS.find((k) => k === input.kind);
  if (!kind) return { ok: false, message: "Pick Offense or Defense." };
  const name = cleanFormationName(input.name);
  if (!name) return { ok: false, message: "Give the formation a name." };
  if (typeof name === "object") return { ok: false, message: name.error };
  const frames = cleanFrames([input.spots]);
  if (typeof frames === "string") return { ok: false, message: frames.replace("Frame 1: ", "") };
  const spots = { ...frames[0], lines: [] };
  if (!spots.spots.length) return { ok: false, message: "Put at least one player on the court." };
  if (id !== null && (typeof id !== "string" || !ID.test(id))) return { ok: false, message: "That formation no longer exists." };
  try {
    return await withTx(deps.pool, async (q) => {
      if (id === null) {
        const r = await q.query<{ id: string }>(
          `insert into play_formations (${ownerOf(ref)}, kind, name, spots, added_by, added_at)
           values ($1, nullif($2::text, '')::bigint, $3, $4, $5, $6, $7) returning id::text`,
          [ref.org, ref.teamId, kind, name, JSON.stringify(spots), by(viewer), deps.now()],
        );
        return { ok: true as const, id: r.rows[0].id };
      }
      const old = await q.query<{ name: string }>(`select name from play_formations where id = $3 and kind = $4 and ${whose(ref)} for update`, [
        ref.org,
        ref.teamId,
        id,
        kind,
      ]);
      if (!old.rows[0]) return { ok: false as const, message: "That formation no longer exists." };
      await q.query(`update play_formations set name = $4, spots = $5, updated_by = $6, updated_at = $7 where id = $3 and ${whose(ref)}`, [
        ref.org,
        ref.teamId,
        id,
        name,
        JSON.stringify(spots),
        by(viewer),
        deps.now(),
      ]);
      if (old.rows[0].name !== name)
        await q.query(`update plays set formation = $5 where ${whose(ref)} and kind = $3 and lower(formation) = lower($4)`, [
          ref.org,
          ref.teamId,
          kind,
          old.rows[0].name,
          name,
        ]);
      return { ok: true as const, id };
    });
  } catch (e) {
    if (taken(e)) return { ok: false, message: `This playbook already has a ${kind} formation named ${name}.` };
    throw e;
  }
}

// Deletes the playbook's own formation (a built-in's own version: back to the built-in). Its plays keep their formation.
export async function removeFormation(deps: Deps, viewer: SessionUser, ref: TeamRef, id: unknown): Promise<Result> {
  if (!(await canUsePlaybook(deps.pool, viewer, ref))) return { ok: false, message: noRight(ref) };
  if (typeof id !== "string" || !ID.test(id)) return { ok: false, message: "That formation no longer exists." };
  const r = await deps.pool.query(`delete from play_formations where id = $3 and ${whose(ref)}`, [ref.org, ref.teamId, id]);
  return r.rowCount ? { ok: true } : { ok: false, message: "That formation no longer exists." };
}

// Support (SPEC.md section 14), the same in every organization: ready-made questions and How-to guides, and questions
// people ask from the app. CourtCaptain staff answer questions and add, change and remove the questions and guides.
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { isOrgSlug } from "./orgs";
import { orgHasArea } from "./org-admin";
import { isPlatformAdmin } from "./platform";
import type { abilitiesFrom, syncPart } from "./features";
import { AUDIENCES, LIBRARY, NEEDS, TOPICS } from "./support-library";
import { AREAS } from "./org-admin";

type Deps = { pool: Pool; now: () => Date };
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };
const by = (v: SessionUser) => `${v.firstName} ${v.lastName}`;
const isId = (v: unknown): v is string => typeof v === "string" && /^\d{1,18}$/.test(v);
const staffOnly = { ok: false as const, message: "Only CourtCaptain staff can do that." };

export type SupportArticle = {
  id: string; // a library article's key, or the number of one staff added
  key: string | null; // in the library (lib/support-library.ts); null: staff added it
  kind: "faq" | "howto";
  topic: string;
  title: string;
  body: string;
  sort: number;
  audiences: string[];
  features: string[]; // needs all of them
  areas: string[];
  changed: boolean; // staff's own version of a library article
  hidden: boolean; // staff took it out: nobody sees it
};

// Plain text only (shown escaped). Titles up to 120 characters, answers and steps up to 4000.
const text = (v: unknown, max: number) => {
  const s = typeof v === "string" ? v.replace(/\r\n?/g, "\n").trim() : "";
  return s && s.length <= max ? s : null;
};

// Every article: the library's (with staff's own versions in place of theirs) and the ones staff added, by topic. `hidden`:
// the ones taken out too (CourtCaptain staff's list). The first articles (065, never changed) gave way to the library.
export async function listArticles(pool: Pick<Pool, "query">, hidden = false): Promise<SupportArticle[]> {
  const r = await pool.query<Omit<SupportArticle, "changed" | "topic"> & { topic: string | null }>(
    `select id::text, key, kind, topic, title, body, sort, audiences, features, areas, hidden from support_articles
      where key is not null or updated_by <> 'setup' order by sort, lower(title)`,
  );
  const own = new Map(r.rows.flatMap((a) => (a.key ? [[a.key, a] as const] : [])));
  const library = LIBRARY.map((a, i): SupportArticle => {
    const o = own.get(a.key);
    const base = { id: a.key, key: a.key, sort: i, audiences: [...a.who] as string[], features: [...(a.needs ?? [])] as string[], areas: [...(a.areas ?? [])] as string[] };
    return o
      ? { ...base, kind: o.kind, topic: o.topic ?? a.topic, title: o.title, body: o.body, audiences: o.audiences, features: o.features, areas: o.areas, changed: true, hidden: o.hidden }
      : { ...base, kind: a.kind, topic: a.topic, title: a.title, body: a.body, changed: false, hidden: false };
  });
  const added = r.rows.filter((a) => !a.key).map((a): SupportArticle => ({ ...a, topic: a.topic ?? "Finding your way", sort: 1000 + a.sort, changed: false }));
  const rank = (t: string) => {
    const n = (TOPICS as readonly string[]).indexOf(t);
    return n < 0 ? TOPICS.length : n;
  };
  return [...library, ...added].filter((a) => hidden || !a.hidden).sort((a, b) => rank(a.topic) - rank(b.topic) || a.sort - b.sort);
}

// Someone, in one organization: who they are there, what it has, and a Director's areas ("*": every area).
export type For = { who: Set<string>; has: Set<string>; areas: Set<string> };

// Pure: what an organization has, as articles ask for it.
export function needsMet(keys: ReadonlySet<string>, abilities: typeof abilitiesFrom, part: typeof syncPart): Set<string> {
  const has = new Set<string>([...keys, ...abilities(keys, false)]);
  if (keys.has("court-sync")) has.add(`sync-${{ Schedule: "scheduler", Host: "host", Officials: "officials" }[part(keys)]}`);
  if (has.has("hosting-available")) has.add("sync-host");
  if (has.has("team-building") && !has.has("player-registration")) has.add("typed-rosters");
  return has;
}

// Pure: is an article for them? One of its people, all its features, and (only as a Director) one of its areas.
export function isFor(a: Pick<SupportArticle, "audiences" | "features" | "areas">, f: For): boolean {
  if (!a.features.every((x) => f.has.has(x))) return false;
  const asDirector = a.areas.length === 0 || f.areas.has("*") || a.areas.some((x) => f.areas.has(x));
  return a.audiences.some((w) => f.who.has(w) && (w !== "director" || asDirector));
}

export const articlesFor = (all: SupportArticle[], list: For[]): SupportArticle[] => all.filter((a) => list.some((f) => isFor(a, f)));

// ---- Chats ----

export type ChatStatus = "new" | "working" | "resolved";
export type ChatMessage = { id: string; who: string; helper: string | null; body: string; at: Date; mine: boolean };
export type SupportChat = {
  id: string;
  who: string; // who started it
  org: string | null;
  orgName: string | null;
  status: ChatStatus;
  startedAt: Date;
  resolvedBy: string | null;
  chattingWith: string | null; // the helper who answered last ("Earl Epps · CourtCaptain Support"), none yet: null
  messages: ChatMessage[];
};

const MAX_CHATS = 60;
const isStaff = (pool: Pick<Pool, "query">, coachId: string) => isPlatformAdmin(pool, coachId);
// Who may answer a chat: CourtCaptain staff (every chat), or its organization's Owners, Admins and Directors of Support.
async function mayHelp(pool: Pick<Pool, "query">, coachId: string, org: string | null): Promise<boolean> {
  if (await isStaff(pool, coachId)) return true;
  return !!org && isOrgSlug(org) && orgHasArea(pool, coachId, org, "support");
}

async function loadChats(
  pool: Pick<Pool, "query">,
  viewer: SessionUser,
  where: string,
  params: unknown[],
): Promise<SupportChat[]> {
  const r = await pool.query<
    Omit<SupportChat, "chattingWith" | "messages"> & {
      messages: (ChatMessage & { coachId: string; staff: boolean; admin: boolean; support: boolean })[];
    }
  >(
    `select q.id::text, u.first_name || ' ' || u.last_name as who, q.org, o.name as "orgName", q.status, q.asked_at as "startedAt",
            q.resolved_by as "resolvedBy",
            coalesce((select json_agg(json_build_object(
                        'id', m.id::text, 'coachId', m.coach_id, 'who', mu.first_name || ' ' || mu.last_name, 'body', m.body, 'at', m.sent_at,
                        'staff', exists (select 1 from platform_admins p where p.coach_id = m.coach_id),
                        'admin', q.org is not null and has_role(m.coach_id, q.org, 'Admin'),
                        'support', q.org is not null and has_role(m.coach_id, q.org, 'Director') and exists (
                          select 1 from active_director_areas a where a.coach_id = m.coach_id and a.org = q.org and a.area = 'support'))
                      order by m.sent_at, m.id)
                      from support_messages m join users mu on mu.coach_id = m.coach_id where m.question_id = q.id), '[]') as messages
     from support_questions q join users u on u.coach_id = q.coach_id left join organizations o on o.slug = q.org
     where ${where}
     order by q.asked_at desc limit ${MAX_CHATS}`,
    params,
  );
  return r.rows.map((c) => {
    const messages: ChatMessage[] = c.messages.map((m) => ({
      id: m.id,
      who: m.who,
      // Someone answering: CourtCaptain Support, or the organization's Admin or Director of Support (not the person who asked).
      helper:
        m.who === c.who && !m.staff
          ? null
          : m.staff
            ? "CourtCaptain Support"
            : m.admin
              ? `${c.orgName ?? "Organization"} Admin`
              : m.support
                ? `${c.orgName ?? "Organization"} Support`
                : null,
      body: m.body,
      at: new Date(m.at),
      mine: m.coachId === viewer.coachId,
    }));
    const last = [...messages].reverse().find((m) => m.helper);
    return { ...c, messages, chattingWith: last ? `${last.who} · ${last.helper}` : null };
  });
}

// Start a chat from Support (in the organization the person is in). It's New until someone answering replies.
export async function askQuestion(
  deps: Deps,
  viewer: SessionUser,
  org: unknown,
  question: unknown,
): Promise<Result<{ id: string }>> {
  const q = text(question, 1000);
  if (!q) return { ok: false, message: "Type your question (up to 1000 characters)." };
  const recent = await deps.pool.query<{ n: number }>(
    "select count(*)::int as n from support_questions where coach_id = $1 and asked_at > $2::timestamptz - interval '1 hour'",
    [viewer.coachId, deps.now()],
  );
  if (recent.rows[0].n >= 10) return { ok: false, message: "That's a lot of questions at once. Please try again later." };
  const r = await deps.pool.query<{ id: string }>(
    "insert into support_questions (coach_id, org, question, asked_at) values ($1, $2, $3, $4) returning id::text",
    [viewer.coachId, isOrgSlug(org) ? org : null, q, deps.now()],
  );
  await deps.pool.query("insert into support_messages (question_id, coach_id, body, sent_at) values ($1, $2, $3, $4)", [
    r.rows[0].id,
    viewer.coachId,
    q,
    deps.now(),
  ]);
  return { ok: true, id: r.rows[0].id };
}

// The person's own chats, and (`inbox`) the ones they answer: every chat for CourtCaptain staff; the chats started in
// this organization for its Owners, Admins and Directors of Support; null for everyone else.
export async function supportChats(
  pool: Pick<Pool, "query">,
  viewer: SessionUser,
  org: string | null,
): Promise<{ mine: SupportChat[]; inbox: SupportChat[] | null }> {
  const staff = await isStaff(pool, viewer.coachId);
  const admin = !staff && org ? await mayHelp(pool, viewer.coachId, org) : false;
  const [mine, inbox] = await Promise.all([
    loadChats(pool, viewer, "q.coach_id = $1", [viewer.coachId]),
    staff ? loadChats(pool, viewer, "true", []) : admin ? loadChats(pool, viewer, "q.org = $1", [org]) : null,
  ]);
  return { mine, inbox };
}

// Reply in a chat: the person who started it, or someone who may answer it (their reply moves a New chat to Working;
// a reply reopens a Resolved one).
export async function replyChat(deps: Deps, viewer: SessionUser, id: unknown, body: unknown): Promise<Result> {
  const b = text(body, 2000);
  if (!isId(id) || !b) return { ok: false, message: "Type a message." };
  const c = await deps.pool.query<{ coach_id: string; org: string | null; status: ChatStatus }>(
    "select coach_id, org, status from support_questions where id = $1",
    [id],
  );
  const chat = c.rows[0];
  if (!chat) return { ok: false, message: "That chat no longer exists." };
  const helper = await mayHelp(deps.pool, viewer.coachId, chat.org);
  if (chat.coach_id !== viewer.coachId && !helper) return { ok: false, message: "That chat isn't yours." };
  await deps.pool.query("insert into support_messages (question_id, coach_id, body, sent_at) values ($1, $2, $3, $4)", [
    id,
    viewer.coachId,
    b,
    deps.now(),
  ]);
  const next = helper && chat.coach_id !== viewer.coachId ? "working" : chat.status === "resolved" ? "working" : chat.status;
  if (next !== chat.status)
    await deps.pool.query("update support_questions set status = $2, resolved_by = null, resolved_at = null where id = $1", [
      id,
      next,
    ]);
  return { ok: true };
}

// Mark a chat Resolved (it leaves New and Working), or open it again. The person who started it, or someone answering it.
export async function setChatResolved(deps: Deps, viewer: SessionUser, id: unknown, resolved: boolean): Promise<Result> {
  if (!isId(id)) return { ok: false, message: "That chat no longer exists." };
  const c = await deps.pool.query<{ coach_id: string; org: string | null }>(
    "select coach_id, org from support_questions where id = $1",
    [id],
  );
  const chat = c.rows[0];
  if (!chat) return { ok: false, message: "That chat no longer exists." };
  if (chat.coach_id !== viewer.coachId && !(await mayHelp(deps.pool, viewer.coachId, chat.org)))
    return { ok: false, message: "That chat isn't yours." };
  await deps.pool.query(
    resolved
      ? "update support_questions set status = 'resolved', resolved_by = $2, resolved_at = $3 where id = $1"
      : "update support_questions set status = 'working', resolved_by = null, resolved_at = null where id = $1",
    resolved ? [id, by(viewer), deps.now()] : [id],
  );
  return { ok: true };
}

// CourtCaptain staff: add a chat's question and the last answer to everyone's Questions.
export async function publishChat(
  deps: Deps,
  viewer: SessionUser,
  id: unknown,
  title: unknown,
  answer: unknown,
): Promise<Result> {
  if (!(await isStaff(deps.pool, viewer.coachId))) return staffOnly;
  const t = text(title, 120);
  const a = text(answer, 4000);
  if (!isId(id) || !t || !a) return { ok: false, message: "Fill in the question and the answer." };
  await deps.pool.query(
    "insert into support_articles (kind, title, body, updated_by, updated_at) values ('faq', $1, $2, $3, $4)",
    [t, a, by(viewer), deps.now()],
  );
  return { ok: true };
}

// Add (id null) or change a ready-made question or How-to guide: its words, topic, and who sees it. Changing one of the
// library's keeps staff's own version of it.
export async function saveArticle(
  deps: Deps,
  viewer: SessionUser,
  id: unknown,
  input: { kind: unknown; title: unknown; body: unknown; topic?: unknown; audiences?: unknown; features?: unknown; areas?: unknown },
): Promise<Result> {
  if (!(await isPlatformAdmin(deps.pool, viewer.coachId))) return staffOnly;
  const kind = input.kind === "faq" || input.kind === "howto" ? input.kind : null;
  const title = text(input.title, 120);
  const body = text(input.body, 4000);
  const topic = (TOPICS as readonly unknown[]).includes(input.topic) ? String(input.topic) : null;
  const pick = (v: unknown, from: readonly string[]) => (Array.isArray(v) ? [...new Set(v)].filter((x): x is string => from.includes(x as string)) : []);
  const audiences = pick(input.audiences, AUDIENCES);
  const features = pick(input.features, Object.keys(NEEDS));
  const areas = pick(input.areas, AREAS.map((a) => a.key));
  if (!kind || !title || !body) return { ok: false, message: "Pick Question or How-to, and fill in the title and the answer or steps." };
  if (!topic) return { ok: false, message: "Pick a topic." };
  if (!audiences.length) return { ok: false, message: "Pick who sees it." };
  const values = [kind, title, body, topic, audiences, features, areas, by(viewer), deps.now()];
  if (id === null) {
    await deps.pool.query(
      "insert into support_articles (kind, title, body, topic, audiences, features, areas, updated_by, updated_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
      values,
    );
    return { ok: true };
  }
  if (LIBRARY.some((a) => a.key === id)) {
    await deps.pool.query(
      `insert into support_articles (kind, title, body, topic, audiences, features, areas, updated_by, updated_at, key) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       on conflict (key) do update set kind = $1, title = $2, body = $3, topic = $4, audiences = $5, features = $6, areas = $7, updated_by = $8, updated_at = $9, hidden = false`,
      [...values, id],
    );
    return { ok: true };
  }
  if (!isId(id)) return { ok: false, message: "That item no longer exists." };
  const r = await deps.pool.query(
    "update support_articles set kind = $1, title = $2, body = $3, topic = $4, audiences = $5, features = $6, areas = $7, updated_by = $8, updated_at = $9 where id = $10 and key is null",
    [...values, id],
  );
  return r.rowCount ? { ok: true } : { ok: false, message: "That item no longer exists." };
}

// Remove: one staff added is deleted; one of the library's is hidden (Put back undoes it).
export async function deleteArticle(deps: Deps, viewer: SessionUser, id: unknown): Promise<Result> {
  if (!(await isPlatformAdmin(deps.pool, viewer.coachId))) return staffOnly;
  const lib = LIBRARY.find((a) => a.key === id);
  if (lib) {
    await deps.pool.query(
      `insert into support_articles (kind, title, body, topic, audiences, features, areas, updated_by, updated_at, key, hidden) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true)
       on conflict (key) do update set hidden = true, updated_by = $8, updated_at = $9`,
      [lib.kind, lib.title, lib.body, lib.topic, [...lib.who], [...(lib.needs ?? [])], [...(lib.areas ?? [])], by(viewer), deps.now(), lib.key],
    );
    return { ok: true };
  }
  if (!isId(id)) return { ok: false, message: "That item no longer exists." };
  const r = await deps.pool.query("delete from support_articles where id = $1 and key is null", [id]);
  return r.rowCount ? { ok: true } : { ok: false, message: "That item no longer exists." };
}

// The library's own version again (staff's is dropped, or it's no longer hidden).
export async function restoreArticle(deps: Deps, viewer: SessionUser, key: unknown): Promise<Result> {
  if (!(await isPlatformAdmin(deps.pool, viewer.coachId))) return staffOnly;
  if (typeof key !== "string") return { ok: false, message: "That item no longer exists." };
  await deps.pool.query("delete from support_articles where key = $1", [key]);
  return { ok: true };
}

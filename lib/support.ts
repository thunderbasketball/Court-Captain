// Support (SPEC.md section 14), the same in every organization: ready-made questions and How-to guides, and questions
// people ask from the app. CourtCaptain staff answer questions and add, change and remove the questions and guides.
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { isOrgSlug } from "./orgs";
import { isPlatformAdmin } from "./platform";

type Deps = { pool: Pool; now: () => Date };
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };
const by = (v: SessionUser) => `${v.firstName} ${v.lastName}`;
const isId = (v: unknown): v is string => typeof v === "string" && /^\d{1,18}$/.test(v);
const staffOnly = { ok: false as const, message: "Only CourtCaptain staff can do that." };

export type SupportArticle = { id: string; kind: "faq" | "howto"; title: string; body: string; sort: number };

// Plain text only (shown escaped). Titles up to 120 characters, answers and steps up to 4000.
const text = (v: unknown, max: number) => {
  const s = typeof v === "string" ? v.replace(/\r\n?/g, "\n").trim() : "";
  return s && s.length <= max ? s : null;
};

export async function listArticles(pool: Pick<Pool, "query">): Promise<SupportArticle[]> {
  const r = await pool.query<SupportArticle>(
    "select id::text, kind, title, body, sort from support_articles order by kind, sort, lower(title)",
  );
  return r.rows;
}

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
// Who may answer a chat: CourtCaptain staff (every chat), or its organization's Owners and Admins.
async function mayHelp(pool: Pick<Pool, "query">, coachId: string, org: string | null): Promise<boolean> {
  if (await isStaff(pool, coachId)) return true;
  if (!org) return false;
  const r = await pool.query<{ ok: boolean }>("select acts_as($1, $2, 'Admin') as ok", [coachId, org]);
  return r.rows[0].ok;
}

async function loadChats(pool: Pick<Pool, "query">, viewer: SessionUser, where: string, params: unknown[]): Promise<SupportChat[]> {
  const r = await pool.query<Omit<SupportChat, "chattingWith" | "messages"> & { messages: (ChatMessage & { coachId: string; staff: boolean; admin: boolean })[] }>(
    `select q.id::text, u.first_name || ' ' || u.last_name as who, q.org, o.name as "orgName", q.status, q.asked_at as "startedAt",
            q.resolved_by as "resolvedBy",
            coalesce((select json_agg(json_build_object(
                        'id', m.id::text, 'coachId', m.coach_id, 'who', mu.first_name || ' ' || mu.last_name, 'body', m.body, 'at', m.sent_at,
                        'staff', exists (select 1 from platform_admins p where p.coach_id = m.coach_id),
                        'admin', q.org is not null and has_role(m.coach_id, q.org, 'Admin'))
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
      // Someone answering: CourtCaptain Support, or the organization's Admin (not the person who asked).
      helper: m.who === c.who && !m.staff ? null : m.staff ? "CourtCaptain Support" : m.admin ? `${c.orgName ?? "Organization"} Admin` : null,
      body: m.body,
      at: new Date(m.at),
      mine: m.coachId === viewer.coachId,
    }));
    const last = [...messages].reverse().find((m) => m.helper);
    return { ...c, messages, chattingWith: last ? `${last.who} · ${last.helper}` : null };
  });
}

// Start a chat from Support (in the organization the person is in). It's New until someone answering replies.
export async function askQuestion(deps: Deps, viewer: SessionUser, org: unknown, question: unknown): Promise<Result<{ id: string }>> {
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
// this organization for its Owners and Admins; null for everyone else.
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
    await deps.pool.query("update support_questions set status = $2, resolved_by = null, resolved_at = null where id = $1", [id, next]);
  return { ok: true };
}

// Mark a chat Resolved (it leaves New and Working), or open it again. The person who started it, or someone answering it.
export async function setChatResolved(deps: Deps, viewer: SessionUser, id: unknown, resolved: boolean): Promise<Result> {
  if (!isId(id)) return { ok: false, message: "That chat no longer exists." };
  const c = await deps.pool.query<{ coach_id: string; org: string | null }>("select coach_id, org from support_questions where id = $1", [id]);
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
export async function publishChat(deps: Deps, viewer: SessionUser, id: unknown, title: unknown, answer: unknown): Promise<Result> {
  if (!(await isStaff(deps.pool, viewer.coachId))) return staffOnly;
  const t = text(title, 120);
  const a = text(answer, 4000);
  if (!isId(id) || !t || !a) return { ok: false, message: "Fill in the question and the answer." };
  await deps.pool.query("insert into support_articles (kind, title, body, updated_by, updated_at) values ('faq', $1, $2, $3, $4)", [
    t,
    a,
    by(viewer),
    deps.now(),
  ]);
  return { ok: true };
}

// Add (id null) or change a ready-made question or How-to guide.
export async function saveArticle(
  deps: Deps,
  viewer: SessionUser,
  id: unknown,
  input: { kind: unknown; title: unknown; body: unknown; sort?: unknown },
): Promise<Result> {
  if (!(await isPlatformAdmin(deps.pool, viewer.coachId))) return staffOnly;
  const kind = input.kind === "faq" || input.kind === "howto" ? input.kind : null;
  const title = text(input.title, 120);
  const body = text(input.body, 4000);
  const sort = Number.isInteger(Number(input.sort)) ? Number(input.sort) : 100;
  if (!kind || !title || !body)
    return { ok: false, message: "Pick Question or How-to, and fill in the title and the answer or steps." };
  if (id === null) {
    await deps.pool.query(
      "insert into support_articles (kind, title, body, sort, updated_by, updated_at) values ($1, $2, $3, $4, $5, $6)",
      [kind, title, body, sort, by(viewer), deps.now()],
    );
    return { ok: true };
  }
  if (!isId(id)) return { ok: false, message: "That item no longer exists." };
  const r = await deps.pool.query(
    "update support_articles set kind = $2, title = $3, body = $4, sort = $5, updated_by = $6, updated_at = $7 where id = $1",
    [id, kind, title, body, sort, by(viewer), deps.now()],
  );
  return r.rowCount ? { ok: true } : { ok: false, message: "That item no longer exists." };
}

export async function deleteArticle(deps: Deps, viewer: SessionUser, id: unknown): Promise<Result> {
  if (!(await isPlatformAdmin(deps.pool, viewer.coachId))) return staffOnly;
  if (!isId(id)) return { ok: false, message: "That item no longer exists." };
  const r = await deps.pool.query("delete from support_articles where id = $1", [id]);
  return r.rowCount ? { ok: true } : { ok: false, message: "That item no longer exists." };
}

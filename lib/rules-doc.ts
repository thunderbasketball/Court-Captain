// A League's rules as a page in the app (SPEC.md section 13): the text of its Google Doc (exported as Markdown by the app's
// Google account, lib/google/sheets.ts), kept with the program and shown at /rules/<program> with a search. Directors of
// Programs refresh it (saving the link refreshes it too). Rendered as plain text blocks (never as HTML).
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { accessToken, loadServiceAccount, type ServiceAccount } from "./google/sheets";
import { googleDocId } from "./rules-link";
import type { Queryable } from "./sql";

export type RulesBlock = { kind: "p" | "li" | "row"; text: string; depth: number }; // depth: a list item's indent
export type RulesSection = { id: string; title: string; level: number; blocks: RulesBlock[] }; // level 1–3 (0: before any heading)
export type RulesPage = { id: string; name: string; org: string; sections: RulesSection[]; updatedAt: string | null; doc: string | null };

const MAX = 300_000;
const isId = (v: unknown): v is string => typeof v === "string" && /^\d{1,18}$/.test(v);

// Markdown's marks off: **bold**, _italic_, `code`, [text](link) → text, escaped characters, Google's {#anchors}.
export function plain(s: string): string {
  return s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\{#[^}]*\}/g, "")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[^\w*])[*_](\S(?:.*?\S)?)[*_](?=[^\w*]|$)/g, "$1$2")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\\([\\`*_{}[\]()#+\-.!|>~])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

const slug = (s: string, seen: Set<string>) => {
  const base = s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "section";
  let id = base;
  for (let n = 2; seen.has(id); n++) id = `${base}-${n}`;
  seen.add(id);
  return id;
};

// Pure: the Doc's Markdown as sections, one per heading (# to ###; deeper headings and a bold line alone stay inside as
// paragraphs), each with its paragraphs, list items and table rows.
export function parseRules(md: string): RulesSection[] {
  const seen = new Set<string>();
  const out: RulesSection[] = [];
  let cur: RulesSection = { id: slug("top", seen), title: "", level: 0, blocks: [] };
  let para: string[] = [];
  const flush = () => {
    const t = plain(para.join(" "));
    if (t) cur.blocks.push({ kind: "p", text: t, depth: 0 });
    para = [];
  };
  for (const raw of md.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.replace(/\s+$/, "");
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      const title = plain(h[2]);
      if (!title) continue;
      if (h[1].length > 3) {
        cur.blocks.push({ kind: "p", text: title, depth: 0 });
        continue;
      }
      if (cur.title || cur.blocks.length) out.push(cur);
      cur = { id: slug(title, seen), title, level: h[1].length, blocks: [] };
      continue;
    }
    const li = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (li) {
      flush();
      const t = plain(li[2]);
      if (t) cur.blocks.push({ kind: "li", text: t, depth: Math.min(3, Math.floor(li[1].replace(/\t/g, "    ").length / 2)) });
      continue;
    }
    if (/^\s*\|/.test(line)) {
      flush();
      if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) continue; // a table's divider
      const cells = line.trim().replace(/^\||\|$/g, "").split("|").map(plain).filter(Boolean);
      if (cells.length) cur.blocks.push({ kind: "row", text: cells.join(" · "), depth: 0 });
      continue;
    }
    if (!line.trim() || /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flush();
      continue;
    }
    para.push(line.trim());
  }
  flush();
  if (cur.title || cur.blocks.length) out.push(cur);
  return out;
}

// Anyone may read a League's rules (no login): its name and its rules' sections; null when it has none in the app.
export async function readRules(q: Pick<Queryable, "query">, id: unknown): Promise<RulesPage | null> {
  if (!isId(id)) return null;
  const r = await q.query<{ name: string; org: string; md: string | null; at: Date | null; url: string | null }>(
    "select name, org, rules_md as md, rules_md_at as at, rules_url as url from scenic_programs where id = $1 and kind = 'League'",
    [id],
  );
  const p = r.rows[0];
  if (!p?.md) return null;
  return { id, name: p.name, org: p.org, sections: parseRules(p.md), updatedAt: p.at?.toISOString() ?? null, doc: p.url };
}

type Deps = { pool: Pool; now: () => Date; fetch?: typeof fetch; key?: () => ServiceAccount };
export type RefreshResult = { ok: true; sections: number } | { ok: false; message: string };

// Read the program's rules link (a Google Doc) as Markdown and keep it. Who may is checked by the caller (Directors of
// Programs); this only reads the Doc and saves its text.
export async function refreshRules(deps: Deps, viewer: SessionUser, id: string): Promise<RefreshResult> {
  if (!isId(id)) return { ok: false, message: "That program no longer exists." };
  const p = (await deps.pool.query<{ url: string | null }>("select rules_url as url from scenic_programs where id = $1", [id])).rows[0];
  if (!p) return { ok: false, message: "That program no longer exists." };
  const doc = p.url ? googleDocId(p.url) : null;
  if (!doc) return { ok: false, message: "Add the rules' Google Doc link first." };
  const f = deps.fetch ?? fetch;
  let key: ServiceAccount;
  try {
    key = (deps.key ?? loadServiceAccount)();
  } catch {
    return { ok: false, message: "The app's Google account isn't set up here." };
  }
  const token = await accessToken({ key, fetch: f, now: deps.now }, "https://www.googleapis.com/auth/drive.readonly");
  const res = await f(`https://www.googleapis.com/drive/v3/files/${doc}/export?mimeType=text%2Fmarkdown`, { headers: { authorization: `Bearer ${token}` } });
  const text = await res.text();
  if (!res.ok) {
    if (/SERVICE_DISABLED|accessNotConfigured/.test(text)) return { ok: false, message: "Google Drive isn't turned on for the app's Google account yet." };
    if (res.status === 404 || res.status === 403)
      return { ok: false, message: `The app can't open that Doc. In Google Docs, tap Share and add ${key.client_email} as a Viewer.` };
    return { ok: false, message: "Google didn't send the Doc. Please try again." };
  }
  if (text.length > MAX) return { ok: false, message: "The rules are too long to show here (300,000 characters at most)." };
  const sections = parseRules(text);
  if (!sections.length) return { ok: false, message: "That Doc is empty." };
  await deps.pool.query("update scenic_programs set rules_md = $2, rules_md_by = $3, rules_md_at = $4 where id = $1", [
    id,
    text,
    `${viewer.firstName} ${viewer.lastName}`,
    deps.now(),
  ]);
  return { ok: true, sections: sections.length };
}

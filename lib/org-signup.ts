// Registering a new organization on CourtCaptain (SPEC.md section 14). It's live at once: the person registering is its
// Owner (also Admin and Director). They pick the features they need: those that work for any organization today are
// turned on; the others are recorded as requested.
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { FEATURES, READY_FOR_ANY_ORG, type Feature } from "./features";
import { withTx } from "./sql";

type Deps = { pool: Pool; now: () => Date };
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

export const ORG_KINDS = ["School", "Club", "League", "Organization"] as const;
export const ORG_COLORS = [
  "#1d4ed8",
  "#0f766e",
  "#15803d",
  "#b91c1c",
  "#c2410c",
  "#7c3aed",
  "#be185d",
  "#13294b",
  "#18181b",
] as const;
const MAX_LOGO = 512 * 1024;
const by = (v: SessionUser) => `${v.firstName} ${v.lastName}`;

export type NewOrgInput = { name: unknown; short: unknown; kind: unknown; color: unknown; features: unknown };
export type Logo = { bytes: Uint8Array; type: string } | null;

// Organization names: letters, numbers, spaces and . ' & - , ( ), starting with a letter or number (never a formula).
const cleanOrgName = (v: unknown, max: number) => {
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/\s+/g, " ");
  return s.length >= 2 && s.length <= max && /^[A-Za-z0-9][A-Za-z0-9 .'&\-,()]*$/.test(s) ? s : null;
};

// The image's real type from its first bytes (PNG, JPEG or WebP), whatever the browser said.
export function logoType(bytes: Uint8Array): string | null {
  const b = (i: number) => bytes[i];
  if (b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47) return "image/png";
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return "image/jpeg";
  if (String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP")
    return "image/webp";
  return null;
}

export const slugFor = (name: string) =>
  name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36)
    .replace(/-+$/g, "") || "org";

export async function createOrganization(
  deps: Deps,
  viewer: SessionUser,
  input: NewOrgInput,
  logo: Logo,
): Promise<Result<{ slug: string; on: Feature[]; requested: Feature[] }>> {
  const name = cleanOrgName(input.name, 60);
  if (!name) return { ok: false, message: "Enter the organization's name: letters, numbers and simple punctuation." };
  const short =
    typeof input.short === "string" && input.short.trim() ? cleanOrgName(input.short, 20) : name.length <= 20 ? name : null;
  if (!short) return { ok: false, message: 'Enter a short name (up to 20 characters), e.g. "Baylor".' };
  const kind = ORG_KINDS.find((k) => k === input.kind);
  if (!kind) return { ok: false, message: "Choose School, Club, League or Organization." };
  const color = ORG_COLORS.find((c) => c === input.color) ?? ORG_COLORS[0];
  const picked = Array.isArray(input.features)
    ? [...new Set(input.features)].filter((f): f is Feature => FEATURES.some((x) => x.key === f) && f !== "alerts")
    : [];
  if (!picked.length) return { ok: false, message: "Choose at least one thing you need." };
  if (logo) {
    if (logo.bytes.length > MAX_LOGO) return { ok: false, message: "The logo must be 512 KB or smaller." };
    if (!logoType(logo.bytes)) return { ok: false, message: "The logo must be a PNG, JPEG or WebP image." };
  }
  const on = picked.filter((f) => READY_FOR_ANY_ORG.has(f));
  const requested = picked.filter((f) => !READY_FOR_ANY_ORG.has(f));
  return withTx(deps.pool, async (q) => {
    const taken = await q.query("select 1 from organizations where lower(name) = lower($1)", [name]);
    if (taken.rowCount) return { ok: false as const, message: `There's already an organization named ${name} on CourtCaptain.` };
    const base = slugFor(name);
    let slug = base;
    for (let n = 2; (await q.query("select 1 from organizations where slug = $1", [slug])).rowCount; n++) slug = `${base}-${n}`;
    await q.query(
      `insert into organizations (slug, name, short_name, kind, color, logo, logo_type, logo_updated_at, created_by, created_at, abbr)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        slug,
        name,
        short,
        kind,
        color,
        logo ? Buffer.from(logo.bytes) : null,
        logo ? logoType(logo.bytes) : null,
        logo ? deps.now() : null,
        by(viewer),
        deps.now(),
        abbrFor(short ?? name),
      ],
    );
    await q.query(
      "insert into org_role_types (org, role) select $1, r from unnest(array['Request', 'Coach', 'Director', 'Admin', 'Owner']) r",
      [slug],
    );
    await q.query(
      "select set_role($1, $2, 'Owner', true, $3), set_role($1, $2, 'Admin', true, $3), set_role($1, $2, 'Director', true, $3)",
      [viewer.coachId, slug, by(viewer)],
    );
    for (const f of on)
      await q.query(
        "insert into org_features (org, feature, source, turned_on_by, turned_on_at) values ($1, $2, 'setup', $3, $4)",
        [slug, f, by(viewer), deps.now()],
      );
    for (const f of requested)
      await q.query("insert into org_feature_requests (org, feature, asked_by, asked_at) values ($1, $2, $3, $4)", [
        slug,
        f,
        by(viewer),
        deps.now(),
      ]);
    return { ok: true as const, slug, on, requested };
  });
}

// The Owner (or an Admin) changes the logo later.
export async function setOrgLogo(deps: Deps, viewer: SessionUser, org: string, logo: Logo): Promise<Result> {
  if (!logo) return { ok: false, message: "Choose an image." };
  if (logo.bytes.length > MAX_LOGO) return { ok: false, message: "The logo must be 512 KB or smaller." };
  const type = logoType(logo.bytes);
  if (!type) return { ok: false, message: "The logo must be a PNG, JPEG or WebP image." };
  const admin = await deps.pool.query<{ ok: boolean }>("select acts_as($1, $2, 'Admin') as ok", [viewer.coachId, org]);
  if (!admin.rows[0].ok) return { ok: false, message: "Only an Admin of this organization can change its logo." };
  await deps.pool.query("update organizations set logo = $2, logo_type = $3, logo_updated_at = $4 where slug = $1", [
    org,
    Buffer.from(logo.bytes),
    type,
    deps.now(),
  ]);
  return { ok: true };
}

// Admins (and CourtCaptain staff): the organization's color, one of ORG_COLORS (its tabs, header line and letter badge).
export async function setOrgColor(deps: Deps, viewer: SessionUser, org: string, color: unknown): Promise<Result> {
  if (!(ORG_COLORS as readonly unknown[]).includes(color)) return { ok: false, message: "Pick one of the colors." };
  const admin = await deps.pool.query<{ ok: boolean }>("select acts_as($1, $2, 'Admin') as ok", [viewer.coachId, org]);
  if (!admin.rows[0].ok) return { ok: false, message: "Only an Admin of this organization can change its color." };
  await deps.pool.query("update organizations set color = $2 where slug = $1", [org, color]);
  return { ok: true };
}

// A starting Abbreviation (shown before team names in leagues, "ER 5B Harris"): the initials of the name's words, or
// its first letters when it's one word; Admins change it in the gear.
export function abbrFor(name: string): string {
  const words = name
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const a = words.length > 1 ? words.map((w) => w[0]).join("") : (words[0] ?? "ORG").slice(0, 5);
  return (a.toUpperCase() === a ? a : a[0].toUpperCase() + a.slice(1)).slice(0, 6) || "ORG";
}

// Admins (and CourtCaptain staff): the Abbreviation, 1–6 letters or numbers.
export async function setOrgAbbr(deps: Deps, viewer: SessionUser, org: string, abbr: unknown): Promise<Result> {
  const a = typeof abbr === "string" ? abbr.trim() : "";
  if (!/^[A-Za-z0-9]{1,6}$/.test(a)) return { ok: false, message: "Abbreviation: 1 to 6 letters or numbers." };
  const admin = await deps.pool.query<{ ok: boolean }>("select acts_as($1, $2, 'Admin') as ok", [viewer.coachId, org]);
  if (!admin.rows[0].ok) return { ok: false, message: "Only an Admin of this organization can change its abbreviation." };
  await deps.pool.query("update organizations set abbr = $2 where slug = $1", [org, a]);
  // Its teams' names in leagues follow.
  await deps.pool.query(
    `update scenic_teams st set name = $2 || ' ' || t.name from org_teams t where st.org_team_id = t.id and t.org = $1`,
    [org, a],
  );
  return { ok: true };
}

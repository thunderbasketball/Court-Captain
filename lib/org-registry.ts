import type { Queryable } from "./sql";
import { memo, remembering } from "./request-memo";
import type { OrgSlug } from "./orgs";

// Organizations as the app shows them (SPEC.md section 14): name, short name, type, color, logo and login link.
// `logo` is null when the organization has none yet (a letter badge in its color is shown).
export type Org = {
  slug: OrgSlug;
  name: string;
  short: string;
  kind: "Organization" | "School" | "Club" | "League" | "Team"; // Team: a CourtSolo account
  color: string;
  logo: string | null;
  bigLogo: string | null;
  login: string;
  abbr: string; // before its team names in leagues ("ER 5B Harris")
};

type Row = {
  slug: string;
  name: string;
  short_name: string;
  abbr: string | null;
  kind: Org["kind"];
  color: string;
  logo_path: string | null;
  big_logo_path: string | null;
  has_logo: boolean;
  v: string | null;
};

const SELECT = `select slug, name, short_name, abbr, kind, color, logo_path, big_logo_path, logo is not null as has_logo,
  extract(epoch from logo_updated_at)::bigint::text as v from organizations`;

const toOrg = (r: Row): Org => {
  const uploaded = r.has_logo ? `/org-logo/${r.slug}?v=${r.v ?? "0"}` : null;
  return {
    slug: r.slug,
    name: r.name,
    short: r.short_name,
    kind: r.kind,
    color: r.color,
    // An uploaded logo replaces the built-in one.
    logo: uploaded ?? r.logo_path,
    bigLogo: uploaded ?? r.big_logo_path,
    login: `/login/${r.slug}`,
    abbr: r.abbr ?? r.slug.slice(0, 4).toUpperCase(),
  };
};

// Every organization: Thunder and Scenic City first, then by name. While a page is being built this is read once and
// reused (orgInfo too); saving a change, or inside a transaction, reads fresh.
export async function listOrgs(q: Pick<Queryable, "query">): Promise<Org[]> {
  const read = async () => {
    const r = await q.query<Row>(`${SELECT} order by (slug = 'thunder') desc, (slug = 'scenic-city') desc, lower(name)`);
    return r.rows.map(toOrg);
  };
  return "totalCount" in q && remembering() ? memo(q, "orgs", read) : read();
}

export async function orgInfo(q: Pick<Queryable, "query">, slug: string): Promise<Org | null> {
  if ("totalCount" in q && remembering()) {
    const hit = (await listOrgs(q)).find((o) => o.slug === slug);
    if (hit) return hit;
  }
  const r = await q.query<Row>(`${SELECT} where slug = $1`, [slug]);
  return r.rows[0] ? toOrg(r.rows[0]) : null;
}

// For messages: "Thunder", or the slug if it's gone.
export async function orgShort(q: Pick<Queryable, "query">, slug: string): Promise<string> {
  return (await orgInfo(q, slug))?.short ?? slug;
}
export async function orgName(q: Pick<Queryable, "query">, slug: string): Promise<string> {
  return (await orgInfo(q, slug))?.name ?? slug;
}

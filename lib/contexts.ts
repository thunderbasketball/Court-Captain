// The roles a person can switch between: Thunder Director, one per Thunder team they're on, one per Scenic City role,
// and CourtCaptain Admin (the platform itself, SPEC section 14).
// Read from the database on every request, so a removed role disappears at once.
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { BUILT_IN, SCENIC_ROLES, type OrgSlug, type ScenicRole } from "./orgs";
import { isPlatformAdmin } from "./platform";
import type { Role } from "./teams";

export type RoleContext =
  | { key: "director"; org: OrgSlug; label: string; href: string }
  | { key: `team:${string}`; org: OrgSlug; label: string; href: string; teamId: string; teamName: string; role: Role }
  | { key: `scenic:${ScenicRole}`; org: OrgSlug; label: string; href: string; role: ScenicRole }
  | { key: "platform"; org: typeof PLATFORM; label: string; href: string }
  // A registered organization (not Thunder or Scenic City): one chip with the person's top role there.
  | { key: `org:${string}`; org: OrgSlug; label: string; href: string };

// The platform's own "organization" in the switcher: CourtCaptain Admins only.
export const PLATFORM = "courtcaptain";

export const CONTEXT_COOKIE = "thunder_context";

const ROLE_LABEL: Record<Role, string> = {
  HeadCoach: "Head Coach",
  AsstCoach: "Asst Coach",
  Manager: "Manager",
  TeamParent: "Team Parent",
};

export async function userContexts(pool: Pick<Pool, "query">, viewer: SessionUser): Promise<RoleContext[]> {
  const out: RoleContext[] = [];
  // CourtCaptain staff: Owner-level access to every organization, in the background (a way into each one).
  const staff = await isPlatformAdmin(pool, viewer.coachId);
  // Owners and Admins (who also hold the Director role) see "Owner" or "Admin" on their Director chip.
  const admins = await pool.query<{ org: string; role: string }>(
    "select org, role from org_roles where coach_id = $1 and role in ('Admin', 'Owner')",
    [viewer.coachId],
  );
  const top = (org: string) =>
    staff || admins.rows.some((r) => r.org === org && r.role === "Owner")
      ? "Owner"
      : admins.rows.some((r) => r.org === org)
        ? "Admin"
        : "Director";
  // The Director chip opens Thunder's Home (a card for each part they can open), like every organization's.
  if (viewer.isDirector) out.push({ key: "director", org: "thunder", label: top("thunder"), href: "/thunder" });
  // One chip per team, showing the person's highest role there.
  const r = await pool.query<{ id: string; name: string; role: Role }>(
    `select distinct on (t.id) t.id::text, t.name, s.role
     from team_staff s join teams t on t.id = s.team_id
     where s.coach_id = $1
     order by t.id, array_position(array['HeadCoach','AsstCoach','Manager','TeamParent'], s.role)`,
    [viewer.coachId],
  );
  const teams = r.rows.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  for (const t of teams)
    out.push({
      key: `team:${t.id}`,
      org: "thunder",
      label: `${t.name} · ${ROLE_LABEL[t.role]}`,
      href: `/teams/${t.id}`,
      teamId: t.id,
      teamName: t.name,
      role: t.role,
    });
  // One Scenic City chip per role (Director, Partner, Solo, Coach): each shows Scenic City as that role sees it.
  const sc = await pool.query<{ role: ScenicRole }>(
    `select role from org_roles where coach_id = $1 and org = 'scenic-city' and role = any($2::text[])
     order by array_position($2::text[], role)`,
    [viewer.coachId, SCENIC_ROLES],
  );
  const scenicRoles = sc.rows.map((r) => r.role);
  if (staff && !scenicRoles.includes("Director")) scenicRoles.unshift("Director");
  for (const role of scenicRoles)
    out.push({
      key: `scenic:${role}`,
      org: "scenic-city",
      label: role === "Director" ? top("scenic-city") : role,
      href: "/scenic",
      role,
    });
  // Registered organizations: one chip each, with the person's top role (Owner, Admin, Director, Coach).
  const others = await pool.query<{ org: string; name: string; role: string }>(
    `select r.org, o.short_name as name, r.role from org_roles r join organizations o on o.slug = r.org
     where r.coach_id = $1 and r.org <> all($2::text[]) and r.role in ('Owner', 'Admin', 'Director', 'Coach')
     order by lower(o.short_name), array_position(array['Owner', 'Admin', 'Director', 'Coach'], r.role)`,
    [viewer.coachId, BUILT_IN],
  );
  for (const r of others.rows)
    if (!out.some((c) => c.key === `org:${r.org}`))
      out.push({ key: `org:${r.org}`, org: r.org, label: r.role, href: `/org/${r.org}` });
  if (staff) {
    const all = await pool.query<{ slug: string }>(
      "select slug from organizations where slug <> all($1::text[]) order by lower(short_name)",
      [BUILT_IN],
    );
    for (const { slug } of all.rows)
      if (!out.some((c) => c.key === `org:${slug}`))
        out.push({ key: `org:${slug}`, org: slug, label: "Owner", href: `/org/${slug}` });
  }
  // Last, so an organization stays the default for admins who haven't picked yet.
  if (staff) out.push({ key: "platform", org: PLATFORM, label: "Admin", href: "/platform" });
  return out;
}

// The remembered context if the person still holds it, otherwise their first one.
export function pickContext(contexts: RoleContext[], remembered: string | undefined): RoleContext | null {
  return contexts.find((c) => c.key === remembered) ?? contexts[0] ?? null;
}

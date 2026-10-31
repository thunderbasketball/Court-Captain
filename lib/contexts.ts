// The roles a person can switch between: Thunder Director, one per Thunder team they're on, one per Scenic City role,
// and CourtCaptain Admin (the platform itself, SPEC section 14).
// Read from the database on every request, so a removed role disappears at once.
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { SCENIC_ROLES, type OrgSlug, type ScenicRole } from "./orgs";
import { hasArea, isThunderAdmin } from "./org-admin";
import { isPlatformAdmin } from "./platform";
import type { Role } from "./teams";

export type RoleContext =
  | { key: "director"; org: OrgSlug; label: string; href: string }
  | { key: `team:${string}`; org: OrgSlug; label: string; href: string; teamId: string; teamName: string; role: Role }
  | { key: `scenic:${ScenicRole}`; org: OrgSlug; label: string; href: string; role: ScenicRole }
  | { key: "platform"; org: typeof PLATFORM; label: string; href: string };

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
  // Owners and Admins (who also hold the Director role) see "Owner" or "Admin" on their Director chip.
  const admins = await pool.query<{ org: string; role: string }>(
    "select org, role from org_roles where coach_id = $1 and role in ('Admin', 'Owner')",
    [viewer.coachId],
  );
  const top = (org: string) =>
    admins.rows.some((r) => r.org === org && r.role === "Owner")
      ? "Owner"
      : admins.rows.some((r) => r.org === org)
        ? "Admin"
        : "Director";
  // The Director chip opens their first area's page (with no area yet: Users for Admins, else Announcements).
  const home = hasArea(viewer, "teams")
    ? "/teams"
    : hasArea(viewer, "facilities")
      ? "/practice"
      : hasArea(viewer, "programs")
        ? "/events"
        : hasArea(viewer, "players")
          ? "/members/players"
          : hasArea(viewer, "coaches")
            ? "/members/coaches"
            : isThunderAdmin(viewer)
              ? "/members/staff"
              : "/inbox";
  if (viewer.isDirector) out.push({ key: "director", org: "thunder", label: top("thunder"), href: home });
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
  for (const { role } of sc.rows)
    out.push({
      key: `scenic:${role}`,
      org: "scenic-city",
      label: role === "Director" ? top("scenic-city") : role,
      href: "/scenic",
      role,
    });
  // Last, so an organization stays the default for admins who haven't picked yet.
  if (await isPlatformAdmin(pool, viewer.coachId))
    out.push({ key: "platform", org: PLATFORM, label: "Admin", href: "/platform" });
  return out;
}

// The remembered context if the person still holds it, otherwise their first one.
export function pickContext(contexts: RoleContext[], remembered: string | undefined): RoleContext | null {
  return contexts.find((c) => c.key === remembered) ?? contexts[0] ?? null;
}

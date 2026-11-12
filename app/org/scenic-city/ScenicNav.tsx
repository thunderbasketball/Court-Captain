import Link from "next/link";
import type { SessionUser } from "@/lib/auth/service";
import { db } from "@/lib/db";
import { orgHasArea } from "@/lib/org-admin";
import { easternDate } from "@/lib/time";

// Scenic City's sub-tabs under Programs, Facilities and Members (SPEC.md section 13). Which ones show is checked here
// on the server, like every page behind them.
const ORG = "scenic-city";

function SubNav({
  label,
  links,
  current,
}: {
  label: string;
  links: { key: string; href: string; label: string }[];
  current: string;
}) {
  if (links.length < 2) return null;
  return (
    <nav aria-label={label} className="mb-5 flex gap-1 overflow-x-auto border-b border-zinc-200 dark:border-white/10">
      {links.map((l) => (
        <Link
          key={l.key}
          href={l.href}
          aria-current={current === l.key ? "page" : undefined}
          className={`shrink-0 border-b-2 px-3 py-2 text-sm font-semibold whitespace-nowrap ${
            current === l.key
              ? "border-scenic-navy text-zinc-900 dark:border-white dark:text-white"
              : "border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
          }`}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}

// Programs: one tab per active program (not finished), then All programs. `current`: a program id or "all".
export async function ProgramsNav({ current }: { current: string }) {
  const active = await db.query<{ id: string; name: string }>(
    "select id::text, name from scenic_programs where ends_on >= $1::date order by starts_on, lower(name)",
    [easternDate(new Date())],
  );
  const links = [
    ...active.rows.map((p) => ({ key: p.id, href: `/org/scenic-city/programs/${p.id}`, label: p.name })),
    { key: "all", href: "/org/scenic-city/programs", label: "All programs" },
  ];
  return <SubNav label="Programs" links={links} current={current} />;
}

// Facilities (Admins and Directors of Facilities): Game days, Courts, each hosting site and All sites.
// `current`: "game-days", a hosting site's id, or "all".
export async function FacilitiesNav({ user, current }: { user: SessionUser; current: string }) {
  const director = await orgHasArea(db, user.coachId, ORG, "facilities");
  const sites = director
    ? (
        await db.query<{ id: string; name: string }>(
          "select id::text, name from partners where approved and hosts_games order by lower(name)",
        )
      ).rows
    : [];
  const links = [
    { key: "game-days", href: "/org/scenic-city/game-days", label: "Game days" },
    ...(director ? [{ key: "courts", href: "/org/scenic-city/courts", label: "Courts" }] : []),
    ...sites.map((p) => ({ key: p.id, href: `/org/scenic-city/partners/${p.id}`, label: p.name })),
    ...(director ? [{ key: "all", href: "/org/scenic-city/partners", label: "All sites" }] : []),
  ];
  return <SubNav label="Facilities" links={links} current={current} />;
}

// Who sees which Members tab: Staff (Admins: join requests and roles), Hosting Sites (Admins and Directors of
// Facilities: each site's Owners and Admins), Coaches (Admins and Directors of Coaches, Teams or Programs).
export async function membersLinks(user: SessionUser) {
  const [staff, sites, coaches] = await Promise.all([
    orgHasArea(db, user.coachId, ORG), // no area: Admins only
    orgHasArea(db, user.coachId, ORG, "facilities"),
    orgHasArea(db, user.coachId, ORG, "teams", "programs"),
  ]);
  return [
    ...(staff ? [{ key: "staff", href: "/org/scenic-city/users", label: "Staff" }] : []),
    ...(sites ? [{ key: "hosting-sites", href: "/org/scenic-city/members/hosting-sites", label: "Hosting Organizations" }] : []),
    ...(coaches ? [{ key: "coaches", href: "/org/scenic-city/members/coaches", label: "Coaches" }] : []),
  ];
}

export async function MembersNav({ user, current }: { user: SessionUser; current: string }) {
  return <SubNav label="Members" links={await membersLinks(user)} current={current} />;
}

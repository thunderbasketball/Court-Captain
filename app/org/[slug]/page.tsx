import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { canHost } from "@/lib/facilities";
import { hasFeature } from "@/lib/features";
import { isOrgAdmin, orgHasArea } from "@/lib/org-admin";
import { orgInfo } from "@/lib/org-registry";
import { isOrgSlug } from "@/lib/orgs";
import AppHeader from "../../AppHeader";
import { card } from "../../ui";
import { followRename } from "@/lib/org-rename";
import { orgMetrics } from "@/lib/org-metrics";
import { visitStats } from "@/lib/site-visits";
import OrgMetrics from "../../OrgMetrics";

export default function OrgHomePage({ params }: PageProps<"/org/[slug]">) {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <OrgHome params={params} />
    </Suspense>
  );
}

// A registered organization's Home (SPEC.md section 14), the same layout as every organization's: the metrics for Owners
// and Admins, then a card for each part
// this person can open (the same parts as the tabs). Its name and logo are in the header; its settings in the gear.
async function OrgHome({ params }: { params: PageProps<"/org/[slug]">["params"] }) {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  const { slug } = await params;
  await followRename(slug, (s) => `/org/${s}`);
  const o = isOrgSlug(slug) ? await orgInfo(db, slug) : null;
  if (!o) notFound();
  // Anyone with a role there (CourtCaptain staff too, in the background).
  const member = await db.query(
    "select 1 where acts_as($1, $2, 'Director') or exists (select 1 from org_roles where coach_id = $1 and org = $2 and role <> 'Request')",
    [user.coachId, slug],
  );
  if (!member.rowCount) notFound();
  const [teams, admin, teamsArea, coachesArea, hosting, facilities, coaching] = await Promise.all([
    hasFeature(db, slug, "team-building"),
    isOrgAdmin(db, user.coachId, slug),
    orgHasArea(db, user.coachId, slug, "teams"),
    orgHasArea(db, user.coachId, slug, "teams"),
    canHost(db, slug),
    orgHasArea(db, user.coachId, slug, "facilities"),
    db.query(
      "select 1 from org_team_coaches c join org_teams t on t.id = c.team_id where t.org = $1 and c.coach_id = $2 limit 1",
      [slug, user.coachId],
    ),
  ]);
  const role = admin ? "Admin" : teamsArea || coachesArea || facilities ? "Director" : "Coach";
  // Owners and Admins: the organization's metrics above the cards.
  const now = new Date();
  const [metrics, visits] = admin
    ? await Promise.all([
        orgMetrics({ pool: db, now: () => now }, user, slug),
        visitStats({ pool: db, now: () => now }, user, slug),
      ])
    : [null, null];
  const parts = [
    ...(teams && (teamsArea || coaching.rowCount)
      ? [
          {
            title: "Teams",
            about: "Your teams and coaches, importing teams, and registering for league programs.",
            href: `/org/${slug}/teams`,
          },
        ]
      : []),
    ...(hosting && facilities
      ? [
          {
            title: "Facilities",
            about: "Your gyms and courts, their availability, and hosting leagues' games.",
            href: `/org/${slug}/facilities`,
          },
        ]
      : []),
    ...(admin || (teams && coachesArea)
      ? [{ title: "Members", about: "Staff (Owners, Admins and Directors) and coaches.", href: `/org/${slug}/members` }]
      : []),
  ];

  return (
    <>
      <AppHeader user={user} context={`org:${slug}`} tab="org-home" />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
          Welcome, {user.firstName} · {role}
        </p>
        {metrics && <OrgMetrics m={metrics} visits={visits} base={`/org/${slug}`} thunder={false} now={now} />}
        {!parts.length && <p className="text-sm text-zinc-500">Nothing to show here yet.</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          {parts.map((p) => (
            <Link key={p.title} href={p.href} className={`${card} block p-4 hover:ring-zinc-400/40`}>
              <h2 className="font-semibold">{p.title}</h2>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{p.about}</p>
            </Link>
          ))}
        </div>
      </main>
    </>
  );
}

import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { canHost } from "@/lib/facilities";
import { hasFeature } from "@/lib/features";
import { isOrgAdmin, orgHasArea } from "@/lib/org-admin";
import { orgInfo } from "@/lib/org-registry";
import { isOrgSlug } from "@/lib/orgs";
import AppHeader from "../../AppHeader";
import { followRename } from "@/lib/org-rename";
import { orgShort } from "@/lib/org-registry";
import { OrgSearchButton } from "../../OrgSearch";
import { orgMetrics } from "@/lib/org-metrics";
import { visitStats } from "@/lib/site-visits";
import OrgMetrics, { todoCounts } from "../../OrgMetrics";
import MembersCards from "../../MembersCards";
import SupportCard from "../../SupportCard";
import { OrgTeamsContent } from "./teams/content";
import { OrgFacilitiesContent } from "./facilities/content";
import { OrgMembersContent } from "./members/content";

export default function OrgHomePage({ params }: PageProps<"/org/[slug]">) {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <OrgHome params={params} />
    </Suspense>
  );
}

// A registered organization's Home (SPEC.md section 14), the same layout as every organization's: a stack of cards, one
// per part this person can open (the same parts as the tabs): Home (the metrics, for Owners and Admins) open first, then
// Teams, Facilities, Members and Support, each loading in the background and opening on its own. Its name and logo are
// in the header; its settings in the gear.
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
  // 🔍 search: Owners, Admins and Directors.
  const search = (await db.query<{ ok: boolean }>("select acts_as($1, $2, 'Director') as ok", [user.coachId, slug])).rows[0].ok;
  const orgName = await orgShort(db, slug);
  const role = admin ? "Admin" : teamsArea || coachesArea || facilities ? "Director" : "Coach";
  // Owners and Admins: the organization's metrics above the cards.
  const now = new Date();
  const [metrics, visits] = admin
    ? await Promise.all([
        orgMetrics({ pool: db, now: () => now }, user, slug),
        visitStats({ pool: db, now: () => now }, user, slug),
      ])
    : [null, null];
  // Home as a stack of cards, one per tab this person can open (the same parts, in the same order): Home first and open;
  // the others load in the background after the page shows and open on their own.
  const here = Promise.resolve({ slug });
  const cards = [
    ...(metrics
      ? [
          {
            key: "home",
            title: "Home",
            alert: todoCounts(metrics).open > 0,
            body: <OrgMetrics m={metrics} visits={visits} base={`/org/${slug}`} thunder={false} now={now} />,
          },
        ]
      : []),
    ...(teams && (teamsArea || coaching.rowCount)
      ? [
          {
            key: "teams",
            title: "Teams",
            count: metrics?.teams?.total,
            alert: (metrics?.missing.length ?? 0) > 0,
            body: <OrgTeamsContent params={here} embedded />,
          },
        ]
      : []),
    ...(hosting && facilities
      ? [{ key: "facilities", title: "Facilities", body: <OrgFacilitiesContent params={here} embedded /> }]
      : []),
    ...(admin || (teams && coachesArea)
      ? [{ key: "members", title: "Members", alert: (metrics?.waiting.requests ?? 0) > 0, body: <OrgMembersContent params={here} embedded /> }]
      : []),
    { key: "support", title: "Support", alert: (metrics?.waiting.newChats ?? 0) > 0, body: <SupportCard user={user} org={slug} /> },
  ];

  return (
    <>
      <AppHeader user={user} context={`org:${slug}`} tab="org-home" />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Welcome, {user.firstName} · {role}
          </p>
          {search && <OrgSearchButton org={slug} orgName={orgName} />}
        </div>
        <MembersCards cards={cards} open={null} heading={null} />
      </main>
    </>
  );
}

import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { directorsPanel } from "@/lib/org-admin";
import { orgInfo } from "@/lib/org-registry";
import { isOrgSlug } from "@/lib/orgs";
import AppHeader from "../../AppHeader";
import OrgLogo from "../../OrgLogo";
import OrgGear from "../../OrgGear";
import { PageTitle } from "../../ui";

export default function OrgHomePage({ params }: PageProps<"/org/[slug]">) {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <OrgHome params={params} />
    </Suspense>
  );
}

// A registered organization's home (SPEC.md section 14): its look and login link, and, for its Admins, the gear (features
// and logo); its Admins & Directors are under Members → Staff. Only for people with a role there.
async function OrgHome({ params }: { params: PageProps<"/org/[slug]">["params"] }) {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  const { slug } = await params;
  const o = isOrgSlug(slug) ? await orgInfo(db, slug) : null;
  if (!o) notFound();
  // Anyone with a role there (CourtCaptain staff too, in the background).
  const member = await db.query(
    "select 1 where acts_as($1, $2, 'Director') or exists (select 1 from org_roles where coach_id = $1 and org = $2 and role <> 'Request')",
    [user.coachId, slug],
  );
  if (!member.rowCount) notFound();
  const panel = await directorsPanel({ pool: db, now: () => new Date() }, user, slug);

  return (
    <>
      <AppHeader user={user} context={`org:${slug}`} tab="org-home" />
      <main className="mx-auto w-full max-w-3xl flex-1 space-y-5 px-4 py-6">
        <div className="flex items-start gap-4">
          <OrgLogo src={o.logo} name={o.name} color={o.color} className="size-16 rounded-2xl text-2xl" />
          <div className="min-w-0 flex-1">
            <PageTitle title={o.name} subtitle={`${o.kind} on CourtCaptain · login link: /login/${o.slug}`} />
          </div>
          <OrgGear org={slug} coachId={user.coachId} />
        </div>

        {panel && (
          <p className="text-sm text-zinc-500">
            Admins &amp; Directors are under{" "}
            <Link href={`/org/${slug}/members`} className="font-medium text-thunder-blue hover:underline">
              Members → Staff
            </Link>
            .
          </p>
        )}
      </main>
    </>
  );
}

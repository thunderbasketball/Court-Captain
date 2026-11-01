import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { isOrgAdmin } from "@/lib/org-admin";
import { orgInfo } from "@/lib/org-registry";
import { COACH_ROLES, listOrgCoaches } from "@/lib/org-teams";
import { formatCell } from "@/lib/phone";
import AppHeader from "../../../../AppHeader";
import { PageTitle, PhoneLink, card } from "../../../../ui";
import OrgMembersNav from "../OrgMembersNav";

export default function OrgCoachesPage({ params }: PageProps<"/org/[slug]/members/coaches">) {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <OrgCoaches params={params} />
    </Suspense>
  );
}

// Members → Coaches: everyone coaching the organization's teams, by last name, with their cell and teams (Head or
// Assistant Coach). Coaches are added on each team's page.
async function OrgCoaches({ params }: { params: PageProps<"/org/[slug]/members/coaches">["params"] }) {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  const { slug } = await params;
  const [o, coaches, admin] = await Promise.all([
    orgInfo(db, slug),
    listOrgCoaches({ pool: db, now: () => new Date() }, user, slug),
    isOrgAdmin(db, user.coachId, slug),
  ]);
  if (!o || !coaches) notFound();
  const role = (r: string) => COACH_ROLES.find((x) => x.key === r)?.name ?? r;

  return (
    <>
      <AppHeader user={user} context={`org:${slug}`} tab="org-members" />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <PageTitle title="Members" subtitle={o.name} />
        <OrgMembersNav slug={slug} current="coaches" staff={admin} coaches />
        <section className={`${card} p-4`}>
          <h2 className="font-semibold">Coaches ({coaches.length})</h2>
          <p className="mb-2 text-sm text-zinc-500">Add coaches on each team&apos;s page (Teams).</p>
          {!coaches.length && <p className="text-sm text-zinc-500">No coaches yet.</p>}
          <ul className="divide-y divide-zinc-100 dark:divide-white/5">
            {coaches.map((c) => (
              <li key={c.id} className="py-2.5 text-sm">
                <p className="flex flex-wrap items-baseline gap-x-2 font-medium">
                  {c.name}
                  <PhoneLink cell={c.cell} label={formatCell(c.cell)} />
                </p>
                <p className="text-zinc-600 dark:text-zinc-300">
                  {c.teams.map((t, i) => (
                    <span key={t.id}>
                      {i > 0 && " · "}
                      <Link href={`/org/${slug}/teams/${t.id}`} className="text-thunder-blue hover:underline">
                        {t.name}
                      </Link>{" "}
                      <span className="text-xs text-zinc-500">({role(t.role)})</span>
                    </span>
                  ))}
                </p>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </>
  );
}

import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { currentScenic } from "@/lib/contexts-server";
import { db } from "@/lib/db";
import { formatCell } from "@/lib/phone";
import { hostingSiteStaff } from "@/lib/scenic-members";
import AppHeader from "../../../AppHeader";
import { MembersNav } from "../../ScenicNav";
import { PageTitle, PhoneLink, card } from "../../../ui";

export default function HostingSitesMembersPage() {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <HostingSitesMembers />
    </Suspense>
  );
}

// Members → Hosting Sites: who runs each hosting site (an organization's Owners and Admins, or a school's contacts).
async function HostingSitesMembers() {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  const scenic = await currentScenic(user);
  if (!scenic) redirect("/");
  const sites = await hostingSiteStaff({ pool: db, now: () => new Date() }, user);
  if (!sites) redirect("/scenic");

  return (
    <>
      <AppHeader user={user} context={scenic.key} tab="scenic-members" />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <MembersNav user={user} current="hosting-sites" />
        <PageTitle title="Hosting Sites" subtitle="Who runs each site: Owners and Admins" />
        {!sites.length && <p className="text-sm text-zinc-500">No hosting sites yet.</p>}
        <div className="grid gap-3">
          {sites.map((s) => (
            <section key={s.id} className={`${card} p-4`}>
              <h2 className="font-semibold">
                <Link href={`/scenic/partners/${s.id}`} className="hover:underline">
                  {s.name}
                </Link>
              </h2>
              {!s.people.length && <p className="text-sm text-zinc-500">No one listed yet.</p>}
              <ul className="divide-y divide-zinc-100 dark:divide-white/5">
                {s.people.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span>
                      <span className="font-medium">{p.name}</span> <PhoneLink cell={p.cell} label={formatCell(p.cell)} />
                    </span>
                    <span className="shrink-0 text-xs font-medium text-thunder-blue dark:text-blue-300">{p.role}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </main>
    </>
  );
}

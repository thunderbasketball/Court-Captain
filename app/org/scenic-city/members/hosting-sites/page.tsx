import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { currentScenic } from "@/lib/contexts-server";
import { db } from "@/lib/db";
import { formatCell } from "@/lib/phone";
import { hostingSiteStaff } from "@/lib/scenic-members";
import AppHeader from "../../../../AppHeader";
import { MembersNav } from "../../ScenicNav";
import { Chip, EmailLink, GroupCard, PageTitle, PersonRow, PhoneLink } from "../../../../ui";

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
  if (!sites) redirect("/org/scenic-city");

  return (
    <>
      <AppHeader user={user} context={scenic.key} tab="scenic-members" />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <MembersNav user={user} current="hosting-sites" />
        <PageTitle title="Hosting Sites" subtitle="Who runs each site: Owners and Admins" />
        {!sites.length && <p className="text-sm text-zinc-500">No hosting sites yet.</p>}
        {/* Each site a card (closed; tap to open), its ↗ opening the site's page; each person one line, opened to cell and email. */}
        <div className="space-y-3">
          {sites.map((s) => (
            <GroupCard
              key={s.id}
              title={s.name}
              count={s.people.length}
              defaultOpen={false}
              action={
                <Link
                  href={`/org/scenic-city/partners/${s.id}`}
                  aria-label={`${s.name}: partner page`}
                  title="Partner page"
                  className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-white text-zinc-600 ring-1 ring-zinc-950/15 hover:bg-zinc-100 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-white/20 dark:hover:bg-white/10"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden className="size-4">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                    />
                  </svg>
                </Link>
              }
            >
              {!s.people.length && <li className="px-4 py-3 text-sm text-zinc-500 italic">No one listed yet.</li>}
              {s.people.map((p) => {
                const [first, ...rest] = p.name.split(" ");
                return (
                  <PersonRow
                    key={`${s.id}-${p.id}`}
                    first={first}
                    last={rest.join(" ")}
                    avatarTone={p.role === "Contact" ? "zinc" : "blue"}
                    collapsed
                    chips={<Chip tone={p.role === "Contact" ? "zinc" : "blue"}>{p.role}</Chip>}
                  >
                    <p>
                      <PhoneLink cell={p.cell} label={formatCell(p.cell)} />
                    </p>
                    <p className="truncate">{p.email ? <EmailLink email={p.email} /> : "No email"}</p>
                  </PersonRow>
                );
              })}
            </GroupCard>
          ))}
        </div>
      </main>
    </>
  );
}

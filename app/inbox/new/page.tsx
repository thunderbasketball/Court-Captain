import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { audienceChoices, sendsAlerts } from "@/lib/announcements";
import { currentUser, devBypass } from "@/lib/auth/server";
import { db } from "@/lib/db";
import AppHeader from "../../AppHeader";
import { PageTitle } from "../../ui";
import ComposeForm from "./ComposeForm";

export default function NewAnnouncementPage({ searchParams }: PageProps<"/inbox/new">) {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <NewAnnouncement searchParams={searchParams} />
    </Suspense>
  );
}

// An organization's Directors (?org=, Thunder when not given; checked on the server).
async function NewAnnouncement({ searchParams }: { searchParams: PageProps<"/inbox/new">["searchParams"] }) {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  const deps = { pool: db, now: () => new Date() };
  const { org } = await searchParams;
  if (!(await sendsAlerts(deps, user, org))) redirect("/inbox");
  const choices = await audienceChoices(deps, user, org);
  return (
    <>
      <AppHeader user={user} context={choices.org === "thunder" ? "director" : choices.org === "scenic-city" ? undefined : `org:${choices.org}`} />
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-6">
        <Link href={`/inbox?view=sent&org=${choices.org}`} className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
          ← Announcements
        </Link>
        <div className="mt-2">
          <PageTitle title="New announcement" subtitle="Shows in their inbox right away. Unread after 8 hours? They get it by email." />
        </div>
        <ComposeForm choices={choices} />
      </main>
    </>
  );
}

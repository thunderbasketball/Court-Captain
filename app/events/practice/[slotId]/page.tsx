import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { requireFeature } from "@/lib/features-server";
import { db } from "@/lib/db";
import { getPractice } from "@/lib/practice-attendance";
import AppHeader from "../../../AppHeader";
import ChatLink from "../../../ChatLink";
import CheckIn from "../../[id]/CheckIn";
import { eventWhen } from "../../format";

export default function PracticeCheckInPage({ params }: PageProps<"/events/practice/[slotId]">) {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <PracticeCheckIn params={params} />
    </Suspense>
  );
}

async function PracticeCheckIn({ params }: { params: PageProps<"/events/practice/[slotId]">["params"] }) {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  await requireFeature("thunder", "practice");
  const { slotId } = await params;
  const practice = await getPractice({ pool: db, now: () => new Date() }, user, slotId);
  if (!practice) notFound();

  return (
    <>
      <AppHeader user={user} tab="schedule" context={user.isDirector ? "director" : `team:${practice.teamId}`} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <Link href="/events" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
          ← Events
        </Link>
        <div className="mt-2 flex items-start justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Practice – {practice.teamName}</h1>
          <ChatLink chatKey={`team-${practice.teamId}`} label={`Chat with ${practice.teamName}`} size="md" />
        </div>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {eventWhen(practice.startsAt)} · {practice.gym} {practice.court}
        </p>
        <p className="mt-0.5 text-xs text-zinc-400">
          <Link href={`/teams/${practice.teamId}`} className="underline underline-offset-2">
            Team page
          </Link>{" "}
          · the team&apos;s roster
        </p>
        <CheckIn target={{ kind: "practice", id: practice.slotId }} players={practice.players} />
      </main>
    </>
  );
}

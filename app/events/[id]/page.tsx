import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { requireFeature } from "@/lib/features-server";
import { db } from "@/lib/db";
import { gradesText } from "@/lib/event-names";
import { getEvent } from "@/lib/events";
import AppHeader from "../../AppHeader";
import ChatLink from "../../ChatLink";
import { eventWhen } from "../format";
import CheckIn from "./CheckIn";
import EventTools from "./EventTools";
import { hasArea } from "@/lib/org-admin";

export default function EventPage({ params }: PageProps<"/events/[id]">) {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <Event params={params} />
    </Suspense>
  );
}

async function Event({ params }: { params: PageProps<"/events/[id]">["params"] }) {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  await requireFeature("thunder", "events");
  const { id } = await params;
  const event = await getEvent({ pool: db, now: () => new Date() }, user, id);
  if (!event) notFound();

  return (
    <>
      <AppHeader user={user} tab="schedule" context={user.isDirector ? "director" : undefined} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <Link href="/events" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
          ← Events
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{event.name}</h1>
          <ChatLink chatKey={`event-${event.id}`} label="Chat with this event's check-in people" size="md" />
        </div>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {eventWhen(event.startsAt)}
          {event.location && ` · ${event.location}`}
        </p>
        <p className="mt-0.5 text-xs text-zinc-400">
          {event.genders.join(" & ")} · {gradesText(event.grades)} · Check-in:{" "}
          {event.staff.length ? event.staff.join(", ") : "Director only"}
        </p>
        {event.notes && <p className="mt-2 text-sm whitespace-pre-wrap">{event.notes}</p>}
        {hasArea(user, "events") && <EventTools id={event.id} name={event.name} />}
        <CheckIn target={{ kind: "event", id: event.id }} players={event.players} />
      </main>
    </>
  );
}

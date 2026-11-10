import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { listInbox, listSent, markRead, sendsAlerts } from "@/lib/announcements";
import { currentUser, devBypass } from "@/lib/auth/server";
import { currentContexts } from "@/lib/contexts-server";
import { db } from "@/lib/db";
import { TZ } from "@/lib/time";
import AppHeader from "../AppHeader";
import RemoveButton from "./RemoveButton";
import { PageTitle, card } from "../ui";

export default function InboxPage({ searchParams }: PageProps<"/inbox">) {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <Inbox searchParams={searchParams} />
    </Suspense>
  );
}

const when = (d: Date) =>
  d.toLocaleString("en-US", { timeZone: TZ, weekday: "short", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });

async function Inbox({ searchParams }: { searchParams: PageProps<"/inbox">["searchParams"] }) {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  const deps = { pool: db, now: () => new Date() };
  const sp = await searchParams;
  // Everyone's inbox holds their alerts from every organization. Sent and + New are for the organization in use
  // (?org=, else the role chip in use), for its Directors only (checked on the server).
  const { active, contexts } = await currentContexts(user);
  const org = typeof sp.org === "string" ? sp.org : active?.org && active.org !== "platform" ? active.org : "thunder";
  const sender = await sendsAlerts(deps, user, org);
  const sent = sender && sp.view === "sent";
  const here = contexts.find((c) => c.org === org);
  const inbox = sent ? [] : await listInbox(deps, user);
  // Opening the inbox counts as seeing what's in it. Done before the header renders, so its badge is already cleared.
  // Not while a Director is viewing as this person: that would hide their unread ones from them.
  if (!user.actingBy) await markRead(
    deps,
    user,
    inbox.filter((i) => !i.read).map((i) => i.id),
  );

  const tab = (on: boolean) =>
    `flex-1 rounded-full px-4 py-1.5 text-center text-sm font-medium sm:flex-none ${on ? "bg-thunder-blue text-white shadow-sm" : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400"}`;

  return (
    <>
      <AppHeader user={user} context={here?.key ?? active?.key} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <div className="flex items-start justify-between gap-3">
          <PageTitle
            title="Announcements"
            subtitle={sent ? "Everything sent, and who hasn't read it yet" : "News from your organizations"}
          />
          {sender && (
            <Link
              href={`/inbox/new?org=${org}`}
              className="shrink-0 rounded-full bg-thunder-blue px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-thunder-blue-dark"
            >
              + New
            </Link>
          )}
        </div>
        {sender && (
          <nav className="mb-4 flex rounded-full bg-zinc-100 p-1 sm:inline-flex dark:bg-zinc-900">
            <Link href={`/inbox?org=${org}`} className={tab(!sent)}>
              Inbox
            </Link>
            <Link href={`/inbox?view=sent&org=${org}`} className={tab(sent)}>
              Sent
            </Link>
          </nav>
        )}
        {sent ? <Sent items={await listSent(deps, user, org)} /> : <Received items={inbox} />}
      </main>
    </>
  );
}

function Received({ items }: { items: Awaited<ReturnType<typeof listInbox>> }) {
  if (!items.length) return <p className="text-zinc-500">No announcements yet.</p>;
  return (
    <div className="space-y-3">
      {items.map((a) => (
        <article key={a.id} className={`${card} p-4 ${a.read ? "" : "ring-2 ring-thunder-blue/40"}`}>
          <div className="flex items-start justify-between gap-2">
            <h2 className="font-semibold">{a.title}</h2>
            {!a.read && <span className="shrink-0 rounded-full bg-thunder-blue px-2 py-0.5 text-xs font-semibold text-white">New</span>}
          </div>
          <p className="mt-0.5 text-xs text-zinc-500">
            {a.orgName} · {a.sentBy} · {when(a.createdAt)}
          </p>
          <p className="mt-3 text-sm whitespace-pre-wrap">{a.body}</p>
        </article>
      ))}
    </div>
  );
}

function Sent({ items }: { items: Awaited<ReturnType<typeof listSent>> }) {
  if (!items.length) return <p className="text-zinc-500">Nothing sent yet. Tap “+ New” to send one.</p>;
  return (
    <div className="space-y-3">
      {items.map((a) => (
        <article key={a.id} className={`${card} p-4`}>
          <div className="flex items-start justify-between gap-2">
            <h2 className="font-semibold">{a.title}</h2>
            <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium tabular-nums text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              {a.total - a.unread.length} of {a.total} read
            </span>
          </div>
          <p className="mt-0.5 text-xs text-zinc-500">
            To {a.audience} · {a.sentBy} · {when(a.createdAt)}
            {a.emailed > 0 && ` · also emailed ${a.emailed} without an app login`}
          </p>
          <p className="mt-3 text-sm whitespace-pre-wrap">{a.body}</p>
          {a.unread.length > 0 && (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-zinc-500">Not read yet ({a.unread.length})</summary>
              <p className="mt-1 text-zinc-600 dark:text-zinc-300">{a.unread.join(", ")}</p>
            </details>
          )}
          <div className="mt-3 border-t border-zinc-100 pt-3 text-right dark:border-white/5">
            <RemoveButton id={a.id} title={a.title} />
          </div>
        </article>
      ))}
    </div>
  );
}

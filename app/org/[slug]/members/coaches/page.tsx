import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { listOrgMembers } from "@/lib/org-members";
import { orgInfo } from "@/lib/org-registry";
import AppHeader from "../../../../AppHeader";
import { TextPanel } from "../../../../Contacts";
import { NotifyPanel } from "../../../../NotifyButton";
import { sendsAlerts } from "@/lib/announcements";
import { orgKey } from "@/lib/chat";
import { hasFeature } from "@/lib/features";
import ChatPanel from "../../../../ChatPanel";
import PageMenus, { MEGAPHONE_BTN, MegaphoneIcon } from "../../../../PageMenus";
import { PageTitle } from "../../../../ui";
import UserList from "../../../../UserList";
import OrgMembersNav from "../OrgMembersNav";
import { followRename } from "@/lib/org-rename";

export default function OrgCoachesPage({ params, searchParams }: PageProps<"/org/[slug]/members/coaches">) {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <OrgCoaches params={params} searchParams={searchParams} />
    </Suspense>
  );
}

const TABS = [
  { key: "active", label: "Active" },
  { key: "inactive", label: "Inactive" },
] as const;

// Members → Coaches (Admins and Directors of Teams), like Thunder's: Active (everyone coaching its teams, with their
// teams as Head or Asst Coach) and Inactive, by last name; View as for Admins. Coaches are added on each team's page.
async function OrgCoaches({
  params,
  searchParams,
}: {
  params: PageProps<"/org/[slug]/members/coaches">["params"];
  searchParams: PageProps<"/org/[slug]/members/coaches">["searchParams"];
}) {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  const { slug } = await params;
  await followRename(slug, (s) => `/org/${s}/members/coaches`);
  const [o, members] = await Promise.all([orgInfo(db, slug), listOrgMembers(db, user, slug)]);
  if (!o || !members || slug === "scenic-city") notFound();
  const sp = await searchParams;
  const tab = TABS.find((t) => t.key === sp.view)?.key ?? "active";
  const { users, admin } = members;
  const active = users.filter((u) => u.active && !u.director && (u.coach || u.teams.length > 0));
  const alerter = await sendsAlerts({ pool: db, now: () => new Date() }, user, slug); // its Directors alert its coaches
  const chatter = alerter && (await hasFeature(db, slug, "chat")); // and chat with them, with Chat
  const counts = { active: active.length, inactive: users.filter((u) => !u.active && !u.director).length };

  return (
    <>
      <AppHeader user={user} context={`org:${slug}`} tab="org-members" />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <OrgMembersNav slug={slug} current="coaches" staff={admin} coaches />
        {/* 📣 opens Text, and for its Directors Chat (with Chat) and Alert coaches, right under the title. */}
        <PageMenus
          title={<PageTitle title="Coaches" subtitle="Coaches on your teams (add them on each team's page), and inactive coaches" />}
          menus={
            tab === "active" && active.length > 0
              ? [
                  {
                    key: "coaches",
                    icon: <MegaphoneIcon />,
                    label: chatter ? "Coaches: text, chat or alert" : alerter ? "Coaches: text or alert" : "Coaches: text",
                    className: MEGAPHONE_BTN,
                    items: [
                      { key: "text", label: "💬 Text coaches", panel: <TextPanel cells={active.map((u) => u.cell)} label="Text coaches" /> },
                      ...(chatter
                        ? [{ key: "chat", label: "🗨️ Chat with coaches", panel: <ChatPanel chatKey={orgKey(slug, "coaches")} /> }]
                        : []),
                      ...(alerter
                        ? [
                            {
                              key: "alert",
                              label: "🔔 Alert coaches",
                              panel: <NotifyPanel audience={{ org: slug, roles: ["coach"] }} to="all coaches" />,
                            },
                          ]
                        : []),
                    ],
                  },
                ]
              : []
          }
        />
        <nav className="mb-4 flex gap-1 overflow-x-auto rounded-full bg-zinc-100 p-1 [scrollbar-width:none] dark:bg-zinc-900">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={t.key === "active" ? `/org/${slug}/members/coaches` : `/org/${slug}/members/coaches?view=${t.key}`}
              aria-current={t.key === tab ? "page" : undefined}
              className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium whitespace-nowrap ${
                t.key === tab
                  ? "bg-thunder-blue text-white shadow-sm"
                  : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"
              }`}
            >
              {t.label} <span className="tabular-nums opacity-70">{counts[t.key]}</span>
            </Link>
          ))}
        </nav>
        <UserList
          users={users}
          viewer={user}
          orgAdmin={admin}
          org={slug}
          view={tab === "active" ? "coaches" : "inactive-coaches"}
        />
      </main>
    </>
  );
}

import { db } from "@/lib/db";
import { listOrgMembers } from "@/lib/org-members";
import { orgInfo } from "@/lib/org-registry";
import { sendsAlerts } from "@/lib/announcements";
import { orgKey } from "@/lib/chat";
import { hasFeature } from "@/lib/features";
import ChatPanel from "../../../../ChatPanel";
import { CardPanel } from "../../../../CardIcons";
import CoachTools from "../../../../CoachTools";
import { activeCoaches, coachTree, inactiveCoaches } from "../../../../coach-trees";
import { CollapseCard, PageTitle } from "../../../../ui";
import UserList from "../../../../UserList";

import type { SessionUser } from "@/lib/auth/service";

// Members → Coaches (Admins and Directors of Teams), like Thunder's: Active (everyone coaching its teams, with their
// teams as Head or Asst Coach) and Inactive, by last name; View as for Admins. Coaches are added on each team's page.
export default async function OrgCoachesPart({ user, slug, view }: { user: SessionUser; slug: string; view: unknown }) {
  const [o, members] = await Promise.all([orgInfo(db, slug), listOrgMembers(db, user, slug)]);
  if (!o || !members || slug === "scenic-city") return null;
  const opened = typeof view === "string" ? view : ""; // ?coaches=inactive opens that card
  const { users, admin } = members;
  const active = activeCoaches(users);
  const alerter = await sendsAlerts({ pool: db, now: () => new Date() }, user, slug); // its Directors alert its coaches
  const chatter = alerter && (await hasFeature(db, slug, "chat")); // and chat with them, with Chat
  const inactive = inactiveCoaches(users);

  return (
    <>
        <PageTitle title="Coaches" subtitle="Coaches on your teams (add them on each team's page), and inactive coaches" />
        {/* The card's 📣 (on its title line) opens these here: Text, and for its Directors Chat (with Chat) and Alert. */}
        <CardPanel id="coach-tools" className="-mt-2 mb-3">
          <CoachTools
            coaches={coachTree(users)}
            volunteers={null}
            chat={chatter ? <ChatPanel chatKey={orgKey(slug, "coaches")} /> : null}
            alerts={
              alerter
                ? [
                    { key: "active", label: `Active coaches (${active.length})`, audience: { org: slug, roles: ["coach"] }, to: "all coaches" },
                    ...(inactive.length
                      ? [
                          {
                            key: "inactive",
                            label: `Inactive coaches (${inactive.length})`,
                            audience: { org: slug, users: inactive.map((u) => u.coachId) },
                            to: "inactive coaches",
                          },
                        ]
                      : []),
                  ]
                : []
            }
          />
        </CardPanel>
        <div className="space-y-3">
          <CollapseCard title="Active" count={active.length} open={opened === "active"}>
            <div className="px-3 pb-3">
              <UserList users={users} viewer={user} orgAdmin={admin} org={slug} view="coaches" />
            </div>
          </CollapseCard>
          <CollapseCard title="Inactive" count={inactive.length} open={opened === "inactive"}>
            <div className="px-3 pb-3">
              <UserList users={users} viewer={user} orgAdmin={admin} org={slug} view="inactive-coaches" />
            </div>
          </CollapseCard>
        </div>
    </>
  );
}

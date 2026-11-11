import { listVolunteerCoaches } from "@/lib/coaches";
import { gradeLabel } from "@/lib/grades";
import { hasArea } from "@/lib/org-admin";
import { formatCell } from "@/lib/phone";
import { listUsers } from "@/lib/users";
import ChatPanel from "../../../../ChatPanel";
import { CardPanel } from "../../../../CardIcons";
import CoachTools from "../../../../CoachTools";
import { activeCoaches, coachTree, inactiveCoaches, volunteerTree } from "../../../../coach-trees";
import { Chip, CollapseCard, EmailLink, GroupCard, PageTitle, PersonRow, PhoneLink } from "../../../../ui";
import UserList from "../../../../UserList";

import type { SessionUser } from "@/lib/auth/service";

// Members → Coaches card (Directors of Coaches): three cards that open on their own: Active (coaches, then team managers
// and parents, listed like Staff with Edit and View as for Admins, grouped by grade), Volunteers (from registration,
// only those without a role on a team now; grade cards collapsed) and Inactive.
export default async function CoachesPart({ user, view }: { user: SessionUser; view: unknown }) {
  if (!hasArea(user, "teams")) return null;
  // Each list is a card that opens on its own; ?coaches=volunteers (or inactive) opens that one.
  const opened = typeof view === "string" ? view : "";
  const [users, groups] = await Promise.all([listUsers(user), listVolunteerCoaches(user)]);
  const active = activeCoaches(users);
  const inactive = inactiveCoaches(users);
  // Volunteers: only those without a role on a team right now (on a team, they're under Active).
  const onTeams = new Set(users.filter((u) => u.active && u.teams.length > 0).map((u) => u.cell));
  const open = groups
    .map((g) => ({ ...g, coaches: g.coaches.filter((c) => !c.staff.length && !(c.cell && onTeams.has(c.cell))) }))
    .filter((g) => g.coaches.length);
  const unassigned = open.flatMap((g) => g.coaches);

  return (
    <>
      <PageTitle title="Coaches" subtitle="Coaches and team staff, volunteers from registration not on a team, and inactive coaches" />
      {/* The card's 📣 (on its title line) opens these here: Text, Chat, Text volunteers, Alert. */}
      <CardPanel id="coach-tools" className="-mt-2 mb-3">
        <CoachTools
          coaches={coachTree(users)}
          volunteers={volunteerTree(open)}
          chat={<ChatPanel chatKey="coaches" />}
          alerts={[
            { key: "active", label: `Active coaches (${active.length})`, audience: { roles: ["HeadCoach", "AsstCoach"] }, to: "all coaches" },
            ...(unassigned.length
              ? [{ key: "volunteers", label: `Volunteers (${unassigned.length})`, audience: { volunteers: true }, to: "all volunteer coaches" }]
              : []),
            ...(inactive.length
              ? [
                  {
                    key: "inactive",
                    label: `Inactive coaches (${inactive.length})`,
                    audience: { users: inactive.map((u) => u.coachId) },
                    to: "inactive coaches",
                  },
                ]
              : []),
          ]}
        />
      </CardPanel>
      <div className="space-y-3">
        <CollapseCard title="Active" count={active.length} open={opened === "active"}>
          <div className="px-3 pb-3">
            <UserList users={users} viewer={user} view="coaches" />
          </div>
        </CollapseCard>
        <CollapseCard title="Volunteers" count={unassigned.length} open={opened === "volunteers"}>
          <div className="space-y-3 px-3 pb-3">
            {!unassigned.length && <p className="px-1 text-sm text-zinc-500">No volunteers waiting: every one is on a team.</p>}
            {open.map((g) => (
              <GroupCard
                key={`${g.gender}-${g.grade}`}
                gender={g.gender}
                title={`${g.gender} · ${gradeLabel(g.grade)}`}
                count={g.coaches.length}
                defaultOpen={false}
              >
                {g.coaches.map((c) => (
                  <PersonRow
                    key={c.registrantId}
                    first={c.firstName}
                    last={c.lastName}
                    avatarTone="zinc"
                    chips={<Chip tone={c.isHead ? "blue" : "green"}>{c.isHead ? "Head Coach" : "Asst Coach"}</Chip>}
                    collapsed
                    always={<p className="text-zinc-500">Parent of {c.playerName}</p>}
                  >
                    <p>{c.cell && c.cell.length === 10 ? <PhoneLink cell={c.cell} label={formatCell(c.cell)} /> : "No cell"}</p>
                    <p className="truncate">{c.email ? <EmailLink email={c.email} /> : "No email"}</p>
                  </PersonRow>
                ))}
              </GroupCard>
            ))}
          </div>
        </CollapseCard>
        <CollapseCard title="Inactive" count={inactive.length} open={opened === "inactive"}>
          <div className="px-3 pb-3">
            <UserList users={users} viewer={user} view="inactive-coaches" />
          </div>
        </CollapseCard>
      </div>
    </>
  );
}

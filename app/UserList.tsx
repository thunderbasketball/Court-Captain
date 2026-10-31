import { formatCell } from "@/lib/phone";
import type { SessionUser } from "@/lib/auth/service";
import { deleteBlocker } from "@/lib/user-admin";
import type { UserListItem } from "@/lib/users";
import ChatLink from "./ChatLink";
import { AddMenu, DirectorButtons, DirectorRole, menuItem, type Director } from "./DirectorTools";
import { isThunderAdmin } from "@/lib/org-admin";
import { ViewAsButton } from "./ViewAsButton";
import { AddUserButton, EditUserButton } from "./users/UserEditor";
import { Chip, EmailLink, GroupCard, PageTitle, PersonRow, PhoneLink, Stats } from "./ui";

// Members → Staff: Admins & Directors, then access requests, other logins (no team role; collapsed) and inactive Directors.
// Members → Coaches: `view="coaches"` Active Coaches and Team Managers & Parents; `view="inactive-coaches"` every other
// inactive login. Each group sorted by last name.
// Edit and View as are for Admins only.
// `team` (Admins only): each Director's role and area tools in their row, and + Add Admin / + Add Director by the title.
export type DirectorTeam = {
  org: string;
  orgName: string;
  directors: Director[];
  areas: { key: string; name: string; covers: string }[];
  options: { id: string; name: string }[];
  canManageAdmins: boolean;
  adminOptions: { id: string; name: string }[];
};

export default function UserList({
  users,
  viewer,
  team,
  view = "staff",
}: {
  users: UserListItem[];
  viewer: SessionUser;
  team?: DirectorTeam | null;
  view?: "staff" | "coaches" | "inactive-coaches";
}) {
  const admin = isThunderAdmin(viewer);
  const roleOf = (coachId: string) => team?.directors.find((d) => d.id === coachId);
  const active = users.filter((u) => u.active);
  const requests = active.filter((u) => u.request && !u.coach && !u.director && !u.teams.length);
  const directors = active.filter((u) => u.director);
  // Coaches: the Coach role or a Head / Assistant Coach spot; team helpers: only a Manager or Team Parent spot.
  const coaches = active.filter((u) => !u.director && (u.coach || u.teams.some((t) => /(Head|Asst) Coach$/.test(t))));
  const helpers = active.filter((u) => !u.director && !coaches.includes(u) && u.teams.length > 0);
  const others = active.filter((u) => !u.director && !requests.includes(u) && !coaches.includes(u) && !helpers.includes(u));
  // Inactive logins: Directors stay on Staff; everyone else is listed as an inactive coach (Members → Coaches).
  const inactive = users.filter((u) => !u.active && u.director);
  const inactiveCoaches = users.filter((u) => !u.active && !u.director);

  const rows = (list: UserListItem[]) =>
    list.map((u) => (
      <PersonRow
        key={u.coachId}
        first={u.firstName}
        last={u.lastName}
        avatarTone={u.director ? "blue" : u.coach ? "green" : "zinc"}
        dim={!u.active}
        under={
          admin &&
          u.active &&
          u.coachId !== viewer.coachId && <ViewAsButton coachId={u.coachId} name={`${u.firstName} ${u.lastName}`} />
        }
        chips={
          <>
            {u.director && (
              <Chip tone="blue">{roleOf(u.coachId)?.owner ? "Owner" : roleOf(u.coachId)?.admin ? "Admin" : "Director"}</Chip>
            )}
            {u.coach && <Chip tone="green">Coach</Chip>}
            {requests.includes(u) && <Chip tone="amber">Pending</Chip>}
            {!u.active && <Chip tone="red">Inactive</Chip>}
          </>
        }
      >
        {team && roleOf(u.coachId) && (
          <DirectorRole
            org={team.org}
            orgName={team.orgName}
            person={roleOf(u.coachId)!}
            areas={team.areas}
            canManageAdmins={team.canManageAdmins}
          />
        )}
        <p>
          <PhoneLink cell={u.cell} label={formatCell(u.cell)} />
        </p>
        <p className="truncate">
          {u.email ? <EmailLink email={u.email} /> : "No email"}
          {u.email &&
            (u.verified ? <span className="text-emerald-600 dark:text-emerald-400"> ✓ verified</span> : " · not verified")}
        </p>
        <div className="flex items-end justify-between gap-2 pt-1">
          <div className="flex flex-wrap gap-1">
            {u.teams.map((t) => (
              <Chip key={t} tone="orange">
                {t}
              </Chip>
            ))}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {u.active && u.coachId !== viewer.coachId && (u.coach || u.teams.some((t) => /(Head|Assistant) Coach$/.test(t))) && (
              <ChatLink chatKey={`coach-${u.coachId}`} label={`Chat with ${u.firstName} ${u.lastName}`} />
            )}
            {admin && <EditUserButton user={u} isSelf={u.coachId === viewer.coachId} deleteBlocker={deleteBlocker(u, viewer)} />}
          </div>
        </div>
      </PersonRow>
    ));

  if (view === "coaches")
    return (
      <div className="space-y-3">
        <GroupCard title="Active Coaches" count={coaches.length}>
          {coaches.length ? rows(coaches) : <li className="px-4 py-3 text-sm text-zinc-500 italic">No coaches yet.</li>}
        </GroupCard>
        {helpers.length > 0 && (
          <GroupCard title="Team Managers & Parents" count={helpers.length}>
            {rows(helpers)}
          </GroupCard>
        )}
      </div>
    );
  if (view === "inactive-coaches")
    return (
      <GroupCard title="Inactive coaches" count={inactiveCoaches.length}>
        {inactiveCoaches.length ? rows(inactiveCoaches) : <li className="px-4 py-3 text-sm text-zinc-500 italic">None.</li>}
      </GroupCard>
    );

  return (
    <section>
      <div className="flex items-start justify-between gap-3">
        <PageTitle title="Staff" subtitle="Admins and Directors, then other sign-ins (coaches are under Coaches), by last name" />
        {team ? (
          <AddMenu>
            <AddUserButton label="New user (login)" className={menuItem} />
            <DirectorButtons
              org={team.org}
              areas={team.areas}
              options={team.options}
              canManageAdmins={team.canManageAdmins}
              adminOptions={team.adminOptions}
            />
          </AddMenu>
        ) : (
          <AddUserButton />
        )}
      </div>
      <Stats
        items={[
          { label: "Users", value: users.length },
          { label: "Active", value: active.length },
          { label: "Requests", value: requests.length, tone: requests.length ? "text-amber-600 dark:text-amber-400" : "" },
        ]}
      />
      <div className="space-y-3">
        {directors.length > 0 && (
          <GroupCard title="Admins & Directors" count={directors.length}>
            {rows(directors)}
          </GroupCard>
        )}
        <GroupCard title="Access requests" count={requests.length}>
          {requests.length ? (
            rows(requests)
          ) : (
            <li className="px-4 py-3 text-sm text-zinc-500 italic">No pending access requests.</li>
          )}
        </GroupCard>
        {others.length > 0 && (
          <GroupCard title="Other logins" count={others.length} defaultOpen={false}>
            {rows(others)}
          </GroupCard>
        )}
        {inactive.length > 0 && (
          <GroupCard title="Inactive Directors" count={inactive.length} defaultOpen={false}>
            {rows(inactive)}
          </GroupCard>
        )}
      </div>
    </section>
  );
}

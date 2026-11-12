import { formatCell } from "@/lib/phone";
import type { SessionUser } from "@/lib/auth/service";
import { deleteBlocker } from "@/lib/user-admin";
import type { UserListItem } from "@/lib/users";
import { ChatToggle } from "./InlineToggle";
import { ChatIcon } from "./TeamRow";

const CHAT_BTN =
  "inline-flex size-7 shrink-0 items-center justify-center rounded-full text-thunder-blue ring-1 ring-thunder-blue/30 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-500/10";
import { AddMenu, DirectorButtons, DirectorRole, menuItem, type Director } from "./DirectorTools";
import { isThunderAdmin } from "@/lib/org-admin";
import { db } from "@/lib/db";
import { hasFeature } from "@/lib/features";
import { orgKey } from "@/lib/chat";
import { resettable } from "@/lib/login-reset";
import { ResetLoginButton } from "./ResetLoginButton";
import { ViewAsButton } from "./ViewAsButton";
import { AddUserButton, ApproveJoinButton, EditUserButton } from "./users/UserEditor";
import { PLUS_BTN } from "./PageMenus";
import { Chip, EmailLink, GroupCard, PageTitle, PersonRow, PhoneLink } from "./ui";
import GearPopUp from "./GearPopUp";
import Link from "next/link";
import { gradeLabel } from "@/lib/grades";
import { gradeStr } from "@/lib/team-names";

// Members → Staff: Admins & Directors, then access requests, other logins (no team role) and inactive Directors; laid out
// like Coaches: each group collapsed, each person's card collapsed (👁 and the gear with Edit and Reset login on the name
// line; their Director role and area tools, contact and Chat inside).
// Members → Coaches: `view="coaches"` coaches, Team Managers and Parents grouped by grade, then on a card per team;
// `view="inactive-coaches"` every other inactive login. Each group sorted by last name. Coach cards are collapsed with
// Edit and Reset login under a gear; team pills open the team's page.
// Edit and View as are for Admins only. `orgAdmin` (another organization's list): View as for its Owners and Admins;
// Edit and Approve stay Thunder's; Chat (a coach's chat with the Directors) wherever the organization has Chat. 🔑 Reset login under 👁 for whoever the viewer may reset (lib/login-reset.ts).
// `team` (Admins only): each Director's role and area tools in their row, and + Add Admin / + Add Director by the title.
export type DirectorTeam = {
  org: string;
  orgName: string;
  directors: Director[];
  areas: { key: string; name: string; covers: string }[];
  options: { id: string; name: string }[];
  directorsOn: boolean;
  canManageAdmins: boolean;
  adminOptions: { id: string; name: string }[];
  ownerOptions: { id: string; name: string }[];
};

export default async function UserList({
  users,
  viewer,
  team,
  view = "staff",
  orgAdmin,
  org,
  addOnCard = false,
}: {
  users: UserListItem[];
  viewer: SessionUser;
  team?: DirectorTeam | null;
  view?: "staff" | "requests" | "coaches" | "inactive-coaches";
  orgAdmin?: boolean;
  org?: string; // another organization's list without `team`
  addOnCard?: boolean; // the + Add is on the Members card's title line instead
}) {
  const thunder = orgAdmin === undefined;
  const admin = thunder ? isThunderAdmin(viewer) : orgAdmin;
  const slug = thunder ? "thunder" : (org ?? team?.org);
  // Each coach's chat with the Directors, opened on their card: organizations with team chats (CourtPlayers; others' Admins).
  const chatOn = !!slug && (thunder || admin) && (await hasFeature(db, slug, "team-chat"));
  const canReset =
    admin && slug
      ? await resettable(
          db,
          viewer.coachId,
          slug,
          users.map((u) => u.coachId),
        )
      : new Set<string>();
  const roleOf = (coachId: string) => team?.directors.find((d) => d.id === coachId);
  const { requests, directors, coaches, helpers, others, inactive, inactiveCoaches } = sortUsers(users);

  // A team pill opens that team's page.
  const teamHref = (id: string) => (thunder ? `/org/thunder/teams/${id}` : `/org/${slug}/teams/${id}`);
  const teamPills = (u: UserListItem) =>
    !u.teamLinks?.length && !u.teams.length ? null : (u.teamLinks?.length ?? 0) > 0 ? (
      <div className="flex flex-wrap gap-1">
        {u.teamLinks.map((t) => (
          <Link key={`${t.id}-${t.label}`} href={teamHref(t.id)} className="rounded-full hover:opacity-80">
            <Chip tone="orange">{t.label}</Chip>
          </Link>
        ))}
      </div>
    ) : (
      <div className="flex flex-wrap gap-1">
        {u.teams.map((t) => (
          <Chip key={t} tone="orange">
            {t}
          </Chip>
        ))}
      </div>
    );

  // `coachCard` (Members → Coaches): collapsed (name, chips, team pills; the chevron opens cell, email and Chat), and
  // Edit and Reset login under a gear at the top right, View as (👁) just before it.
  // `onTeam` (a team card): one pill at the top right, that team and their role on it (e.g. 1B Clemons · Head Coach),
  // opening the team, in place of the Coach chip and the team pills under the name.
  const rows = (list: UserListItem[], coachCard = false, onTeam?: string) =>
    list.map((u) => {
      const name = `${u.firstName} ${u.lastName}`;
      const teamLink = onTeam ? u.teamLinks?.find((t) => t.id === onTeam) : undefined;
      const mayReset = admin && u.coachId !== viewer.coachId && !!slug && canReset.has(u.coachId);
      const mayEdit = thunder && admin;
      const gear = coachCard && (mayReset || mayEdit) && (
        <GearPopUp title={name}>
          {mayEdit && (
            <EditUserButton
              user={admin ? u : { ...u, updatedBy: null }}
              isSelf={u.coachId === viewer.coachId}
              deleteBlocker={deleteBlocker(u, viewer)}
            />
          )}
          {mayReset && (
            <div className="flex items-center gap-2 text-sm">
              <ResetLoginButton org={slug!} coachId={u.coachId} name={name} />
              Reset login
            </div>
          )}
        </GearPopUp>
      );
      // The chat opens right here on the card, on a line of its own under the buttons (no pop-up, no new page).
      const buttons = (
        <>
          {chatOn &&
            u.active &&
            u.coachId !== viewer.coachId &&
            (u.coach || u.teams.some((t) => /(Head|Assistant) Coach$/.test(t))) && (
              <ChatToggle chatKey={orgKey(slug ?? "thunder", `coach-${u.coachId}`)} label={`Chat with ${name}`} className={CHAT_BTN}>
                <ChatIcon />
              </ChatToggle>
            )}
          {thunder && admin && u.joinTeamListed && <ApproveJoinButton coachId={u.coachId} label="Approve onto team" />}
          {!coachCard && mayEdit && (
            <EditUserButton
              user={admin ? u : { ...u, updatedBy: null }}
              isSelf={u.coachId === viewer.coachId}
              deleteBlocker={deleteBlocker(u, viewer)}
            />
          )}
        </>
      );
      const contact = (
        <>
          {u.joinReason && <p className="font-medium text-amber-800 dark:text-amber-300">{u.joinReason}</p>}
          <p>
            <PhoneLink cell={u.cell} label={formatCell(u.cell)} />
          </p>
          <p className="truncate">
            {u.email ? <EmailLink email={u.email} /> : "No email"}
            {u.email &&
              (u.verified ? <span className="text-emerald-600 dark:text-emerald-400"> ✓ verified</span> : " · not verified")}
          </p>
        </>
      );
      return (
        <PersonRow
          key={u.coachId}
          first={u.firstName}
          last={u.lastName}
          avatarTone={u.director ? "blue" : u.coach ? "green" : "zinc"}
          href={admin ? (u.coachId === viewer.coachId ? "/me" : `/me/${u.coachId}`) : undefined}
          dim={!u.active}
          under={
            !coachCard &&
            admin &&
            u.coachId !== viewer.coachId && (
              <>
                {u.active && <ViewAsButton coachId={u.coachId} name={name} />}
                {mayReset && <ResetLoginButton org={slug!} coachId={u.coachId} name={name} />}
              </>
            )
          }
          chips={
            <>
              {u.director && (
                <Chip tone="blue">{roleOf(u.coachId)?.owner ? "Owner" : roleOf(u.coachId)?.admin ? "Admin" : "Director"}</Chip>
              )}
              {teamLink ? (
                <Link href={teamHref(teamLink.id)} className="rounded-full hover:opacity-80">
                  <Chip tone="orange">{teamLink.label}</Chip>
                </Link>
              ) : (
                u.coach && <Chip tone="green">Coach</Chip>
              )}
              {requests.includes(u) && <Chip tone="amber">Pending</Chip>}
              {!u.active && <Chip tone="red">Inactive</Chip>}
              {coachCard && admin && u.active && u.coachId !== viewer.coachId && (
                <ViewAsButton coachId={u.coachId} name={name} />
              )}
              {gear}
            </>
          }
          collapsed={coachCard}
          always={coachCard && !onTeam ? teamPills(u) : undefined}
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
          {contact}
          {coachCard ? (
            <div className="flex flex-wrap items-center justify-end gap-2 pt-1">{buttons}</div>
          ) : (
            <div className="flex flex-wrap items-end gap-2 pt-1">
              <div className="mr-auto">{teamPills(u)}</div>
              {buttons}
            </div>
          )}
        </PersonRow>
      );
    });

  // Members → Coaches: everyone active with a team spot or the Coach role, grouped by their teams' gender and grade
  // (Boys then Girls, youngest first; no team yet last), and inside a grade on one card per team (Head Coach, Asst
  // Coach, Manager, Team Parent; someone on two teams is listed on both). Grade cards and team cards start collapsed.
  const roleRank = (label: string) =>
    ["Head Coach", "Asst Coach", "Manager", "Team Parent"].findIndex((r) => label.endsWith(r)) >>> 0;
  const byGrade = (list: UserListItem[]) => {
    type Team = { id: string; name: string; people: { u: UserListItem; rank: number }[] };
    const groups = new Map<string, { gender: string; grade: number; teams: Map<string, Team>; people: Set<UserListItem> }>();
    const group = (key: string, gender: string, grade: number) => {
      if (!groups.has(key)) groups.set(key, { gender, grade, teams: new Map(), people: new Set() });
      return groups.get(key)!;
    };
    for (const u of list) {
      if (!u.teamLinks?.length) {
        group("none", "", 99).people.add(u);
        continue;
      }
      for (const t of u.teamLinks) {
        const g = group(`${t.gender}|${t.grade}`, t.gender, t.grade);
        g.people.add(u);
        if (!g.teams.has(t.id)) g.teams.set(t.id, { id: t.id, name: t.label.split(" · ")[0], people: [] });
        const team = g.teams.get(t.id)!;
        const rank = roleRank(t.label);
        const had = team.people.find((p) => p.u === u);
        if (!had) team.people.push({ u, rank });
        else had.rank = Math.min(had.rank, rank);
      }
    }
    const order = (g: string) => ["Boys", "Girls", "Coed"].indexOf(g) + (g ? 0 : 9);
    return [...groups]
      .sort(([, a], [, b]) => order(a.gender) - order(b.gender) || a.grade - b.grade)
      .map(([key, g]) => ({
        key,
        gender: g.gender,
        title: g.gender ? `${g.gender} · ${g.grade === -1 ? "Pre-K" : gradeLabel(gradeStr(g.grade))}` : "No team yet",
        count: g.people.size,
        people: [...g.people],
        teams: [...g.teams.values()]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((t) => ({ ...t, people: t.people.sort((a, b) => a.rank - b.rank).map((p) => p.u) })),
      }));
  };

  if (view === "coaches") {
    const people = [...coaches, ...helpers].sort(
      (a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName),
    );
    if (!people.length) return <p className="text-sm text-zinc-500 italic">No coaches yet.</p>;
    return (
      <div className="space-y-3">
        {byGrade(people).map((g) => (
          <GroupCard key={g.key} title={g.title} count={g.count} defaultOpen={false} gender={g.gender}>
            {g.teams.length
              ? g.teams.map((t) => (
                  <li key={t.id}>
                    <details className="group/t">
                      <summary className="flex cursor-pointer list-none items-center justify-between bg-orange-50 px-4 py-2 text-xs font-semibold tracking-wide text-orange-800 uppercase dark:bg-orange-500/10 dark:text-orange-300 [&::-webkit-details-marker]:hidden">
                        <span>
                          {t.name} · {t.people.length}
                        </span>
                        <span className="text-base transition-transform [details[open]>summary_&]:rotate-90">›</span>
                      </summary>
                      <ul className="divide-y divide-zinc-100 dark:divide-white/5">{rows(t.people, true, t.id)}</ul>
                    </details>
                  </li>
                ))
              : rows(g.people, true)}
          </GroupCard>
        ))}
      </div>
    );
  }
  if (view === "inactive-coaches")
    return (
      <GroupCard title="Inactive coaches" count={inactiveCoaches.length}>
        {inactiveCoaches.length ? rows(inactiveCoaches, true) : <li className="px-4 py-3 text-sm text-zinc-500 italic">None.</li>}
      </GroupCard>
    );

  return (
    <section>
      <div className="flex items-start justify-between gap-3">
        {/* On the Members page the Staff card's + sits on its title line (StaffAdd), so not here. */}
        {view === "requests" ? (
          <PageTitle title="Requests" subtitle="People asking to join Thunder: approve or deny" />
        ) : (
          <PageTitle
            title="Staff"
            subtitle="Admins and Directors, then other sign-ins (coaches are under Coaches), by last name"
          />
        )}
        {addOnCard && view !== "requests" ? null : team ? (
          <AddMenu>
            {thunder && <AddUserButton label="New user (login)" className={menuItem} />}
            <DirectorButtons
              org={team.org}
              areas={team.areas}
              options={team.options}
              directorsOn={team.directorsOn}
              canManageAdmins={team.canManageAdmins}
              adminOptions={team.adminOptions}
              ownerOptions={team.ownerOptions}
              staff={team.directors}
            />
          </AddMenu>
        ) : (
          thunder && <AddUserButton />
        )}
      </div>
      {view === "requests" ? (
        <GroupCard title="Access requests" count={requests.length}>
          {requests.length ? (
            rows(requests, true)
          ) : (
            <li className="px-4 py-3 text-sm text-zinc-500 italic">No pending access requests.</li>
          )}
        </GroupCard>
      ) : (
        <>
          <div className="space-y-3">
            {directors.length > 0 && (
              <GroupCard title="Admins & Directors" count={directors.length} defaultOpen={false}>
                {rows(directors, true)}
              </GroupCard>
            )}
            {others.length > 0 && (
              <GroupCard title="Other logins" count={others.length} defaultOpen={false}>
                {rows(others, true)}
              </GroupCard>
            )}
            {inactive.length > 0 && (
              <GroupCard title="Inactive Directors" count={inactive.length} defaultOpen={false}>
                {rows(inactive, true)}
              </GroupCard>
            )}
          </div>
        </>
      )}
    </section>
  );
}

// Everyone sorted into the lists: join requests, Admins & Directors, coaches (the Coach role or a Head / Assistant Coach
// spot; Directors too when they're on a team), team helpers (only a Manager or Team Parent spot), other logins, and the
// inactive (Directors stay on Staff; everyone else is an inactive coach).
export function sortUsers(users: UserListItem[]) {
  const active = users.filter((u) => u.active);
  const requests = active.filter((u) => u.request && !u.coach && !u.director && !u.teams.length);
  const directors = active.filter((u) => u.director);
  const coaches = active.filter(
    (u) => (!u.director || u.teams.length > 0) && (u.coach || u.teams.some((t) => /(Head|Asst) Coach$/.test(t))),
  );
  const helpers = active.filter((u) => (!u.director || u.teams.length > 0) && !coaches.includes(u) && u.teams.length > 0);
  const others = active.filter((u) => !u.director && !requests.includes(u) && !coaches.includes(u) && !helpers.includes(u));
  const inactive = users.filter((u) => !u.active && u.director);
  const inactiveCoaches = users.filter((u) => !u.active && !u.director);
  return { requests, directors, coaches, helpers, others, inactive, inactiveCoaches };
}

// Staff (n) on the Members card: its Admins & Directors and other logins.
export const staffCount = (users: UserListItem[]) => {
  const g = sortUsers(users);
  return g.directors.length + g.others.length;
};

// The Staff card's + on the Members page: Thunder adds a login, Directors, Admins and Owners; another organization its
// Directors (Owners also Admins and Owners).
export function StaffAdd({ team, thunder }: { team: DirectorTeam | null; thunder: boolean }) {
  if (!team) return thunder ? <AddUserButton label="+" className={PLUS_BTN} /> : null;
  return (
    <AddMenu round>
      {thunder && <AddUserButton label="New user (login)" className={menuItem} />}
      <DirectorButtons
        org={team.org}
        areas={team.areas}
        options={team.options}
              directorsOn={team.directorsOn}
        canManageAdmins={team.canManageAdmins}
        adminOptions={team.adminOptions}
        ownerOptions={team.ownerOptions}
        staff={team.directors}
      />
    </AddMenu>
  );
}

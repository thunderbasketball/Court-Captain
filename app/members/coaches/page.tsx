import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { listVolunteerCoaches } from "@/lib/coaches";
import { gradeLabel } from "@/lib/grades";
import { hasArea } from "@/lib/org-admin";
import { formatCell } from "@/lib/phone";
import { listUsers } from "@/lib/users";
import AppHeader from "../../AppHeader";
import { GroupTextButton } from "../../Contacts";
import NotifyButton from "../../NotifyButton";
import { Chip, EmailLink, GroupCard, PageTitle, PersonRow, PhoneLink, Stats } from "../../ui";
import UserList from "../../UserList";
import MembersNav from "../MembersNav";

export default function CoachesPage({ searchParams }: PageProps<"/members/coaches">) {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <Coaches searchParams={searchParams} />
    </Suspense>
  );
}

const TABS = [
  { key: "active", label: "Active" },
  { key: "volunteers", label: "Volunteers" },
  { key: "inactive", label: "Inactive" },
] as const;

// Members → Coaches (Directors of Coaches), in three tabs: Active (coaches, then team managers and parents) and Inactive,
// listed like Staff (Edit and View as for Admins); Volunteers from registration, each tagged with any team staff spot
// they already hold.
async function Coaches({ searchParams }: { searchParams: PageProps<"/members/coaches">["searchParams"] }) {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  if (!hasArea(user, "coaches")) redirect("/");
  const sp = await searchParams;
  const tab = TABS.find((t) => t.key === sp.view)?.key ?? "active";
  const [users, groups] = await Promise.all([listUsers(user), listVolunteerCoaches(user)]);
  const volunteers = groups.flatMap((g) => g.coaches);
  const onStaff = volunteers.filter((c) => c.staff.length).length;
  const active = users.filter((u) => u.active && !u.director && (u.coach || u.teams.length > 0));
  const coachCells = active.filter((u) => u.coach || u.teams.some((t) => /(Head|Asst) Coach$/.test(t))).map((u) => u.cell);
  const counts = {
    active: active.length,
    volunteers: volunteers.length,
    inactive: users.filter((u) => !u.active && !u.director).length,
  };

  return (
    <>
      <AppHeader user={user} tab="members" context="director" />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <MembersNav user={user} current="coaches" />
        <div className="flex flex-wrap items-start justify-between gap-3">
          <PageTitle title="Coaches" subtitle="Coaches and team staff, volunteers from registration, and inactive coaches" />
          {tab === "active" && (
            <div className="flex items-center gap-2">
              <GroupTextButton cells={coachCells} label="Text coaches" />
              <NotifyButton audience={{ roles: ["HeadCoach", "AsstCoach"] }} to="all coaches" size="md" />
            </div>
          )}
          {tab === "volunteers" && (
            <div className="flex items-center gap-2">
              <GroupTextButton cells={volunteers.map((c) => c.cell)} label="Text all" />
              <NotifyButton audience={{ volunteers: true }} to="all volunteer coaches" size="md" />
            </div>
          )}
        </div>
        <nav className="mb-4 flex gap-1 overflow-x-auto rounded-full bg-zinc-100 p-1 [scrollbar-width:none] dark:bg-zinc-900">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={t.key === "active" ? "/members/coaches" : `/members/coaches?view=${t.key}`}
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

        {tab === "active" && <UserList users={users} viewer={user} view="coaches" />}
        {tab === "inactive" && <UserList users={users} viewer={user} view="inactive-coaches" />}
        {tab === "volunteers" && (
          <>
            <Stats
              items={[
                { label: "Volunteers", value: volunteers.length },
                { label: "Not on a team", value: volunteers.length - onStaff, tone: "text-amber-600 dark:text-amber-400" },
                { label: "On a team", value: onStaff, tone: "text-emerald-600 dark:text-emerald-400" },
              ]}
            />
            {!volunteers.length && <p className="text-zinc-500">No volunteers yet.</p>}
            <div className="space-y-3">
              {groups.map((g) => (
                <GroupCard key={`${g.gender}-${g.grade}`} title={`${g.gender} · ${gradeLabel(g.grade)}`} count={g.coaches.length}>
                  {g.coaches.map((c) => (
                    <PersonRow
                      key={c.registrantId}
                      first={c.firstName}
                      last={c.lastName}
                      avatarTone={c.staff.length ? "green" : "zinc"}
                      chips={
                        <>
                          <Chip tone={c.isHead ? "blue" : "green"}>{c.isHead ? "Head Coach" : "Asst Coach"}</Chip>
                          {c.staff.length ? (
                            c.staff.map((x) => (
                              <Chip key={x} tone="orange">
                                {x}
                              </Chip>
                            ))
                          ) : (
                            <Chip tone="amber">Not on a team</Chip>
                          )}
                        </>
                      }
                    >
                      <p>{c.cell && c.cell.length === 10 ? <PhoneLink cell={c.cell} label={formatCell(c.cell)} /> : "No cell"}</p>
                      <p className="truncate">{c.email ? <EmailLink email={c.email} /> : "No email"}</p>
                      <p className="text-zinc-500">Parent of {c.playerName}</p>
                    </PersonRow>
                  ))}
                </GroupCard>
              ))}
            </div>
          </>
        )}
      </main>
    </>
  );
}

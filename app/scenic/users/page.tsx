import { Suspense } from "react";
import { redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { directorsPanel } from "@/lib/org-admin";
import { formatCell } from "@/lib/phone";
import { currentScenic } from "@/lib/contexts-server";
import { listScenicPeople } from "@/lib/scenic";
import AppHeader from "../../AppHeader";
import { MembersNav } from "../ScenicNav";
import { AddMenu, DirectorButtons, DirectorRole } from "../../DirectorTools";
import { ViewAsButton } from "../../ViewAsButton";
import { Chip, EmailLink, GroupCard, PageTitle, PersonRow, PhoneLink, Stats } from "../../ui";
import { EditScenicRoles, RequestButtons } from "./ScenicUserButtons";

export default function ScenicUsersPage() {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <ScenicUsers />
    </Suspense>
  );
}

const TONE = { Director: "blue", Partner: "orange", Solo: "pink", Coach: "green" } as const;

// Scenic City Directors: requests to join (oldest first), then everyone with a Scenic City role (by last name).
async function ScenicUsers() {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  const scenic = await currentScenic(user);
  if (scenic?.role !== "Director") redirect("/scenic");
  const people = await listScenicPeople({ pool: db, now: () => new Date() }, user);
  if (!people) redirect("/scenic");
  const { requests, members } = people;
  // Admins only: Directors' roles and areas, shown in their rows.
  const panel = await directorsPanel({ pool: db, now: () => new Date() }, user, "scenic-city");
  const active = members.filter((m) => m.active);
  const inactive = members.filter((m) => !m.active);

  const contact = (p: { cell: string; email: string | null }) => (
    <>
      <p>
        <PhoneLink cell={p.cell} label={formatCell(p.cell)} />
      </p>
      <p className="truncate">{p.email ? <EmailLink email={p.email} /> : "No email"}</p>
    </>
  );

  return (
    <>
      <AppHeader user={user} context={scenic.key} tab="scenic-members" />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <MembersNav user={user} current="staff" />
        <div className="flex flex-wrap items-start justify-between gap-3">
          <PageTitle title="Scenic City Users" subtitle="Join requests, then everyone with a Scenic City role, by last name" />
          {panel && (
            <AddMenu>
              <DirectorButtons
                org="scenic-city"
                areas={panel.areas}
                options={panel.options}
                canManageAdmins={panel.canManageAdmins}
                adminOptions={panel.adminOptions}
                ownerOptions={panel.ownerOptions}
              />
            </AddMenu>
          )}
        </div>
        <Stats
          items={[
            { label: "Requests", value: requests.length, tone: requests.length ? "text-amber-600 dark:text-amber-400" : "" },
            { label: "Solo", value: active.filter((m) => m.roles.includes("Solo")).length },
          ]}
        />
        <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-300">
          Join link to share: <span className="font-mono font-medium">/join/scenic-city</span>
        </p>
        <div className="space-y-3">
          <GroupCard title="Join requests" count={requests.length}>
            {requests.length ? (
              requests.map((r) => (
                <PersonRow
                  key={r.coachId}
                  first={r.firstName}
                  last={r.lastName}
                  href={panel ? `/me/${r.coachId}` : undefined}
                  avatarTone="zinc"
                  chips={<Chip tone={TONE[r.wants]}>{r.wants}</Chip>}
                >
                  {r.partner && (
                    <p className="font-medium text-zinc-800 dark:text-zinc-100">
                      {r.partner.name} · {r.partner.kind}
                      {!r.partner.approved && <span className="text-amber-700 dark:text-amber-300"> · new partner</span>}
                      <span className="block text-xs font-normal text-zinc-500">
                        {[r.partner.hostsGames && "Hosting games", r.partner.registersTeams && "Registering teams"]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </p>
                  )}
                  {contact(r)}
                  <RequestButtons coachId={r.coachId} name={`${r.firstName} ${r.lastName}`} wants={r.wants} />
                </PersonRow>
              ))
            ) : (
              <li className="px-4 py-3 text-sm text-zinc-500 italic">No pending requests.</li>
            )}
          </GroupCard>
          <GroupCard title="Scenic City people" count={active.length}>
            {active.map((m) => (
              <PersonRow
                key={m.coachId}
                first={m.firstName}
                last={m.lastName}
                avatarTone={m.roles.includes("Director") ? "blue" : "zinc"}
                href={panel ? (m.coachId === user.coachId ? "/me" : `/me/${m.coachId}`) : undefined}
                under={m.coachId !== user.coachId && <ViewAsButton coachId={m.coachId} name={`${m.firstName} ${m.lastName}`} />}
                chips={m.roles.map((r) => {
                  const d = r === "Director" ? panel?.directors.find((x) => x.id === m.coachId) : undefined;
                  return (
                    <Chip key={r} tone={TONE[r]}>
                      {d?.owner ? "Owner" : d?.admin ? "Admin" : r}
                    </Chip>
                  );
                })}
              >
                {panel && panel.directors.some((d) => d.id === m.coachId) && (
                  <DirectorRole
                    org="scenic-city"
                    orgName="Scenic City Basketball"
                    person={panel.directors.find((d) => d.id === m.coachId)!}
                    areas={panel.areas}
                    canManageAdmins={panel.canManageAdmins}
                  />
                )}
                {m.partners.length > 0 && (
                  <p className="font-medium text-zinc-800 dark:text-zinc-100">{m.partners.join(" · ")}</p>
                )}
                {contact(m)}
                <div className="flex items-end justify-between gap-2 pt-1">
                  <p className="text-xs text-zinc-500">{m.grantedBy && `Last role from ${m.grantedBy}`}</p>
                  <EditScenicRoles coachId={m.coachId} name={`${m.firstName} ${m.lastName}`} roles={m.roles} />
                </div>
              </PersonRow>
            ))}
          </GroupCard>
          {inactive.length > 0 && (
            <GroupCard title="Non-active" count={inactive.length} defaultOpen={false}>
              {inactive.map((m) => (
                <PersonRow key={m.coachId} first={m.firstName} last={m.lastName} dim chips={<Chip tone="red">Inactive</Chip>}>
                  {contact(m)}
                </PersonRow>
              ))}
            </GroupCard>
          )}
        </div>
      </main>
    </>
  );
}

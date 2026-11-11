import { redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { resettable } from "@/lib/login-reset";
import { directorsPanel, seesWho } from "@/lib/org-admin";
import { formatCell } from "@/lib/phone";
import { currentScenic } from "@/lib/contexts-server";
import { listScenicPeople } from "@/lib/scenic";
import AppHeader from "../../../AppHeader";
import { MembersNav } from "../ScenicNav";
import { AddMenu, DirectorButtons, DirectorRole } from "../../../DirectorTools";
import { ResetLoginButton } from "../../../ResetLoginButton";
import { ViewAsButton } from "../../../ViewAsButton";
import { Chip, EmailLink, GroupCard, PageTitle, PersonRow, PhoneLink, Stats } from "../../../ui";
import { EditScenicRoles, RequestButtons } from "./ScenicUserButtons";
import GearPopUp from "../../../GearPopUp";

import { PageFrame } from "../../../ui";

const TONE = { Director: "blue", Partner: "orange", Solo: "pink", Coach: "green" } as const;

// Scenic City Directors: requests to join (oldest first), then everyone with a Scenic City role (by last name). Laid out
// like other user cards: groups and cards collapsed, 👁 and a gear (Edit roles, Reset login) on the name line.
export async function ScenicUsersContent({
  embedded = false,
}: {
  embedded?: boolean; // inside a Home card: no header or page frame, and never sends you away
} = {}) {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  const scenic = await currentScenic(user);
  if (scenic?.role !== "Director") {
    if (embedded) return null;
    redirect("/org/scenic-city");
  }
  const people = await listScenicPeople({ pool: db, now: () => new Date() }, user);
  if (!people) {
    if (embedded) return null;
    redirect("/org/scenic-city");
  }
  const { requests, members } = people;
  const who = await seesWho(db, user, "scenic-city"); // Owners and Admins see who gave a role
  // Admins only: Directors' roles and areas, shown in their rows.
  const panel = await directorsPanel({ pool: db, now: () => new Date() }, user, "scenic-city");
  const active = members.filter((m) => m.active);
  const inactive = members.filter((m) => !m.active);
  const canReset = await resettable(
    db,
    user.coachId,
    "scenic-city",
    members.map((m) => m.coachId),
  );

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
      {!embedded && <AppHeader user={user} context={scenic.key} tab="scenic-members" />}
      <PageFrame embedded={embedded} className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        {!embedded && <MembersNav user={user} current="staff" />}
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
          ]}
        />
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
                  collapsed
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
          <GroupCard title="Scenic City people" count={active.length} defaultOpen={false}>
            {active.map((m) => (
              <PersonRow
                key={m.coachId}
                first={m.firstName}
                last={m.lastName}
                avatarTone={m.roles.includes("Director") ? "blue" : "zinc"}
                href={panel ? (m.coachId === user.coachId ? "/me" : `/me/${m.coachId}`) : undefined}
                collapsed
                chips={
                  <>
                    {m.roles.map((r) => {
                      const d = r === "Director" ? panel?.directors.find((x) => x.id === m.coachId) : undefined;
                      return (
                        <Chip key={r} tone={TONE[r]}>
                          {d?.owner ? "Owner" : d?.admin ? "Admin" : r}
                        </Chip>
                      );
                    })}
                    {m.coachId !== user.coachId && <ViewAsButton coachId={m.coachId} name={`${m.firstName} ${m.lastName}`} />}
                    <GearPopUp title={`${m.firstName} ${m.lastName}`}>
                      <EditScenicRoles coachId={m.coachId} name={`${m.firstName} ${m.lastName}`} roles={m.roles} />
                      {m.coachId !== user.coachId && canReset.has(m.coachId) && (
                        <div className="flex items-center gap-2 text-sm">
                          <ResetLoginButton org="scenic-city" coachId={m.coachId} name={`${m.firstName} ${m.lastName}`} />
                          Reset login
                        </div>
                      )}
                    </GearPopUp>
                  </>
                }
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
                {who && m.grantedBy && <p className="pt-1 text-xs text-zinc-500">Last role from {m.grantedBy}</p>}
              </PersonRow>
            ))}
          </GroupCard>
          {inactive.length > 0 && (
            <GroupCard title="Non-active" count={inactive.length} defaultOpen={false}>
              {inactive.map((m) => (
                <PersonRow
                  key={m.coachId}
                  first={m.firstName}
                  last={m.lastName}
                  dim
                  collapsed
                  chips={
                    <>
                      <Chip tone="red">Inactive</Chip>
                      {canReset.has(m.coachId) && (
                        <GearPopUp title={`${m.firstName} ${m.lastName}`}>
                          <div className="flex items-center gap-2 text-sm">
                            <ResetLoginButton org="scenic-city" coachId={m.coachId} name={`${m.firstName} ${m.lastName}`} />
                            Reset login
                          </div>
                        </GearPopUp>
                      )}
                    </>
                  }
                >
                  {contact(m)}
                </PersonRow>
              ))}
            </GroupCard>
          )}
        </div>
      </PageFrame>
    </>
  );
}

import { Suspense } from "react";
import TeamsIncluded from "../../../TeamsIncluded";
import { notFound, redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { isOrgAdmin, seesWho } from "@/lib/org-admin";
import { ViewAsButton } from "../../../ViewAsButton";
import { orgPrograms } from "@/lib/org-leagues";
import { listOrgCoaches, listOrgTeams, listTeamImports } from "@/lib/org-teams";
import { TZ } from "@/lib/time";
import { orgInfo } from "@/lib/org-registry";
import AppHeader from "../../../AppHeader";
import { CollapseCard, PageTitle } from "../../../ui";
import TeamRow, { GradeGroups, TeamsTabs, teamTabs } from "../../../TeamRow";
import { ContactChip, GroupTextButton, TextTeamsButton } from "../../../Contacts";
import RegisterPrograms from "../../../RegisterPrograms";
import AddTeamButton from "../../../AddTeam";
import { ImportTeamsButton, UndoImportButton } from "../../../TeamImport";
import { addTeam, importTeams, previewImport, undoImport } from "./actions";
import { followRename } from "@/lib/org-rename";
import { recAllowed } from "@/lib/rec-orgs";

export default function OrgTeamsPage({ params, searchParams }: PageProps<"/org/[slug]/teams">) {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <OrgTeams params={params} searchParams={searchParams} />
    </Suspense>
  );
}

// A registered organization's teams (Team Management): Boys then Girls, by grade. Admins and Directors of Teams see all
// and add teams; a coach sees their own.
async function OrgTeams({
  params,
  searchParams,
}: {
  params: PageProps<"/org/[slug]/teams">["params"];
  searchParams: PageProps<"/org/[slug]/teams">["searchParams"];
}) {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  const { slug } = await params;
  const who = await seesWho(db, user, slug); // Owners and Admins see who did it
  await followRename(slug, (s) => `/org/${s}/teams`);
  const [o, list] = await Promise.all([orgInfo(db, slug), listOrgTeams({ pool: db, now: () => new Date() }, user, slug)]);
  if (!o || !list) notFound();
  // Who can be a Head Coach here: the organization's coaches (or a new person typed in).
  const coaches = list.canManage ? await listOrgCoaches({ pool: db, now: () => new Date() }, user, slug) : null;
  const imports = list.canManage ? ((await listTeamImports({ pool: db, now: () => new Date() }, user, slug)) ?? []) : [];
  const when = (d: Date) =>
    d.toLocaleString("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const progs = await orgPrograms({ pool: db, now: () => new Date() }, user, slug);
  // Tabs: one per level and gender it has teams for (youngest grade first), then Register (league programs).
  const register = !!progs && progs.programs.length > 0 && list.canManage;
  const tabs = teamTabs(list.teams, (await searchParams).view, register);
  const solo = o.kind === "Team";
  const recOk = list.canManage && (await recAllowed(db, slug, new Date())); // REC only when invited to a League's REC
  const admin = await isOrgAdmin(db, user.coachId, slug); // Owners and Admins: 👁 View as on each coach // a CourtSolo account: its one team, no Add or Import

  return (
    <>
      <AppHeader user={user} context={`org:${slug}`} tab="org-teams" />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <div className="flex items-start justify-between gap-3">
          <PageTitle
            title={`Teams (${list.teams.length})`}
            subtitle={list.canManage ? `${o.name}'s teams and coaches` : "Your teams"}
          />
          {list.canManage && (
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              {/* All coaches: text (Chat and Notify come when those features work for organizations) */}
              <TextTeamsButton
                teams={list.teams.map((t, i) => ({
                  id: t.id,
                  name: t.name,
                  gender: t.gender,
                  level: t.level,
                  grade: i, // already youngest grade first
                  headCells: t.coaches.filter((c) => c.role === "HeadCoach").map((c) => c.cell),
                }))}
              />
              {!solo && (
                <ImportTeamsButton
                  preview={previewImport.bind(null, slug)}
                  add={importTeams.bind(null, slug)}
                  example={
                    "Gender,Grade,Level,Coach First,Coach Last,Coach Cell,Alternate Name\nBoys,3rd/4th,REC,Sam,Lee,423-555-0101,Bolts\nGirls,5th,COMP,,,,"
                  }
                  help="One team per row with its Gender, Grade and Level (REC or COMP), and if you have them the Head Coach's name, cell and email and an Alternate name, in any order. Each team is named from its Head Coach (like 4G Epps; 4G TBD until a coach is added; the same name twice gets numbers: 4G Epps 1 and 2). A coach without a cell is fine: add it later on the team. Paste from a spreadsheet or choose a CSV file. Next you'll check which column is which, then see exactly what will be added (we clean up things like 3 & 4 or R)."
                />
              )}
              {!solo && (
                <AddTeamButton
                  people={(coaches ?? []).map((c) => {
                    const [firstName, ...rest] = c.name.split(" ");
                    return { value: `user:${c.id}`, firstName, lastName: rest.join(" "), detail: "Coach" };
                  })}
                  create={addTeam.bind(null, slug)}
                  preK
                  noRec={!recOk}
                  href={`/org/${slug}/teams/`}
                />
              )}
            </div>
          )}
        </div>
        <TeamsTabs base={`/org/${slug}/teams`} current={tabs.current} groups={tabs.groups} register={register} />
        {!list.teams.length && !solo && (
          <p className="text-sm text-zinc-500">No teams yet. Tap “+ Add” (or Import) to create some.</p>
        )}
        {tabs.group && (
          <GradeGroups
            teams={tabs.group.teams}
            grade={(t) => {
              const top = t.grade.split("/").at(-1);
              return t.grade === "Pre-K" ? "Pre-K" : top === "K" || top === "0th" ? "Kindergarten" : `${top} Grade`;
            }}
            row={(t) => (
            <TeamRow
              key={t.id}
              href={`/org/${slug}/teams/${t.id}`}
              name={t.name}
              altName={t.altName}
              gender={t.gender}
              level={t.level}
              sub={t.grade === "Pre-K" ? "Pre-K (ages 3–4)" : t.grade.includes("/") ? `${t.grade} grade` : ""}
              hasCoach={t.coaches.some((c) => c.role === "HeadCoach")}
              waitingCoach={t.waitingCoach && `${t.waitingCoach.first} ${t.waitingCoach.last}`}
              needsEmail={t.coaches.some((c) => c.role === "HeadCoach" && !c.email)}
              players={t.players}
              actions={
                t.coaches.length > 0 && <GroupTextButton small cells={t.coaches.map((c) => c.cell)} label="Text coaches" />
              }
              people={t.coaches.map((c) => {
                const [first, ...rest] = c.name.split(" ");
                return (
                  <ContactChip
                    key={c.id}
                    person={{ role: c.role, email: c.email, first, last: rest.join(" "), cell: c.cell }}
                    about={t.name}
                    extra={admin && c.id !== user.coachId && <ViewAsButton coachId={c.id} name={c.name} />}
                  />
                );
              })}
            />
            )}
          />
        )}
        {tabs.current === "register" && progs && <RegisterPrograms org={slug} progs={progs} />}
        {imports.length > 0 && (
          <div className="mt-4">
            <CollapseCard title="Recent imports" count={imports.length}>
              <ul className="divide-y divide-zinc-100 px-4 pb-2 dark:divide-white/5">
                {imports.map((i) => (
                  <li key={i.id} className="flex items-start justify-between gap-3 py-2 text-sm">
                    <TeamsIncluded
                      names={i.names}
                      summary={
                        <>
                          {when(i.importedAt)} · {i.teams} team{i.teams === 1 ? "" : "s"}
                          {who && ` · by ${i.importedBy}`}
                          {i.left < i.teams && ` · ${i.left} still here`}
                        </>
                      }
                    />
                    {i.left > 0 && (
                      <UndoImportButton
                        undo={undoImport.bind(null, slug, i.id)}
                        teams={i.left}
                        when={when(i.importedAt)}
                        note="Teams registered in a program are kept (withdraw them first)."
                      />
                    )}
                  </li>
                ))}
              </ul>
            </CollapseCard>
          </div>
        )}
      </main>
    </>
  );
}

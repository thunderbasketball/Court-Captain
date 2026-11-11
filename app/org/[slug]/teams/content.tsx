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
import TeamRow, { TeamsByLevel } from "../../../TeamRow";
import { ContactChip, GroupTextButton, TextTeamsPanel } from "../../../Contacts";
import { NotifyPanel } from "../../../NotifyButton";
import { sendsAlerts } from "@/lib/announcements";
import { dmKey, orgKey } from "@/lib/chat";
import { hasFeature } from "@/lib/features";
import ChatPanel from "../../../ChatPanel";
import PageMenus, { MEGAPHONE_BTN, MegaphoneIcon, PLUS_BTN, PlusIcon } from "../../../PageMenus";
import RegisterPrograms from "../../../RegisterPrograms";
import { AddTeamPanel } from "../../../AddTeam";
import { ImportTeamsPanel, UndoImportButton } from "../../../TeamImport";
import { addTeam, importTeams, previewImport, undoImport } from "./actions";
import { followRename } from "@/lib/org-rename";
import { recAllowed } from "@/lib/rec-orgs";

import { PageFrame } from "../../../ui";

// A registered organization's teams (Team Management): Boys then Girls, by grade. Admins and Directors of Teams see all
// and add teams; a coach sees their own.
export async function OrgTeamsContent({
  params,
  searchParams = Promise.resolve({}),
  embedded = false,
}: {
  params: PageProps<"/org/[slug]/teams">["params"];
  searchParams?: PageProps<"/org/[slug]/teams">["searchParams"];
  embedded?: boolean; // inside a Home card: no header or page frame, and never sends you away
}) {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  const { slug } = await params;
  const who = await seesWho(db, user, slug); // Owners and Admins see who did it
  await followRename(slug, (s) => `/org/${s}/teams`);
  const [o, list] = await Promise.all([orgInfo(db, slug), listOrgTeams({ pool: db, now: () => new Date() }, user, slug)]);
  if (!o || !list) {
    if (embedded) return null;
    notFound();
  }
  // Who can be a Head Coach here: the organization's coaches (or a new person typed in).
  const coaches = list.canManage ? await listOrgCoaches({ pool: db, now: () => new Date() }, user, slug) : null;
  const imports = list.canManage ? ((await listTeamImports({ pool: db, now: () => new Date() }, user, slug)) ?? []) : [];
  const when = (d: Date) =>
    d.toLocaleString("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const progs = await orgPrograms({ pool: db, now: () => new Date() }, user, slug);
  // Cards: REC and COMP (Boys and Girls in each, by grade; youngest first), then Register (league programs).
  const register = !!progs && progs.programs.length > 0 && list.canManage;
  const view = (await searchParams).view;
  const solo = o.kind === "Team";
  // Its Directors alert its coaches (📣 → Alert coaches) and each team's coaches (the bell on its card).
  const alerter = await sendsAlerts({ pool: db, now: () => new Date() }, user, slug);
  // With Chat, its Directors also chat with its coaches (📣), each team's coaches (on its card) and one coach (their chip).
  const chatter = alerter && (await hasFeature(db, slug, "chat"));
  const recOk = list.canManage && (await recAllowed(db, slug, new Date())); // REC only when invited to a League's REC
  const admin = await isOrgAdmin(db, user.coachId, slug); // Owners and Admins: 👁 View as on each coach // a CourtSolo account: its one team, no Add or Import

  return (
    <>
      {!embedded && <AppHeader user={user} context={`org:${slug}`} tab="org-teams" />}
      <PageFrame embedded={embedded} className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        {/* The same as every Teams page: 📣 (Text coaches; Chat and Alert come when those work for organizations) and + (Add, Import). */}
        <PageMenus
          slot={embedded ? "card-slot-teams" : undefined}
          title={
            <PageTitle
              title={`Teams (${list.teams.length})`}
              subtitle={list.canManage ? `${o.name}'s teams and coaches` : "Your teams"}
            />
          }
          menus={
            list.canManage
              ? [
                  {
                    key: "coaches",
                    icon: <MegaphoneIcon />,
                    label: chatter ? "Coaches: text, chat or alert" : alerter ? "Coaches: text or alert" : "Coaches: text",
                    className: MEGAPHONE_BTN,
                    items: [
                      {
                        key: "text",
                        label: "💬 Text coaches",
                        panel: (
                          <TextTeamsPanel
                            teams={list.teams.map((t, i) => ({
                              id: t.id,
                              name: t.name,
                              gender: t.gender,
                              level: t.level,
                              grade: i, // already youngest grade first
                              headCells: t.coaches.filter((c) => c.role === "HeadCoach").map((c) => c.cell),
                            }))}
                          />
                        ),
                      },
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
                  ...(solo
                    ? []
                    : [
                        {
                          key: "add",
                          icon: <PlusIcon />,
                          label: "Add or import teams",
                          className: PLUS_BTN,
                          items: [
                            {
                              key: "add",
                              label: "＋ Add a team",
                              panel: (
                                <AddTeamPanel
                                  people={(coaches ?? []).map((c) => {
                                    const [firstName, ...rest] = c.name.split(" ");
                                    return { value: `user:${c.id}`, firstName, lastName: rest.join(" "), detail: "Coach" };
                                  })}
                                  create={addTeam.bind(null, slug)}
                                  preK
                                  noRec={!recOk}
                                  href={`/org/${slug}/teams/`}
                                />
                              ),
                            },
                            {
                              key: "import",
                              label: "⇪ Import teams",
                              panel: (
                                <ImportTeamsPanel
                                  preview={previewImport.bind(null, slug)}
                                  add={importTeams.bind(null, slug)}
                                  example={
                                    "Gender,Grade,Level,Coach First,Coach Last,Coach Cell,Alternate Name\nBoys,3rd/4th,REC,Sam,Lee,423-555-0101,Bolts\nGirls,5th,COMP,,,,"
                                  }
                                  help="One team per row with its Gender, Grade and Level (REC or COMP), and if you have them the Head Coach's name, cell and email and an Alternate name, in any order. Each team is named from its Head Coach (like 4G Epps; 4G TBD until a coach is added; the same name twice gets numbers: 4G Epps 1 and 2). A coach without a cell is fine: add it later on the team. Paste from a spreadsheet or choose a CSV file. Next you'll check which column is which, then see exactly what will be added (we clean up things like 3 & 4 or R)."
                                />
                              ),
                            },
                          ],
                        },
                      ])
                ]
              : []
          }
        />
        {!list.teams.length && !solo && (
          <p className="text-sm text-zinc-500">No teams yet. Tap “+” to add or import some.</p>
        )}
        {(list.teams.length > 0 || register) && (
          <TeamsByLevel
            teams={list.teams}
            view={view}
            register={register && progs ? { count: progs.programs.length, body: <RegisterPrograms org={slug} progs={progs} bare /> } : null}
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
              lead={t.coaches.length > 0 && <GroupTextButton small cells={t.coaches.map((c) => c.cell)} label="Text coaches" />}
              notify={alerter && t.coaches.length > 0 ? { org: slug, teams: [t.id] } : undefined}
              chat={
                chatter && t.coaches.length > 0
                  ? { chatKey: orgKey(slug, `staff-${user.coachId}-${t.id}`), label: `Chat with ${t.name} coaches` }
                  : undefined
              }
              people={t.coaches.map((c) => {
                const [first, ...rest] = c.name.split(" ");
                return (
                  <ContactChip
                    key={c.id}
                    person={{ role: c.role, email: c.email, first, last: rest.join(" "), cell: c.cell }}
                    about={t.name}
                    chatKey={chatter && c.id !== user.coachId ? dmKey(user.coachId, c.id, slug) : undefined}
                    extra={admin && c.id !== user.coachId && <ViewAsButton coachId={c.id} name={c.name} />}
                  />
                );
              })}
            />
            )}
          />
        )}
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
      </PageFrame>
    </>
  );
}

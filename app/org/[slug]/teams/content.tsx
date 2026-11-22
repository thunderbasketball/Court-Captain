import { notFound, redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { isOrgAdmin, seesWho } from "@/lib/org-admin";
import { ViewAsButton } from "../../../ViewAsButton";
import { listOrgCoaches, listOrgTeams, listTeamImports } from "@/lib/org-teams";
import { orgInfo } from "@/lib/org-registry";
import AppHeader from "../../../AppHeader";
import TeamsList, { IMPORT_EXAMPLE, IMPORT_HELP } from "../../../TeamsList";
import { ScheduleList } from "../../../LeagueGames";
import { scheduledGames, type ScheduledGame } from "@/lib/scenic-games";
import { teamScrimmages } from "@/lib/scrimmages";
import { upcomingOwnForTeams } from "@/lib/team-practices";
import { easternDate } from "@/lib/time";
import TeamRow, { OrgRosterList, teamMix, teamNeeds } from "../../../TeamRow";
import { ContactChip, GroupTextButton } from "../../../Contacts";
import { sendsAlerts } from "@/lib/announcements";
import { dmKey, orgKey } from "@/lib/chat";
import { hasFeature } from "@/lib/features";
import { AddTeamPanel } from "../../../AddTeam";
import { EditNamesPanel } from "./EditNamesPanel";
import { ImportTeamsPanel } from "../../../TeamImport";
import { addTeam, importTeams, previewImport, undoImport } from "./actions";
import { OrgTeamView } from "./[id]/view";
import { followRename } from "@/lib/org-rename";
import { recAllowed } from "@/lib/rec-orgs";

import { PageFrame } from "../../../ui";
import { currentRegistrations } from "@/lib/current-registrations";

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
  const sp = await searchParams;
  const view = sp.view;
  // Teams whose page is open right in their row (↗; `?team=<id>,…`): only those are built.
  const openTeams = new Set(typeof sp.team === "string" ? sp.team.split(",") : []);
  const solo = o.kind === "Team";
  // Its Directors alert its coaches (📣 → Alert coaches) and each team's coaches (the bell on its card).
  const alerter = await sendsAlerts({ pool: db, now: () => new Date() }, user, slug);
  // With team chats (CourtPlayers), its Directors also chat with its coaches (📣), each team's coaches (on its card) and
  // one coach (their chip).
  const chatter = alerter && (await hasFeature(db, slug, "team-chat"));
  const recOk = list.canManage && (await recAllowed(db, slug, new Date())); // REC only when invited to a League's REC
  const admin = await isOrgAdmin(db, user.coachId, slug);
  // Each team's 📅 (published League games, own-gym practices, scrimmages) and 👥 roster, on its row.
  const ids = list.teams.map((t) => t.id);
  const today = easternDate(new Date());
  const copies = (
    await db.query<{ id: string; team: string }>("select id::text, org_team_id::text as team from scenic_teams where org_team_id = any($1::bigint[])", [ids])
  ).rows;
  const games = await scheduledGames(db, copies.map((c) => c.id));
  const schedules: Record<string, ScheduledGame[]> = Object.fromEntries(copies.map((c) => [c.team, (games[c.id] ?? []).filter((g) => g.published)]));
  const regs = await currentRegistrations(db, "org", ids, new Date()); // "✓ Winter (26/27) · Paid" under each name
  const [own, scrims, rosterRows] = await Promise.all([
    upcomingOwnForTeams({ pool: db, now: () => new Date() }, slug, ids),
    teamScrimmages({ pool: db, now: () => new Date() }, slug, ids),
    db.query<{ team: string; first: string; last: string; jersey: string | null }>(
      `select team_id::text as team, first_name as first, last_name as last, jersey from org_team_players
        where team_id = any($1::bigint[]) order by lower(last_name), lower(first_name)`,
      [ids],
    ),
  ]);
  const rosters: Record<string, { first: string; last: string; jersey: string | null }[]> = {};
  for (const { team, ...p } of rosterRows.rows) (rosters[team] ??= []).push(p); // Owners and Admins: 👁 View as on each coach // a CourtSolo account: its one team, no Add or Import

  return (
    <>
      {!embedded && <AppHeader user={user} context={`org:${slug}`} tab="org-teams" />}
      <PageFrame embedded={embedded} className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <TeamsList
          slot={embedded ? "card-slot-teams" : undefined}
          count={list.teams.length}
          subtitle={teamMix(list.teams) || (list.canManage ? `${o.name}'s teams and coaches` : "Your teams")}
          coaches={
            list.canManage
              ? {
                  text: list.teams.map((t, i) => ({
                    id: t.id,
                    name: t.name,
                    gender: t.gender,
                    level: t.level,
                    grade: i, // already youngest grade first
                    headCells: t.coaches.filter((c) => c.role === "HeadCoach").map((c) => c.cell),
                    headEmails: t.coaches.filter((c) => c.role === "HeadCoach").map((c) => c.email),
                  })),
                  email: await isOrgAdmin(db, user.coachId, slug),
                  chatKey: chatter ? orgKey(slug, "coaches") : null,
                  alert: alerter ? { org: slug, roles: ["coach"] } : null,
                }
              : null
          }
          add={
            list.canManage && !solo
              ? {
                  add: (
                    <AddTeamPanel orgName={o.short || o.name} me={{ value: `user:${user.coachId}`, firstName: user.firstName, lastName: user.lastName }}
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
                  import: <ImportTeamsPanel preview={previewImport.bind(null, slug)} add={importTeams.bind(null, slug)} example={IMPORT_EXAMPLE} help={IMPORT_HELP} />,
                  names: list.teams.length > 0 && (
                    <EditNamesPanel org={slug} orgName={o.short || o.name} teams={list.teams.map((t) => ({ id: t.id, name: t.name, alt: t.altName }))} />
                  ),
                }
              : null
          }
          warnings={list.canManage && !solo ? { org: slug, base: `/org/${slug}` } : null}
          empty={solo ? null : "No teams yet. Tap “+” to add or import some."}
          teams={list.teams}
          view={view}
          grade={(t) => {
            const top = t.grade.split("/").at(-1);
            return t.grade === "Pre-K" ? "Pre-K" : top === "K" || top === "0th" ? "Kindergarten" : `${top} Grade`;
          }}
          warn={(t) =>
            teamNeeds({
              hasCoach: t.coaches.some((c) => c.role === "HeadCoach"),
              waitingCoach: t.waitingCoach,
              needsEmail: t.coaches.some((c) => c.role === "HeadCoach" && !c.email),
              players: t.players,
            })
          }
            row={(t) => (
            <TeamRow
              key={t.id}
              href={`/org/${slug}/teams/${t.id}`}
              page={{ id: t.id, content: openTeams.has(t.id) ? <OrgTeamView slug={slug} id={t.id} embedded /> : null }}
              name={t.name}
              altName={t.altName}
              gender={t.gender}
              level={t.level}
              registrations={regs[t.id]}
              sub={t.grade === "Pre-K" ? "Pre-K (ages 3–4)" : t.grade.includes("/") ? `${t.grade} grade` : ""}
              hasCoach={t.coaches.some((c) => c.role === "HeadCoach")}
              waitingCoach={t.waitingCoach && `${t.waitingCoach.first} ${t.waitingCoach.last}`}
              needsEmail={t.coaches.some((c) => c.role === "HeadCoach" && !c.email)}
              players={t.players}
              roster={{ count: t.players, list: <OrgRosterList players={rosters[t.id] ?? []} /> }}
              schedule={{
                items: (schedules[t.id] ?? []).length + (own[t.id] ?? []).length + (scrims[t.id] ?? []).length,
                list: <ScheduleList games={schedules[t.id] ?? []} practices={[]} own={own[t.id] ?? []} scrims={scrims[t.id] ?? []} today={today} />,
              }}
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
                    person={{ role: c.role, email: c.email, first, last: rest.join(" "), cell: c.cell, verified: c.verified }}
                    about={t.name}
                    chatKey={chatter && c.id !== user.coachId ? dmKey(user.coachId, c.id, slug) : undefined}
                    extra={admin && c.id !== user.coachId && <ViewAsButton coachId={c.id} name={c.name} />}
                  />
                );
              })}
            />
            )}
          imports={{
            list: imports,
            who,
            undo: (id) => undoImport.bind(null, slug, id),
            note: "Teams registered in a program are kept (withdraw them first).",
          }}
        />
      </PageFrame>
    </>
  );
}

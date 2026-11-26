import { leagueDuplicates } from "@/lib/duplicate-numbers";
import { easternDate } from "@/lib/time";
import { wrongBirthdate } from "@/lib/roster-match";
import TeamsIncluded from "../../../TeamsIncluded";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { currentScenic } from "@/lib/contexts-server";
import { db } from "@/lib/db";
import { isOrgAdmin, seesWho } from "@/lib/org-admin";
import { ViewAsButton } from "../../../ViewAsButton";
import { requireFeature } from "@/lib/features-server";
import TeamRow, { OrgRosterList } from "../../../TeamRow";
import { ContactChip, GroupTextButton } from "../../../Contacts";
import { leagueRegistrations } from "@/lib/current-registrations";
import { listClubImports, outsideClubs, scenicCoachOptions } from "@/lib/scenic-club-teams";
import { GRADE_CHOICES, gradeRange, listScenicTeams, type ScenicTeam } from "@/lib/scenic-teams";
import { TZ } from "@/lib/time";
import AppHeader from "../../../AppHeader";
import { AddTeamPanel } from "../../../AddTeam";
import PageMenus, { PLUS_BTN, PlusIcon } from "../../../PageMenus";
import { StandardEmails } from "../../../season-guide/SeasonGuidePanel";
import SubCard from "../../../SubCard";
import { ImportTeamsPanel, UndoImportButton } from "../../../TeamImport";
import { CollapseCard, GroupCard, PageTitle } from "../../../ui";
import { DeleteTeam, PlayInTeam, TeamEditor } from "./TeamEditor";
import { playInChoices, type PlayIn } from "@/lib/league-team-change";
import { addClubTeam, importClubTeams, previewClubImport, undoClubImport } from "../actions";

import { PageFrame } from "../../../ui";
import { hasFeature } from "@/lib/features";
import { homeCardHref } from "@/lib/home-card-href";
import TeamViews from "./TeamViews";
import FastbreakList from "./fastbreak/FastbreakList";
import { LeagueTeamView } from "./[id]/view";
import { leagueStaff } from "@/lib/scenic-team-page";

const SUBTITLE: Record<string, string> = {
  Director: "Every team in Scenic City",
  Partner: "Your partners' teams",
  Solo: "Your own teams",
  Coach: "The teams you coach",
};

const NO_DIVISION = 99;
const divisionOf = (t: ScenicTeam) =>
  t.divisionLow === null || t.divisionHigh === null ? "Not in a division yet" : gradeRange(t.divisionLow, t.divisionHigh);
const orgOf = (t: ScenicTeam) => t.partnerName ?? `Solo · ${t.ownerName}`;
// Gender, division, grade, level, name: the order inside every group.
const byTeam = (a: ScenicTeam, b: ScenicTeam) =>
  Number(b.gender === "Coed") - Number(a.gender === "Coed") || // Pre-K (Coed) first, the youngest
  a.gender.localeCompare(b.gender) ||
  (a.divisionLow ?? NO_DIVISION) - (b.divisionLow ?? NO_DIVISION) ||
  a.grade - b.grade ||
  a.gradeLow - b.gradeLow ||
  a.level.localeCompare(b.level) ||
  a.name.localeCompare(b.name);

// Scenic City teams (SPEC.md section 13), as the chip in use sees them, in two views: By division (Gender → Division →
// Grade → Level → Name) and By organization (Organization → Gender → Division → Grade → Level → Name). A Director of
// Teams adds outside clubs' teams (+ Add, Import); organizations on CourtCaptain add and register their own.
export async function ScenicTeamsContent({
  searchParams = Promise.resolve({}),
  embedded = false,
}: {
  searchParams?: PageProps<"/org/scenic-city/teams">["searchParams"];
  embedded?: boolean; // inside a Home card: no header or page frame, and never sends you away
} = {}) {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  if (embedded) {
    if (!(await hasFeature(db, "scenic-city", "team-registration"))) return null;
  } else await requireFeature("scenic-city", "team-registration");
  const scenic = await currentScenic(user);
  if (!scenic) {
    if (embedded) return null;
    redirect("/");
  }
  const deps = { pool: db, now: () => new Date() };
  // A program at a time: the one picked (past ones too, to look back), else the soonest that hasn't ended; "none" lists
  // Scenic City's own teams (outside clubs', CourtSolo) not in a current program.
  const sp = await searchParams;
  const asked = typeof sp.program === "string" ? sp.program : undefined;
  const first = await listScenicTeams(deps, user, scenic.role, asked ?? "pick");
  if (!first) {
    if (embedded) return null;
    redirect("/org/scenic-city");
  }
  const program =
    asked && (asked === "none" || first.programs.some((p) => p.id === asked))
      ? asked
      : (first.programs.find((p) => !p.ended)?.id ?? "none");
  const data = program === asked ? first : (await listScenicTeams(deps, user, scenic.role, program))!;
  const view = sp.view === "org" ? "org" : "division";
  const openTeams = new Set(typeof sp.team === "string" ? sp.team.split(",") : []); // ↗ teams opened in their rows
  const qs = (v: string, p: string) => {
    const x = new URLSearchParams();
    if (v === "org") x.set("view", "org");
    x.set("program", p);
    // On Home, straight to Home with the card open (no stop at the old address).
    return embedded ? homeCardHref("/org/scenic-city", "teams", Object.fromEntries(x)) : `/org/scenic-city/teams?${x}`;
  };
  const teams = [...data.teams].sort(byTeam);
  // "✓ Winter (26/27) · Paid" under each name.
  const regs = await leagueRegistrations(
    db,
    teams.map((t) => t.id),
    new Date(),
  );
  // League teams kept here (FastBreak, clubs, Solo): their rosters, with each player's birthdate (asked; missing: a warning).
  const leaguePlayers = await db.query<{ team: string; first: string; last: string; jersey: string | null; birthdate: string | null; grade: number | null }>(
    `select team_id::text as team, first_name as first, last_name as last, jersey, grade, to_char(birthdate, 'YYYY-MM-DD') as birthdate
       from scenic_team_players where team_id = any($1::bigint[]) order by jersey::int nulls last, lower(last_name), lower(first_name)`,
    [teams.map((t) => t.id)],
  );
  const rosters: Record<string, { first: string; last: string; jersey: string | null; birthdate: string | null; wrong: boolean }[]> = {};
  // Numbers two players share, wherever the team's roster is kept (Thunder's, its organization's, or here).
  const dups = new Map((await leagueDuplicates(db, { ids: teams.map((t) => t.id) })).map((t) => [t.id, t.numbers]));
  const now = easternDate(new Date());
  for (const { team, ...p } of leaguePlayers.rows) (rosters[team] ??= []).push({ ...p, wrong: wrongBirthdate(p, now) });
  // Each team's whole staff, from where it's kept (Thunder's, its organization's, or here), with the verified ✓.
  const staff = await leagueStaff(
    db,
    teams.map((t) => t.id),
  );
  const director = scenic.role === "Director";
  const who = await seesWho(db, user, "scenic-city"); // Owners and Admins see who did it
  // Admins (not while viewing as someone): View as each coach (the server checks it again).
  const viewAs = !user.actingBy && (await isOrgAdmin(db, user.coachId, "scenic-city"));
  const [clubs, people, imports] = director
    ? await Promise.all([outsideClubs(db), scenicCoachOptions(db), listClubImports(deps, user)])
    : [[], [], null];
  // League staff: where each opened team plays in its Leagues, to place it in another division (Play in another division).
  const plays: Record<string, PlayIn[]> = director
    ? Object.fromEntries(await Promise.all([...openTeams].filter((id) => /^\d{1,18}$/.test(id)).map(async (id) => [id, await playInChoices(db, id, new Date())] as const)))
    : {};
  const when = (d: Date) =>
    d.toLocaleString("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  // By division: a heading per gender, a card per division. By organization: a card per organization, with
  // "Boys · K–1st" lines inside.
  const groupsFor = (view: "division" | "org") =>
    view === "division"
      ? ["Coed", "Boys", "Girls"].flatMap((g) =>
          [...new Set(teams.filter((t) => t.gender === g).map(divisionOf))].map((d) => ({
            gender: g,
            title: `${g} · ${d}`,
            teams: teams.filter((t) => t.gender === g && divisionOf(t) === d),
          })),
        )
      : [...new Set(teams.map(orgOf))]
          .sort((a, b) => a.localeCompare(b))
          .map((o) => ({ gender: "", title: o, teams: teams.filter((t) => orgOf(t) === o) }));

  // Each team as the same card every organization's Teams list uses: its grade badge, name, level and current
  // registrations, its coaches (👁 View as for Admins), ↗ its team page opened right here (its games, and Edit and Delete
  // for teams kept here).
  const row = (t: ScenicTeam) => {
    return (
      <TeamRow
        key={t.id}
        href={`/org/scenic-city/teams/${t.id}`}
        name={t.name}
        altName={t.altName}
        gender={t.gender}
        level={t.level}
        registrations={regs[t.id]}
        sub={`${t.gradeLabel} · ${orgOf(t)}`}
        hasCoach={!!t.coachId}
        waitingCoach={t.waitingCoach ? `${t.coachFirst} ${t.coachLast}` : null}
        needsEmail={(!!t.coachId && !t.coachEmail) || t.waitingCoach}
        players={t.players}
        // A League team kept here: its roster on the card (👥), birthdates shown, a warning while any is missing.
        roster={t.canEdit || rosters[t.id] ? { count: t.players ?? 0, list: <OrgRosterList players={rosters[t.id] ?? []} /> } : undefined}
        missingBirthdates={(rosters[t.id] ?? []).filter((p) => !p.birthdate).length}
        wrongBirthdates={(rosters[t.id] ?? []).filter((p) => p.wrong).length}
        missingNumbers={(rosters[t.id] ?? []).filter((p) => !p.jersey).length}
        duplicateNumbers={dups.get(t.id)}
        // ↗ its team page opened right here (built only while open): Edit and Delete in its card, its games inside.
        page={{
          id: t.id,
          content: openTeams.has(t.id) ? (
            <LeagueTeamView
              id={t.id}
              embedded
              edit={
                <>
                  {t.canEdit && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <TeamEditor grades={GRADE_CHOICES} team={t} />
                      <DeleteTeam id={t.id} name={t.name} />
                    </div>
                  )}
                  {director && (plays[t.id] ?? []).length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <PlayInTeam teamId={t.id} leagues={plays[t.id]} />
                    </div>
                  )}
                </>
              }
            />
          ) : null,
        }}
        lead={
          (staff[t.id] ?? []).length > 0 && (
            <GroupTextButton small cells={(staff[t.id] ?? []).map((s) => s.cell)} label={`Text coaches (${(staff[t.id] ?? []).length})`} />
          )
        }
        people={(staff[t.id] ?? []).map((s) => (
          <ContactChip
            key={`${s.role}-${s.coachId ?? s.last}`}
            person={{ role: s.role, email: s.email, first: s.first, last: s.last, cell: s.cell, verified: s.verified }}
            about={t.name}
            extra={viewAs && s.coachId ? <ViewAsButton coachId={s.coachId} name={`${s.first} ${s.last}`} /> : undefined}
          />
        ))}
      />
    );
  };

  const groupList = (view: "division" | "org") => (
    <div className="grid gap-4">
      {groupsFor(view).map((g) => (
            <GroupCard
              key={g.title}
              title={g.title}
              count={g.teams.length}
              gender={g.gender}
              defaultOpen={false}
              // A team still missing something (coach cell or email, or a registered team's roster): flash it to drill down.
              alert={g.teams.some((t) => t.waitingCoach || (!!t.coachId && !t.coachEmail) || t.players === 0 || dups.has(t.id))}
            >
              {view === "division"
                ? // Inside a division: by Level (COMP, then REC), then by Grade, each with its own heading.
                  ["COMP", "REC", ...new Set(g.teams.map((t) => t.level).filter((l) => l !== "COMP" && l !== "REC"))]
                    .flatMap((level) =>
                      [...new Set(g.teams.filter((t) => t.level === level).map((t) => t.grade))]
                        .sort((a, b) => a - b)
                        .map((grade) => ({ level, grade, teams: g.teams.filter((t) => t.level === level && t.grade === grade) })),
                    )
                    .flatMap((s) => [
                      <li
                        key={`h-${s.level}-${s.grade}`}
                        className="bg-zinc-50 px-4 py-1.5 text-xs font-semibold tracking-wide text-zinc-500 uppercase dark:bg-white/5"
                      >
                        {s.level} · {s.teams[0].gradeLabel.split("/").pop()} grade
                      </li>,
                      ...s.teams.map(row),
                    ])
                : [...new Set(g.teams.map((t) => `${t.gender} · ${divisionOf(t)}`))].flatMap((sub) => [
                    <li
                      key={`h-${sub}`}
                      className="bg-zinc-50 px-4 py-1.5 text-xs font-semibold tracking-wide text-zinc-500 uppercase dark:bg-white/5"
                    >
                      {sub}
                    </li>,
                    ...g.teams.filter((t) => `${t.gender} · ${divisionOf(t)}` === sub).map(row),
                  ])}
            </GroupCard>
          ))}
        </div>
  );

  return (
    <>
      {!embedded && <AppHeader user={user} context={scenic.key} tab="scenic-teams" />}
      <PageFrame embedded={embedded} className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 lg:max-w-6xl">
        {/* The same as every Teams page: + (Add a team, Import teams) opens right under the title. */}
        <PageMenus
          slot={embedded ? "card-slot-teams" : undefined}
          title={<PageTitle title={`Teams (${teams.length})`} subtitle={SUBTITLE[scenic.role]} />}
          extra={
            <>
              {!director && data.addFor.length > 0 && <TeamEditor addFor={data.addFor} grades={GRADE_CHOICES} />}
            </>
          }
          menus={
            director
              ? [
                  // FastBreak (Directors of Teams): its teams, grouped by FastBreak organization, opened right here.
                  ...(imports
                    ? [
                        {
                          key: "fastbreak",
                          icon: <span className="text-sm font-semibold">FastBreak</span>,
                          label: "FastBreak teams",
                          className:
                            "rounded-full px-3 py-1.5 text-zinc-700 ring-1 ring-zinc-950/10 hover:bg-zinc-50 dark:text-zinc-200 dark:ring-white/15",
                          items: [],
                          panel: <FastbreakList />,
                        },
                      ]
                    : []),
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
                            people={people}
                            clubs={clubs.map((c) => ({ value: c.id, label: c.name, abbr: c.abbr }))}
                            create={addClubTeam}
                            preK
                          />
                        ),
                      },
                      {
                        key: "import",
                        label: "⇪ Import teams",
                        panel: (
                          <ImportTeamsPanel
                            preview={previewClubImport}
                            named
                            nameLabel="Organization"
                            add={importClubTeams}
                            example={
                              "Organization,Gender,Grade,Level,Coach First,Coach Last,Coach Cell,Alternate Name\nHixson Hoops,Boys,5th,REC,Sam,Lee,423-555-0101,Bolts\nHixson Hoops,Girls,3rd/4th,COMP,,,,"
                            }
                            help="Teams for outside clubs (organizations not on CourtCaptain), one per row with its Organization, Gender, Grade and Level (REC or COMP), and if you have them the Head Coach's name, cell and email and an Alternate name, in any order. A coach without a cell is fine: Edit the team later to add it. A new club is added with its initials as its Abbreviation. Each team is named with the club's Abbreviation, grade, gender and Head Coach (like HH 5B Lee; HH 5B TBD until a coach). Organizations on CourtCaptain add their own teams. Paste from a spreadsheet or choose a CSV file. Next you'll check which column is which, then see exactly what will be added (we clean up things like 3 & 4 or R)."
                          />
                        ),
                      },
                    ],
                  },
                ]
              : []
          }
        />
        {/* Standard emails (an organization that runs Leagues; who may send each is checked on the server). */}
        {director && (
          <div className="mb-3">
            <SubCard title="Standard emails" count={2}>
              <StandardEmails org="scenic-city" />
            </SubCard>
          </div>
        )}
        {/* Which program: current and upcoming first, then past ones (ended), then teams not registered now. */}
        <nav aria-label="Programs" className="mb-3 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
          {[...data.programs.map((p) => ({ key: p.id, label: p.ended ? `${p.name} · ended` : p.name })), { key: "none", label: "Not registered" }].map(
            (p) => (
              <Link
                key={p.key}
                href={qs(view, p.key)}
                aria-current={program === p.key ? "page" : undefined}
                className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium whitespace-nowrap ${
                  program === p.key
                    ? "bg-thunder-blue text-white"
                    : "text-zinc-600 ring-1 ring-zinc-950/10 hover:bg-zinc-50 dark:text-zinc-300 dark:ring-white/15"
                }`}
              >
                {p.label}
              </Link>
            ),
          )}
        </nav>
        {!teams.length && (
          <p className="text-zinc-500">
            {program === "none"
              ? "Every outside club's and stand-alone team is in a current program."
              : "No teams registered in this program."}
            {director && program === "none" && " Tap “+ Add” (or Import) for an outside club's teams."}
          </p>
        )}
        <TeamViews initial={view} division={groupList("division")} org={groupList("org")} />

        {imports && imports.length > 0 && (
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
                        undo={undoClubImport.bind(null, i.id)}
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

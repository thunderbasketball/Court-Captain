import TeamsIncluded from "../../../TeamsIncluded";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { currentScenic } from "@/lib/contexts-server";
import { db } from "@/lib/db";
import { seesWho } from "@/lib/org-admin";
import { requireFeature } from "@/lib/features-server";
import { formatCell } from "@/lib/phone";
import { MustBeEntered } from "../../../TeamRow";
import { HeadCoachEmailButton } from "../../../CoachContactTools";
import { listClubImports, outsideClubs, scenicCoachOptions } from "@/lib/scenic-club-teams";
import { scheduledGames } from "@/lib/scenic-games";
import { STAFF_ROLES, teamStaff } from "@/lib/team-signup";
import { easternDate } from "@/lib/time";
import { LeagueGames } from "../../../LeagueGames";
import { GRADE_CHOICES, gradeRange, listScenicTeams, type ScenicTeam } from "@/lib/scenic-teams";
import { TZ } from "@/lib/time";
import AppHeader from "../../../AppHeader";
import { AddTeamPanel } from "../../../AddTeam";
import PageMenus, { PLUS_BTN, PlusIcon } from "../../../PageMenus";
import { ImportTeamsPanel, UndoImportButton } from "../../../TeamImport";
import { CollapseCard, GroupCard, PageTitle, PhoneLink, TeamName } from "../../../ui";
import { DeleteTeam, TeamEditor } from "./TeamEditor";
import { addClubTeam, importClubTeams, previewClubImport, undoClubImport } from "../actions";

import { PageFrame } from "../../../ui";
import { hasFeature } from "@/lib/features";

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
  const qs = (v: string, p: string) => {
    const x = new URLSearchParams();
    if (v === "org") x.set("view", "org");
    x.set("program", p);
    return `/org/scenic-city/teams?${x}`;
  };
  const teams = [...data.teams].sort(byTeam);
  // Each team's League games (opponent, time and gym once scheduled), on its card.
  const allGames = await scheduledGames(
    db,
    teams.map((t) => t.id),
  );
  // Only this program's games on each card.
  const games = Object.fromEntries(
    Object.entries(allGames).map(([id, gs]) => [id, program === "none" ? [] : gs.filter((g) => g.programId === program)]),
  );
  // Assistant Coach, Manager, Team Parent (from team registration).
  const staff = await teamStaff(
    db,
    teams.map((t) => t.id),
  );
  const today = easternDate(new Date());
  const director = scenic.role === "Director";
  const who = await seesWho(db, user, "scenic-city"); // Owners and Admins see who did it
  const [clubs, people, imports] = director
    ? await Promise.all([outsideClubs(db), scenicCoachOptions(db), listClubImports(deps, user)])
    : [[], [], null];
  const when = (d: Date) =>
    d.toLocaleString("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  // By division: a heading per gender, a card per division. By organization: a card per organization, with
  // "Boys · K–1st" lines inside.
  const groups =
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

  const row = (t: ScenicTeam) => (
    <li key={t.id} className="flex items-start justify-between gap-3 px-4 py-3">
      <div className="min-w-0 text-sm">
        <p className="font-semibold">
          <TeamName name={t.name} />
          {t.altName && <span className="font-normal text-zinc-500"> · {t.altName}</span>}{" "}
          <span className="font-normal text-zinc-500">
            · {t.gradeLabel} · {t.level}
          </span>
        </p>
        {view === "division" && <p className="text-zinc-600 dark:text-zinc-300">{orgOf(t)}</p>}
        {t.coachCell ? (
          <p>
            Coach {t.coachFirst} {t.coachLast} · <PhoneLink cell={t.coachCell} label={formatCell(t.coachCell)} />
          </p>
        ) : t.waitingCoach ? (
          // Imported with first and last name only: Edit adds their cell (their login).
          <p>
            Coach {t.coachFirst} {t.coachLast} <span className="text-zinc-400">· no cell yet</span>
          </p>
        ) : (
          <MustBeEntered what="COACH INFO" />
        )}
        {(staff[t.id] ?? []).map((s) => (
          <p key={s.role}>
            {STAFF_ROLES.find((r) => r.key === s.role)?.label} {s.first} {s.last} ·{" "}
            <PhoneLink cell={s.cell} label={formatCell(s.cell)} />
          </p>
        ))}
        {t.waitingCoach && <MustBeEntered what="COACH CELL" />}
        {(t.waitingCoach || (t.coachId && !t.coachEmail)) && (
          <span className="flex items-center gap-2">
            <MustBeEntered what="COACH EMAIL" />
            {t.canEdit && t.coachId && !t.coachEmail && (
              <HeadCoachEmailButton org="scenic-city" teamId={t.id} name={`${t.coachFirst} ${t.coachLast}`} />
            )}
          </span>
        )}
        <LeagueGames games={games[t.id] ?? []} today={today} />
        {who && (
          <p className="text-xs text-zinc-500">
            Added by {t.createdBy}
            {t.updatedBy !== t.createdBy && ` · last changed by ${t.updatedBy}`}
          </p>
        )}
      </div>
      {t.canEdit && (
        <div className="flex shrink-0 gap-2">
          <TeamEditor grades={GRADE_CHOICES} team={t} />
          <DeleteTeam id={t.id} name={t.name} />
        </div>
      )}
    </li>
  );

  return (
    <>
      {!embedded && <AppHeader user={user} context={scenic.key} tab="scenic-teams" />}
      <PageFrame embedded={embedded} className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        {/* The same as every Teams page: + (Add a team, Import teams) opens right under the title. */}
        <PageMenus
          slot={embedded ? "card-slot-teams" : undefined}
          title={<PageTitle title={`Teams (${teams.length})`} subtitle={SUBTITLE[scenic.role]} />}
          extra={
            <>
              {director && imports && ( // Directors of Teams
                <Link
                  href="/org/scenic-city/teams/fastbreak"
                  className="rounded-full px-3 py-1.5 text-sm font-semibold text-zinc-700 ring-1 ring-zinc-950/10 hover:bg-zinc-50 dark:text-zinc-200 dark:ring-white/15"
                >
                  FastBreak
                </Link>
              )}
              {!director && data.addFor.length > 0 && <TeamEditor addFor={data.addFor} grades={GRADE_CHOICES} />}
            </>
          }
          menus={
            director
              ? [
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
        <nav aria-label="Team views" className="mb-4 flex gap-2">
          {(
            [
              ["division", "By division"],
              ["org", "By organization"],
            ] as const
          ).map(([k, label]) => (
            <Link
              key={k}
              href={qs(k, program)}
              aria-current={view === k ? "page" : undefined}
              className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                view === k
                  ? "bg-scenic-navy text-white dark:bg-white dark:text-zinc-900"
                  : "text-zinc-600 ring-1 ring-zinc-950/10 hover:bg-zinc-50 dark:text-zinc-300 dark:ring-white/15"
              }`}
            >
              {label}
            </Link>
          ))}
        </nav>

        {!teams.length && (
          <p className="text-zinc-500">
            {program === "none"
              ? "Every outside club's and stand-alone team is in a current program."
              : "No teams registered in this program."}
            {director && program === "none" && " Tap “+ Add” (or Import) for an outside club's teams."}
          </p>
        )}
        <div className="grid gap-4">
          {groups.map((g) => (
            <GroupCard key={g.title} title={g.title} count={g.teams.length} gender={g.gender}>
              {view === "division"
                ? g.teams.map(row)
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

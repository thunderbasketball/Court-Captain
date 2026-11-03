import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { currentScenic } from "@/lib/contexts-server";
import { db } from "@/lib/db";
import { requireFeature } from "@/lib/features-server";
import { formatCell } from "@/lib/phone";
import { listClubImports, outsideClubs, scenicCoachOptions } from "@/lib/scenic-club-teams";
import { GRADE_CHOICES, gradeRange, listScenicTeams, type ScenicTeam } from "@/lib/scenic-teams";
import { TZ } from "@/lib/time";
import AppHeader from "../../../AppHeader";
import AddTeamButton from "../../../AddTeam";
import { ImportTeamsButton, UndoImportButton } from "../../../TeamImport";
import { GroupCard, PageTitle, PhoneLink, card } from "../../../ui";
import { DeleteTeam, TeamEditor } from "./TeamEditor";
import { addClubTeam, importClubTeams, previewClubImport, undoClubImport } from "../actions";

export default function ScenicTeamsPage({ searchParams }: PageProps<"/org/scenic-city/teams">) {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <ScenicTeams searchParams={searchParams} />
    </Suspense>
  );
}

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
  a.gender.localeCompare(b.gender) ||
  (a.divisionLow ?? NO_DIVISION) - (b.divisionLow ?? NO_DIVISION) ||
  a.grade - b.grade ||
  a.gradeLow - b.gradeLow ||
  a.level.localeCompare(b.level) ||
  a.name.localeCompare(b.name);

// Scenic City teams (SPEC.md section 13), as the chip in use sees them, in two views: By division (Gender → Division →
// Grade → Level → Name) and By organization (Organization → Gender → Division → Grade → Level → Name). A Director of
// Teams adds outside clubs' teams (+ Add, Import); organizations on CourtCaptain add and register their own.
async function ScenicTeams({ searchParams }: { searchParams: PageProps<"/org/scenic-city/teams">["searchParams"] }) {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  await requireFeature("scenic-city", "team-registration");
  const scenic = await currentScenic(user);
  if (!scenic) redirect("/");
  const deps = { pool: db, now: () => new Date() };
  const data = await listScenicTeams(deps, user, scenic.role);
  if (!data) redirect("/org/scenic-city");
  const view = (await searchParams).view === "org" ? "org" : "division";
  const teams = [...data.teams].sort(byTeam);
  const director = scenic.role === "Director";
  const [clubs, people, imports] = director
    ? await Promise.all([outsideClubs(db), scenicCoachOptions(db), listClubImports(deps, user)])
    : [[], [], null];
  const when = (d: Date) =>
    d.toLocaleString("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  // By division: a heading per gender, a card per division. By organization: a card per organization, with
  // "Boys · K–1st" lines inside.
  const groups =
    view === "division"
      ? ["Boys", "Girls"].flatMap((g) =>
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
          {t.name}
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
        ) : (
          <p className="font-semibold text-red-600 motion-safe:animate-pulse dark:text-red-400">COACH INFO MUST BE ENTERED</p>
        )}
        <p className="text-xs text-zinc-500">
          Added by {t.createdBy}
          {t.updatedBy !== t.createdBy && ` · last changed by ${t.updatedBy}`}
        </p>
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
      <AppHeader user={user} context={scenic.key} tab="scenic-teams" />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <div className="flex items-start justify-between gap-3">
          <PageTitle title={`Teams (${teams.length})`} subtitle={SUBTITLE[scenic.role]} />
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {director && (
              <>
                <ImportTeamsButton
                  preview={previewClubImport}
                  named
                  nameLabel="Organization"
                  add={importClubTeams}
                  example={
                    "Organization,Gender,Grade,Level,Coach First,Coach Last,Coach Cell,Alternate Name\nHixson Hoops,Boys,5th,REC,Sam,Lee,423-555-0101,Bolts\nHixson Hoops,Girls,3rd/4th,COMP,,,,"
                  }
                  help="Teams for outside clubs (organizations not on CourtCaptain), one per row with its Organization, Gender, Grade and Level (REC or COMP), and if you have them the Head Coach's name and cell and an Alternate name, in any order. A new club is added with its initials as its Abbreviation. Each team is named with the club's Abbreviation, grade, gender and Head Coach (like HH 5B Lee; HH 5B TBD until a coach). Organizations on CourtCaptain add their own teams. Paste from a spreadsheet or choose a CSV file. Next you'll check which column is which, then see exactly what will be added (we clean up things like 3 & 4 or R)."
                />
                <AddTeamButton
                  people={people}
                  clubs={clubs.map((c) => ({ value: c.id, label: c.name, abbr: c.abbr }))}
                  create={addClubTeam}
                />
              </>
            )}
            {!director && data.addFor.length > 0 && <TeamEditor addFor={data.addFor} grades={GRADE_CHOICES} />}
          </div>
        </div>

        <nav aria-label="Team views" className="mb-4 flex gap-2">
          {(
            [
              ["division", "By division"],
              ["org", "By organization"],
            ] as const
          ).map(([k, label]) => (
            <Link
              key={k}
              href={k === "division" ? "/org/scenic-city/teams" : "/org/scenic-city/teams?view=org"}
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
          <p className="text-zinc-500">No teams yet.{director && " Tap “+ Add” (or Import) for an outside club's teams."}</p>
        )}
        <div className="grid gap-4">
          {groups.map((g) => (
            <GroupCard key={g.title} title={g.title} count={g.teams.length}>
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
          <section className={`${card} mt-4 p-4`}>
            <h2 className="font-semibold">Recent imports</h2>
            <ul className="divide-y divide-zinc-100 dark:divide-white/5">
              {imports.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className={i.undoneBy || !i.left ? "text-zinc-400" : ""}>
                    {when(i.importedAt)} · {i.teams} team{i.teams === 1 ? "" : "s"} · by {i.importedBy}
                    {i.undoneBy ? ` · undone by ${i.undoneBy}` : i.left < i.teams ? ` · ${i.left} still here` : ""}
                  </span>
                  {!i.undoneBy && i.left > 0 && (
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
          </section>
        )}
      </main>
    </>
  );
}

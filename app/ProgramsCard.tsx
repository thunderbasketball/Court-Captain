import { Suspense } from "react";
import Link from "next/link";
import type { SessionUser } from "@/lib/auth/service";
import { db } from "@/lib/db";
import { hasFeature } from "@/lib/features";
import { managesPlayerPrograms, playerProgramFields, seasonSources } from "@/lib/player-programs";
import { orgPrograms, type Program } from "@/lib/programs";
import { isProgramsDirector } from "@/lib/scenic-programs";
import { AddIcon, CardPanel, PanelIcon, iconBtn } from "./CardIcons";
import CardSlot from "./CardSlot";
import { eventWhen } from "./events/format";
import { TZ } from "@/lib/time";
import { GearIcon } from "./OrgSettings";
import { PLUS_BTN } from "./PageMenus";
import { ProgramContent } from "./org/scenic-city/programs/[id]/content";
import NewProgramPanel from "./programs/NewProgramPanel";
import NewSession from "./programs/NewSession";
import { listEventTypes, staffChoices } from "@/lib/events";
import { listGyms } from "@/lib/practice/schedule";
import { hasArea } from "@/lib/org-admin";
import PlayerProgramForm from "./programs/PlayerProgramForm";
import { addsScrimmages, scrimmageChoices, scrimmagesOn, upcomingScrimmages, type Scrimmage, type ScrimmageChoices } from "@/lib/scrimmages";
import { NewScrimmageForm, ScrimmageItem } from "./scrimmages/ScrimmageForms";

const date = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });

const STAGE: Record<Program["stage"], { label: string; cls: string }> = {
  open: { label: "Registration open", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" },
  running: { label: "Under way", cls: "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300" },
  upcoming: { label: "Coming up", cls: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" },
  ended: { label: "Ended", cls: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400" },
};

const Chevron = () => (
  <svg
    viewBox="0 0 20 20"
    fill="currentColor"
    aria-hidden
    className="mt-1 size-5 shrink-0 text-zinc-400 transition-transform [details[open]>summary_&]:rotate-180"
  >
    <path
      fillRule="evenodd"
      d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
      clipRule="evenodd"
    />
  </svg>
);

export async function programCount(org: string) {
  return (await orgPrograms(db, org, new Date())).filter((p) => p.stage !== "ended").length;
}

// A player program's inside: its dates and Sessions (each opening its check-in); `add`: + Session's form (opened right
// here by + Session, for Directors of Events).
function PlayerProgram({
  p,
  add,
  scrimmages,
  addScrimmage,
  scrimChoices,
  org,
}: {
  p: Program;
  add: React.ReactNode;
  scrimmages: Scrimmage[] | null; // null: the organization has no scrimmages (CourtPlayers)
  addScrimmage: React.ReactNode; // + Scrimmage's form (Directors of Teams or Events)
  scrimChoices: ScrimmageChoices | null; // the same people: Edit and Remove on each
  org: string;
}) {
  const addId = `new-session-${p.id}`;
  const scrimId = `new-scrimmage-${p.id}`;
  return (
    <div className="space-y-3 text-sm">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-zinc-500">Registration</dt>
        <dd>
          {date(p.regOpens)} – {p.regCloses ? date(p.regCloses) : "until the season ends"}
        </dd>
        <dt className="text-zinc-500">Season</dt>
        <dd>
          {p.startsOn && p.endsOn ? `${date(p.startsOn)} – ${date(p.endsOn)}` : "Not set"}
          {p.seasonFrom && <span className="text-zinc-500"> · from {p.seasonFrom}</span>}
        </dd>
      </dl>
      <div>
        <div className="relative mb-1 flex items-center justify-between gap-2">
          <p className="font-semibold">Sessions ({p.sessions.length})</p>
          {add && (
            <PanelIcon
              id={addId}
              label="Add a session"
              className="rounded-full px-3 py-1 text-xs font-semibold text-thunder-blue ring-1 ring-thunder-blue/30 dark:text-blue-400"
            >
              + Session
            </PanelIcon>
          )}
        </div>
        {add && (
          <CardPanel id={addId} className="mb-2 rounded-xl bg-zinc-50 p-3 dark:bg-white/5">
            {add}
          </CardPanel>
        )}
        {p.sessions.length ? (
          <ul className="divide-y divide-zinc-100 rounded-lg ring-1 ring-zinc-950/10 dark:divide-white/5 dark:ring-white/10">
            {p.sessions.map((e) => (
              <li key={e.id}>
                <Link href={`/events/${e.id}`} className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-zinc-50 dark:hover:bg-white/5">
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-thunder-blue">{e.name}</span>
                    <span className="block text-xs text-zinc-500">
                      {eventWhen(new Date(e.startsAt))}
                      {(e.signupOpens || e.signupCloses) &&
                        ` · sign-up ${e.signupOpens ? date(e.signupOpens) : "now"} – ${e.signupCloses ? date(e.signupCloses) : "the day"}`}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-zinc-500 tabular-nums">
                    {e.here}/{e.expected} checked in
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-zinc-500">No open gyms or tryouts yet.</p>
        )}
      </div>
      {scrimmages && (
        <div>
          <div className="relative mb-1 flex items-center justify-between gap-2">
            <p className="font-semibold">Scrimmages ({scrimmages.length})</p>
            {addScrimmage && (
              <AddIcon id={scrimId} label="Add a scrimmage" />
            )}
          </div>
          {addScrimmage && (
            <CardPanel id={scrimId} className="mb-2 rounded-xl bg-zinc-50 p-3 dark:bg-white/5">
              {addScrimmage}
            </CardPanel>
          )}
          {scrimmages.length ? (
            // A card per date (the first open), and inside it each place with its games by time and 🖨 Scoresheets for
            // all of them.
            <div className="space-y-2">
              {byDateAndPlace(scrimmages).map((d, i) => (
                <details key={d.date} open={i === 0} className="group overflow-hidden rounded-lg ring-1 ring-zinc-950/10 dark:ring-white/10">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-2 bg-zinc-50 px-3 py-2 font-semibold dark:bg-white/5 [&::-webkit-details-marker]:hidden">
                    <span>
                      {d.label} <span className="font-normal text-zinc-500">({d.count})</span>
                    </span>
                    <span className="text-zinc-400 transition group-open:rotate-180">⌄</span>
                  </summary>
                  {d.places.map((p) => (
                    <div key={p.place} className="border-t border-zinc-100 dark:border-white/5">
                      <div className="flex items-center justify-between gap-2 px-3 pt-2 text-sm">
                        <span className="font-medium">
                          📍 {p.place} <span className="font-normal text-zinc-500">({p.games.length})</span>
                        </span>
                        {scrimChoices && (
                          <a
                            href={`/print/scoresheets?scrimmages=${p.games.map((g) => g.id).join(",")}`}
                            target="_blank"
                            rel="noopener"
                            className="shrink-0 rounded-full px-3 py-1 text-xs font-semibold text-thunder-blue ring-1 ring-thunder-blue/30 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-500/10"
                          >
                            🖨 Scoresheets ({p.games.length})
                          </a>
                        )}
                      </div>
                      <ul className="divide-y divide-zinc-100 dark:divide-white/5">
                        {p.games.map((g) => (
                          <ScrimmageItem key={g.id} org={org} s={g} when={timeOf(new Date(g.startsAt))} choices={scrimChoices} />
                        ))}
                      </ul>
                    </div>
                  ))}
                </details>
              ))}
            </div>
          ) : (
            <p className="text-zinc-500">No scrimmages coming up.</p>
          )}
        </div>
      )}
    </div>
  );
}

const timeOf = (d: Date) => d.toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });

// Scrimmages by date (soonest first), then by place (by name), each place's games by start time.
function byDateAndPlace(list: Scrimmage[]) {
  const days = new Map<string, { date: string; label: string; count: number; places: Map<string, Scrimmage[]> }>();
  for (const g of [...list].sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())) {
    const at = new Date(g.startsAt);
    const date = at.toLocaleDateString("en-CA", { timeZone: TZ });
    const d =
      days.get(date) ??
      days
        .set(date, { date, label: at.toLocaleDateString("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric" }), count: 0, places: new Map() })
        .get(date)!;
    d.count++;
    d.places.set(g.place, [...(d.places.get(g.place) ?? []), g]);
  }
  return [...days.values()].map((d) => ({
    ...d,
    places: [...d.places.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([place, games]) => ({ place, games })),
  }));
}

// The Programs card on Home, the same for every organization with CourtPlayers or CourtTeams: + on its title line (the
// kinds its features allow, for those who manage them) opens the new program's form right in the card; each program
// is a card (logo, kind, name, where it stands, dates, how many registered) that opens right there. A player program
// shows its dates and Sessions, with a gear (top right) to change it; a team program opens all of it (its own gear,
// divisions, teams, schedule), loading in the background.
export default async function ProgramsCard({ org, user }: { org: string; user: SessionUser }) {
  const now = new Date();
  const [programs, players, teamsOn, teamsDirector] = await Promise.all([
    orgPrograms(db, org, now),
    managesPlayerPrograms(db, user, org),
    hasFeature(db, org, "programs"),
    isProgramsDirector(db, user),
  ]);
  // Team programs are made in Scenic City for now (its Directors of Programs); every organization later (step 5).
  const teams = teamsOn && org === "scenic-city" && teamsDirector;
  const sources = players ? await seasonSources(db, now) : [];
  const fields = players
    ? new Map(
        await Promise.all(
          programs.filter((p) => p.takes === "players").map(async (p) => [p.id, await playerProgramFields(db, org, p.id)] as const),
        ),
      )
    : new Map();
  const addId = `new-program-${org}`;
  // + Session (Thunder's sessions have check-in from its registrations; Directors of Events).
  const sessions = players && org === "thunder" && hasArea(user, "events");
  const deps = { pool: db, now: () => now };
  const [people, gyms, types] = sessions
    ? await Promise.all([staffChoices(deps, user), listGyms(deps), listEventTypes(deps)])
    : [[], [], []];
  // Scrimmages (CourtPlayers): each player program's coming ones; + Scrimmage for Directors of Teams or Events.
  const [scrimOn, scrimAdds] = await Promise.all([scrimmagesOn(db, org), addsScrimmages(db, user, org)]);
  const choices = scrimAdds ? await scrimmageChoices(deps, org) : null;
  const scrims = new Map(
    scrimOn
      ? await Promise.all(
          programs.filter((p) => p.takes === "players").map(async (p) => [p.id, await upcomingScrimmages(deps, org, p.id)] as const),
        )
      : [],
  );

  return (
    <div className="space-y-3">
      {(players || teams) && (
        <>
          <CardSlot slot="card-slot-programs">
            <AddIcon id={addId} label="New program" className={PLUS_BTN} />
          </CardSlot>
          <CardPanel id={addId} className="rounded-xl bg-zinc-50 p-3 dark:bg-white/5">
            <NewProgramPanel org={org} players={players} teams={teams} sources={sources} />
          </CardPanel>
        </>
      )}
      {!programs.length && <p className="text-sm text-zinc-500">No programs yet.{(players || teams) && " Tap + to add one."}</p>}
      {programs.map((p) => {
        const s = STAGE[p.stage];
        const who = p.takes === "players" ? "player" : "team";
        const gearId = `program-gear-${p.takes}-${p.id}`;
        const f = fields.get(p.id);
        return (
          <div key={`${p.takes}-${p.id}`} className="relative">
            <details className="overflow-hidden rounded-xl bg-white ring-1 ring-zinc-950/10 dark:bg-zinc-900 dark:ring-white/10">
              <summary className="flex cursor-pointer list-none items-start gap-2 p-4 select-none [&::-webkit-details-marker]:hidden">
                <div className={`min-w-0 flex-1 ${f ? "pr-10" : ""}`}>
                  <div className="flex min-w-0 items-center gap-3">
                    {p.logo && (
                      // eslint-disable-next-line @next/next/no-img-element -- the program's own logo, served by the app
                      <img src={p.logo} alt="" className="size-10 shrink-0 rounded-xl object-contain" />
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                        {p.kind} · {p.takes === "players" ? "players register" : "teams register"}
                      </p>
                      <h3 className="font-semibold">{p.name}</h3>
                    </div>
                  </div>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${s.cls}`}>{s.label}</span>
                    {p.startsOn && p.endsOn && (
                      <span>
                        {date(p.startsOn)} – {date(p.endsOn)}
                      </span>
                    )}
                    <span className="text-zinc-500">
                      · {p.registered} {who}
                      {p.registered === 1 ? "" : "s"}
                    </span>
                  </p>
                </div>
                <Chevron />
              </summary>
              <div className="border-t border-zinc-100 p-3 dark:border-white/5">
                {p.takes === "players" ? (
                  <>
                    {f && (
                      <CardPanel id={gearId} className="mb-3 rounded-xl bg-zinc-50 p-3 dark:bg-white/5">
                        <PlayerProgramForm
                          org={org}
                          program={f}
                          sources={sources}
                          canDelete={p.registered === 0 && p.sessions.length === 0}
                        />
                      </CardPanel>
                    )}
                    <PlayerProgram
                      p={p}
                      add={
                        sessions && (
                          <NewSession
                            programId={p.id}
                            people={people}
                            gyms={gyms.filter((g) => g.active).map((g) => g.name)}
                            types={types}
                          />
                        )
                      }
                      org={org}
                      scrimmages={scrims.get(p.id) ?? null}
                      addScrimmage={choices && <NewScrimmageForm org={org} programId={p.id} choices={choices} panel={`new-scrimmage-${p.id}`} />}
                      scrimChoices={choices}
                    />
                  </>
                ) : org === "scenic-city" ? (
                  <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
                    <ProgramContent params={Promise.resolve({ id: p.id })} embedded />
                  </Suspense>
                ) : (
                  <p className="text-sm text-zinc-500">
                    {date(p.regOpens)} – {p.regCloses ? date(p.regCloses) : "open"} registration
                  </p>
                )}
              </div>
            </details>
            {f && (
              <div className="absolute top-3 right-11">
                <PanelIcon id={gearId} label={`${p.name} settings`} className={iconBtn}>
                  <GearIcon className="size-5" />
                </PanelIcon>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

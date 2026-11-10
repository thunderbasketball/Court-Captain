import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { currentScenic } from "@/lib/contexts-server";
import { db } from "@/lib/db";
import { seesWho } from "@/lib/org-admin";
import { REG_OPTIONS, entryLine, money } from "@/lib/program-options";
import { requireFeature } from "@/lib/features-server";
import { formatCell } from "@/lib/phone";
import { getProgram, listPrograms, recLimit, teamsByDate } from "@/lib/scenic-programs";
import { dayLabel, timeLabel } from "@/lib/time";
import { programSchedule } from "@/lib/public-league";
import { shortDate as shortDay } from "@/lib/program-options";
import AppHeader from "../../../../AppHeader";
import { ProgramsNav } from "../../ScenicNav";
import { CollapseCard, GroupCard, PhoneLink, TeamName, card } from "../../../../ui";
import {
  AddDivision,
  AddPool,
  MoveTeam,
  ProgramLogo,
  ProgramSettings,
  RegisterTeam,
  TeamOffButton,
  RemoveDivision,
  RemovePool,
  TeamMenu,
} from "../ProgramTools";
import ProgramDates from "../ProgramDates";
import { RegisterAllButton } from "../../../../leagues/LeagueButtons";
import { RegBadge } from "../RegBadge";
import { PickAll, PickBox, PickTeams } from "./PickTeams";

export default function ProgramPage({ params }: PageProps<"/org/scenic-city/programs/[id]">) {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <Program params={params} />
    </Suspense>
  );
}

// One program: its dates and fee, registering your teams, and each division's teams (by name).
// Directors of Programs (on the Director chip) edit it, mark Paid, and withdraw any team.
async function Program({ params }: { params: PageProps<"/org/scenic-city/programs/[id]">["params"] }) {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  await requireFeature("scenic-city", "programs");
  const scenic = await currentScenic(user);
  if (!scenic) redirect("/");
  const p = await getProgram({ pool: db, now: () => new Date() }, user, (await params).id);
  if (!p) notFound();
  const manage = p.canManage && scenic.role === "Director";
  const who = await seesWho(db, user, "scenic-city"); // Owners and Admins see who did it
  const schedule = p.canSchedule && scenic.role === "Director";
  const pick = schedule || manage;
  const rec = manage ? await recLimit(db, p.id) : null; // REC open to (the gear)
  // The Scheduler opens on this program: Directors of Scheduling, for a League that hasn't ended.
  const scheduler = schedule && p.kind === "League" && p.endsOn >= p.today; // check boxes by teams, for one action on many
  // Other programs with divisions, to copy from when adding divisions.
  const others = manage
    ? ((await listPrograms({ pool: db, now: () => new Date() }, user))?.programs ?? [])
        .filter((o) => o.id !== p.id && o.divisions > 0)
        .map((o) => ({ id: o.id, name: o.name, divisions: o.divisions }))
    : [];
  const games = p.kind === "League" ? await programSchedule(db, p.id) : []; // the Schedule card
  const fee = p.feeCents === null ? null : `$${(p.feeCents / 100).toFixed(2)}`;
  // Paid / Unpaid (Directors of Programs, when the program charges): set in each team's ⋯ menu; unpaid shows behind the team.
  const charges = manage && (!!fee || p.options.length > 0);
  const unpaid = (t: { paid: boolean; removedBy: string | null }) => charges && !t.paid && !t.removedBy;
  const shown = manage ? p.divisionList : p.divisionList.filter((d) => d.teams);
  // A League's Game Days with their teams, then the Brackets (lib: teamsByDate, shared with the Scheduler).
  const byDate = teamsByDate(p).map((e) => ({
    ...e,
    title: e.bracket ? `Brackets · ${p.bracketDates.map(shortDay).join(", ")}` : dayLabel(e.date),
  }));
  // Grades accepted: Coed (Pre-K REC: its division on or off), then Boys and Girls, REC and COMP, each grade in that
  // gender's divisions, on when it has a group.
  const preK = p.divisionList.find((d) => d.gender === "Coed")?.groups.find((g) => g.grade === -1 && g.level === "REC");
  const coedRow = {
    gender: "Coed" as const,
    level: "REC" as const,
    grades: [{ grade: -1, on: !!preK, teams: preK ? preK.pools.reduce((n, o) => n + o.teams.length, 0) : 0 }],
  };
  const gradeRows = [coedRow, ...(["Boys", "Girls"] as const).flatMap((gender) =>
    (["REC", "COMP"] as const).map((level) => ({
      gender,
      level,
      grades: p.divisionList
        .filter((d) => d.gender === gender)
        .flatMap((d) =>
          Array.from({ length: d.gradeHigh - d.gradeLow + 1 }, (_, i) => {
            const g = d.groups.find((x) => x.grade === d.gradeLow + i && x.level === level);
            return {
              grade: d.gradeLow + i,
              on: !!g,
              teams: g ? g.pools.reduce((n, o) => n + o.teams.length, 0) : 0,
            };
          }))
        .sort((a, b) => a.grade - b.grade),
    })),
  )];
  const nextDate = byDate.find((d) => d.date >= p.today)?.key;

  return (
    <>
      <AppHeader user={user} context={scenic.key} tab="programs" />
      <main className="mx-auto w-full max-w-3xl flex-1 space-y-4 px-4 py-6">
        <ProgramsNav current={p.id} />
        <section className={`${card} p-4`}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <ProgramLogo src={p.logo} className="size-14" />
            <div className="min-w-0">
              <p className="text-xs font-semibold tracking-wide text-scenic-navy uppercase dark:text-zinc-300">{p.kind}</p>
              <h1 className="text-xl font-semibold tracking-tight">{p.name}</h1>
            </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <RegBadge status={p.status} />
              {/* The gear, top right: Edit, Logo, Delete (Directors of Programs). */}
              {manage && (
                <ProgramSettings
                  program={p}
                  logo={p.logo}
                  teams={p.teams}
                  grades={p.divisionList.length ? gradeRows : null}
                  rec={{ ...rec!, by: who ? rec!.by : null }}
                />
              )}
            </div>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <dt className="text-zinc-500">Season</dt>
            <dd>
              {dayLabel(p.startsOn)} – {dayLabel(p.endsOn)}
            </dd>
            <dt className="text-zinc-500">Registration</dt>
            <dd>
              {dayLabel(p.regOpens)} – {dayLabel(p.regCloses)}
            </dd>
            {p.kind === "League" && p.options.length > 0 ? (
              <>
                <dt className="text-zinc-500">Options</dt>
                <dd>
                  <ul>
                    {p.options.map((o) => {
                      const def = REG_OPTIONS.find((x) => x.key === o.kind)!;
                      return (
                        <li key={o.kind}>
                          {p.name} ({def.name})
                          <span className="text-zinc-500">
                            {o.feeCents !== null ? ` · ${money(o.feeCents)} ${def.perDate ? "per date" : "per team"}` : ""}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  <span className="text-xs text-zinc-500">Paid outside the app for now</span>
                </dd>
              </>
            ) : (
              fee && (
                <>
                  <dt className="text-zinc-500">Fee</dt>
                  <dd>{fee} per team (paid outside the app for now)</dd>
                </>
              )
            )}
            {p.recLimited && (
              <>
                <dt className="text-zinc-500">REC</dt>
                <dd className="text-amber-700 dark:text-amber-300">Invited organizations only</dd>
              </>
            )}
            <dt className="text-zinc-500">Teams</dt>
            <dd>
              {p.teams} in {p.divisionList.length} division{p.divisionList.length === 1 ? "" : "s"}
            </dd>
          </dl>
          {who && (
            <p className="mt-2 text-xs text-zinc-400">
              Created by {p.createdBy}
              {p.updatedBy !== p.createdBy && ` · last changed by ${p.updatedBy}`}
            </p>
          )}
          {(manage || scheduler) && (
            <div className="mt-3 flex items-center gap-2">
              {scheduler && (
                <Link
                  href={`/org/scenic-city/scheduler?program=${p.id}`}
                  className="rounded-full px-3 py-1 text-xs font-medium text-scenic-navy ring-1 ring-scenic-navy/30 hover:bg-zinc-50 dark:text-zinc-200 dark:ring-white/20 dark:hover:bg-white/5"
                >
                  Scheduler
                </Link>
              )}
              {manage && <AddDivision programId={p.id} others={others} />}
            </div>
          )}
        </section>

        {(manage || p.gameDates.length + p.bracketDates.length > 0) && (
          <details className={`${card} group overflow-hidden`} open={manage && !p.gameDates.length}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
              <h2 className="font-semibold">Game &amp; Bracket Days</h2>
              <span className="text-sm text-zinc-500">
                {p.gameDates.length} game date{p.gameDates.length === 1 ? "" : "s"}
                {p.bracketDates.length > 0 && ` · ${p.bracketDates.length} bracket day${p.bracketDates.length === 1 ? "" : "s"}`}
                {p.gameDates.length > 0 && ` · next ${dayLabel(p.gameDates.find((d) => d >= p.today) ?? p.gameDates.at(-1)!)}`}
              </span>
            </summary>
            <div className="border-t border-zinc-100 p-4 dark:border-white/5">
              <ProgramDates
                programId={p.id}
                today={p.today}
                starts={p.startsOn}
                ends={p.endsOn}
                dates={p.gameDates}
                brackets={p.bracketDates}
                editable={manage}
              />
            </div>
          </details>
        )}

        {(p.canRegister.length > 0 || p.cantRegister.length > 0) && (
          <section className={`${card} space-y-2 p-4`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h2 className="font-semibold">Register a team</h2>
              {p.canRegister.length > 1 && (
                <RegisterAllButton
                  org="scenic-city"
                  programId={p.id}
                  program={p.name}
                  count={p.canRegister.length}
                  allSeason={p.kind === "League"}
                />
              )}
            </div>
            {p.canRegister.length > 0 ? (
              <RegisterTeam
                programId={p.id}
                teams={p.canRegister}
                league={p.kind === "League" ? { options: p.options, gameDates: p.gameDates, today: p.today } : null}
              />
            ) : (
              <p className="text-sm text-zinc-500">None of your teams fits a division here.</p>
            )}
            {p.cantRegister.length > 0 && (
              <p className="text-xs text-zinc-500">
                Can&apos;t register: {p.cantRegister.map((t) => `${t.name} (${t.why})`).join(", ")}.
              </p>
            )}
          </section>
        )}

        <PickTeams programId={p.id} canRemove={schedule} canWithdraw={manage}>
          {(["Coed", "Boys", "Girls"] as const).map((gender) => {
            const mine = shown.filter((d) => d.gender === gender);
            if (!mine.length) return null;
            return (
              <section
                key={gender}
                className={`space-y-3 rounded-2xl p-3 ${gender === "Boys" ? "bg-sky-100/70 dark:bg-sky-500/10" : gender === "Coed" ? "bg-lime-100/70 dark:bg-lime-500/10" : "bg-pink-100/70 dark:bg-pink-500/10"}`}
              >
                <h2
                  className={`px-1 text-sm font-semibold tracking-wide uppercase ${gender === "Boys" ? "text-sky-800 dark:text-sky-300" : gender === "Coed" ? "text-lime-800 dark:text-lime-300" : "text-pink-800 dark:text-pink-300"}`}
                >
                  {gender === "Coed" ? "Coed Pre-K" : gender}
                </h2>
                {mine.map((d) => (
                  <GroupCard key={d.id} title={d.label} count={d.teams} defaultOpen={false}>
                    {d.groups
                      .filter((g) => manage || g.pools.some((o) => o.teams.length))
                      .map((g) => (
                        <li key={g.id} className="px-4 py-3">
                          <div className="flex items-center justify-between gap-2">
                            <h3 className="text-sm font-semibold">{g.label}</h3>
                            {manage && <AddPool groupId={g.id} />}
                          </div>
                          <div className="mt-2 grid gap-2">
                            {g.pools
                              .filter((o) => manage || o.teams.length)
                              .map((o) => (
                                <div key={o.id} className="rounded-xl bg-zinc-50 px-3 py-2 dark:bg-zinc-800/50">
                                  <div className="flex items-center justify-between gap-2">
                                    <p className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                                      {o.name} · {o.teams.length} team{o.teams.length === 1 ? "" : "s"}
                                    </p>
                                    {manage && !o.teams.length && g.pools.length > 1 && (
                                      <RemovePool id={o.id} name={o.name} />
                                    )}
                                    {pick && (
                                      <PickAll teams={o.teams.map((t) => ({ id: t.teamId, out: !!t.removedBy }))} />
                                    )}
                                  </div>
                                  <ul className="divide-y divide-zinc-200/70 dark:divide-white/5">
                                    {o.teams.map((t) => (
                                      <li
                                        key={t.teamId}
                                        className={`relative flex items-start justify-between gap-3 py-2 ${
                                          unpaid(t)
                                            ? "-mx-2 overflow-hidden rounded-lg bg-amber-50 px-2 dark:bg-amber-500/10"
                                            : ""
                                        }`}
                                      >
                                        {unpaid(t) && (
                                          // UNPAID in the background (Directors of Programs, when the program charges).
                                          // Scaled to the card's height (collapsed or open).
                                          <svg
                                            aria-hidden
                                            viewBox="0 0 300 62"
                                            preserveAspectRatio="xMidYMid meet"
                                            className="pointer-events-none absolute inset-0 h-full w-full py-1 text-amber-500/10 select-none dark:text-amber-300/[0.08]"
                                          >
                                            <text
                                              x="150"
                                              y="60"
                                              textAnchor="middle"
                                              textLength="296"
                                              lengthAdjust="spacingAndGlyphs"
                                              fontSize="84"
                                              fontWeight="900"
                                              fill="currentColor"
                                            >
                                              UNPAID
                                            </text>
                                          </svg>
                                        )}
                                        {unpaid(t) && <span className="sr-only">Unpaid.</span>}
                                        {pick && <PickBox id={t.teamId} out={!!t.removedBy} name={t.name} />}
                                        {/* Collapsed by default: tap the name to see the coach, dates and who did it. */}
                                        <details
                                          className={`group/team relative min-w-0 flex-1 text-sm ${t.removedBy ? "line-through opacity-50" : ""}`}
                                        >
                                          <summary className="flex cursor-pointer list-none items-start gap-1 font-semibold [&::-webkit-details-marker]:hidden">
                                            <span
                                              aria-hidden
                                              className="mt-0.5 text-xs text-zinc-400 transition group-open/team:rotate-90"
                                            >
                                              ▶
                                            </span>
                                            <span>
                                              <TeamName name={t.name} />
                                              <span className="font-normal text-zinc-500"> ({t.tag})</span>{" "}
                                              <span className="font-normal text-zinc-500">
                                                · {t.gradeLabel} · {t.level}
                                              </span>
                                            </span>
                                          </summary>
                                          <div className="mt-1 pl-4">
                                            {t.coach && t.coachCell ? (
                                              <p>
                                                Coach {t.coach} ·{" "}
                                                <PhoneLink cell={t.coachCell} label={formatCell(t.coachCell)} />
                                              </p>
                                            ) : (
                                              <p className="text-zinc-500">No coach yet</p>
                                            )}
                                            {t.entry && (
                                              <p className="text-zinc-600 dark:text-zinc-300">
                                                {entryLine(t.entry)}
                                                {t.entry.bracket && " · Brackets"}
                                              </p>
                                            )}
                                            <p className="text-xs text-zinc-500">
                                              {who ? `Registered by ${t.registeredBy}` : "Registered"}
                                              {t.movedBy && ` · moved${who ? ` by ${t.movedBy}` : ""}`}
                                              {manage &&
                                                who &&
                                                t.paidSetBy &&
                                                ` · ${t.paid ? "paid" : "unpaid"} per ${t.paidSetBy}`}
                                              {t.removedBy && ` · sitting out${who ? ` (by ${t.removedBy})` : ""}`}
                                            </p>
                                          </div>
                                        </details>
                                        <div className="flex shrink-0 flex-col items-end gap-2">
                                          {manage && g.pools.length > 1 && (
                                            <MoveTeam
                                              programId={p.id}
                                              teamId={t.teamId}
                                              pools={g.pools.filter((x) => x.id !== o.id)}
                                            />
                                          )}
                                          <TeamMenu
                                            programId={p.id}
                                            teamId={t.teamId}
                                            name={t.name}
                                            canSitOut={schedule}
                                            out={!!t.removedBy}
                                            canWithdraw={t.canWithdraw}
                                            paid={charges ? t.paid : null}
                                          />
                                        </div>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              ))}
                          </div>
                        </li>
                      ))}
                    {manage && !d.teams && (
                      <li className="flex justify-end px-4 py-3">
                        <RemoveDivision id={d.id} label={d.label} />
                      </li>
                    )}
                  </GroupCard>
                ))}
              </section>
            );
          })}
        </PickTeams>
        {!shown.length && <p className="text-zinc-500">{manage ? "No divisions yet." : "No teams registered yet."}</p>}

        {byDate.length > 0 && (
          <section className={`${card} overflow-hidden`}>
            <h2 className="px-4 pt-4 font-semibold">Teams by date</h2>
            <p className="px-4 pb-2 text-xs text-zinc-500">
              Each Game Day&apos;s teams with games guaranteed (1GG/2GG), then the teams in the Brackets.
            </p>
            <div className="divide-y divide-zinc-100 border-t border-zinc-100 dark:divide-white/5 dark:border-white/5">
              {byDate.map((d) => (
                <details key={d.key} className="group" open={d.key === nextDate}>
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 [&::-webkit-details-marker]:hidden">
                    <span className={`text-sm font-semibold ${d.bracket ? "text-violet-800 dark:text-violet-300" : ""}`}>
                      {d.title}
                      {d.bracket && (
                        <span className="block text-xs font-normal text-zinc-500">One event: teams play until they lose</span>
                      )}
                    </span>
                    <span className="shrink-0 text-xs text-zinc-500">
                      {d.playing} team{d.playing === 1 ? "" : "s"}
                      {d.games > 0 && ` · ${d.games} game${d.games === 1 ? "" : "s"} guaranteed`}
                    </span>
                  </summary>
                  {d.teams.length ? (
                    <ul className="space-y-1 px-4 pb-3 text-sm">
                      {d.teams.map((t) => (
                        <li key={t.teamId} className="flex items-center justify-between gap-3">
                          <span className={`min-w-0 ${t.removedBy || t.out ? "text-zinc-400 line-through" : ""}`}>
                            <TeamName name={t.name} className="font-medium" />
                            <span className="text-xs text-zinc-500"> ({t.tag})</span>{" "}
                            <span className="text-xs text-zinc-500">{t.division}</span>
                          </span>
                          <span
                            className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                              t.note === "2GG"
                                ? "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
                                : t.note === "Bracket"
                                  ? "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300"
                                  : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                            }`}
                          >
                            {t.note}
                          </span>
                          {schedule && !t.removedBy && (
                            <TeamOffButton
                              programId={p.id}
                              teamId={t.teamId}
                              name={t.name}
                              what={d.bracket ? "brackets" : d.date}
                              label={d.bracket ? "the Brackets" : dayLabel(d.date)}
                              out={!!t.out}
                            />
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="px-4 pb-3 text-sm text-zinc-500">No teams yet.</p>
                  )}
                </details>
              ))}
            </div>
          </section>
        )}
        {/* Its games by day (any time, past programs too; the public page shows them once published). */}
        {p.kind === "League" && (
          <div className="mt-4">
            <CollapseCard title="Schedule" count={games.reduce((n, d) => n + d.games.length, 0)}>
              {games.length ? (
                <div className="space-y-3 px-4 pb-4">
                  {games.map((d) => (
                    <div key={d.date}>
                      <h3 className="mb-1 text-sm font-semibold">{dayLabel(d.date)}</h3>
                      <ul className="divide-y divide-zinc-100 rounded-xl bg-zinc-50 px-3 text-sm dark:divide-white/5 dark:bg-white/5">
                        {d.games.map((g, i) => (
                          <li key={i} className={`flex gap-3 py-1.5 ${d.date < p.today ? "opacity-60" : ""}`}>
                            <span className="w-16 shrink-0 text-zinc-500">{g.starts ? timeLabel(g.starts) : "TBD"}</span>
                            <span className="min-w-0">
                              <TeamName name={g.away} /> <span className="text-zinc-400">at</span> <TeamName name={g.home} />
                              <span className="block text-xs text-zinc-500">
                                {g.group}
                                {g.gym && ` · ${g.gym}`}
                                {g.court && ` · ${g.court}`}
                              </span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="px-4 pb-4 text-sm text-zinc-500">No games yet.</p>
              )}
            </CollapseCard>
          </div>
        )}
      </main>
    </>
  );
}

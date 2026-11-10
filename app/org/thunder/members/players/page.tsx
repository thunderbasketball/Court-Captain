import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { hasFeature } from "@/lib/features";
import { requireFeature } from "@/lib/features-server";
import { db } from "@/lib/db";
import { gradeLabel } from "@/lib/grades";
import { schoolYearOf } from "@/lib/eligibility";
import { orgGradeRules } from "@/lib/grade-rules";
import EligibleChip from "../../../../EligibleChip";
import { hasArea, seesWho } from "@/lib/org-admin";
import { formatCell } from "@/lib/phone";
import { easternDate } from "@/lib/time";
import { listPlayersByGrade, type MemberPlayer } from "@/lib/players";
import AppHeader from "../../../../AppHeader";
import { AddPlayerButton, RemoveAddedPlayer } from "../../players/AddPlayerButton";
import PlayerEvalButton from "../../players/PlayerEvalButton";
import RosterBoardButton from "../../players/RosterBoardButton";
import { Chip, EmailLink, GroupCard, Notice, PageTitle, PersonRow, PhoneLink, Stats } from "../../../../ui";
import { PlayerTeamButton } from "../../../../ViewAsButton";
import MembersNav from "../MembersNav";

export default function PlayersPage() {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <Players />
    </Suspense>
  );
}

// Thunder is in Eastern time, wherever the server runs.
const when = (d: Date) =>
  d.toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

// Members → Players (Directors of Players or Teams): Boys then Girls by grade (each grade, and each team's roster in it,
// collapsed). In each grade, players not on a team yet come
// first (with the teams interested in them, and Evaluate), then each team's roster. A player on a team of another grade is
// listed with that team, noting their own grade.
async function Players() {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  await requireFeature("thunder", "player-registration");
  if (!hasArea(user, "players", "teams")) redirect("/");
  const { groups, total, boys, girls, importedAt, importedBy, sync } = await listPlayersByGrade(user);
  const evaluations = await hasFeature(db, "thunder", "team-building"); // with Team Management only
  const who = await seesWho(db, user, "thunder"); // Owners and Admins see who did it
  const canAdd = hasArea(user, "players"); // Owners, Admins and Directors of Players add players (fees can be waived)

  const today = easternDate(new Date());
  const schoolYear = schoolYearOf(today);
  const { rules: gradeRules } = await orgGradeRules(db, "thunder", new Date()); // set in the organization's gear
  // "Mar 4, 2017" and how old they are today.
  const birthday = (d: string) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  const ageOn = (d: string, on: string) => {
    const [y, m, dd] = d.split("-").map(Number);
    const [ty, tm, td] = on.split("-").map(Number);
    return ty - y - (tm < m || (tm === m && td < dd) ? 1 : 0);
  };
  const row = (p: MemberPlayer, rostered: boolean) => (
    <PersonRow
      key={p.registrantId}
      first={p.firstName}
      last={p.lastName}
      avatarTone={p.gender === "Boys" ? "blue" : "pink"}
      collapsed
      chips={
        <>
          {/* Birthday on every card; a rostered player's eligibility for their team's grade (age control date). */}
          {p.birthdate && <span className="text-xs whitespace-nowrap text-zinc-400">{birthday(p.birthdate)}</span>}
          {p.teamGrades && <EligibleChip teamGrades={p.teamGrades} grade={p.grade} birthdate={p.birthdate} year={schoolYear} rules={gradeRules} />}
          {p.playsUp && <Chip tone="amber">{p.playsUp}</Chip>}
          {p.addedBy && <Chip tone="zinc">Added in app</Chip>}
          {p.feesWaivedBy && <Chip tone="green">Fees waived</Chip>}
          {p.coachingInterest && <Chip tone="green">Parent: {p.coachingInterest}</Chip>}
          {rostered && <PlayerTeamButton registrantId={p.registrantId} name={`${p.firstName} ${p.lastName}`} />}
        </>
      }
    >
      {/* Opened: the player's details from registration, then their parents. */}
      <p>
        {gradeLabel(p.grade)}
        {p.birthdate && <> · born {birthday(p.birthdate)} (age {ageOn(p.birthdate, today)})</>}
        {p.team && <> · {p.team}</>}
      </p>
      {p.address && <p>{p.address}</p>}
      {(p.uniformSize || p.uniformNumber) && (
        <p>
          Uniform{p.uniformSize && ` size ${p.uniformSize}`}
          {p.uniformNumber && ` · #${p.uniformNumber}`}
        </p>
      )}
      {p.totalFees !== null && (
        <p>
          Fees ${p.totalFees}
          {p.amountRemaining !== null && Number(p.amountRemaining) > 0 ? (
            <span className="font-medium text-red-600 dark:text-red-400"> · ${p.amountRemaining} still owed</span>
          ) : (
            <span className="text-emerald-600 dark:text-emerald-400"> · paid</span>
          )}
        </p>
      )}
      {[
        { name: p.parentName, cell: p.parentCell, email: p.parentEmail },
        { name: p.parent2Name, cell: p.parent2Cell, email: p.parent2Email },
      ]
        .filter((g) => g.name || g.cell || g.email)
        .map((g, i) => (
          <p key={i} className="flex flex-wrap gap-x-2">
            <span className="font-medium text-zinc-700 dark:text-zinc-200">{g.name ?? "Parent"}</span>
            {g.cell && g.cell.length === 10 && <PhoneLink cell={g.cell} label={formatCell(g.cell)} />}
            {g.email && <EmailLink email={g.email} />}
          </p>
        ))}
      {!rostered && p.interestedTeams.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 pt-0.5">
          <span className="text-xs text-zinc-500">Interested:</span>
          {p.interestedTeams.map((t) => (
            <Chip key={t} tone="orange">
              {t}
            </Chip>
          ))}
        </div>
      )}
      {p.addedBy && (
        <div className="flex items-end justify-between gap-2 text-xs text-zinc-500">
          <span>
            {who ? `Added by ${p.addedBy}` : "Added in the app"}
            {who && p.feesWaivedBy && ` · fees waived by ${p.feesWaivedBy}`}
          </span>
          {canAdd && !rostered && <RemoveAddedPlayer registrantId={p.registrantId} name={`${p.firstName} ${p.lastName}`} />}
        </div>
      )}
      {(p.coachRequest || !rostered) && (
        <div className="flex items-end justify-between gap-2">
          <span>{p.coachRequest && <>Coach request: {p.coachRequest}</>}</span>
          {!rostered && evaluations && <PlayerEvalButton registrantId={p.registrantId} name={`${p.firstName} ${p.lastName}`} />}
        </div>
      )}
    </PersonRow>
  );

  return (
    <>
      <AppHeader user={user} tab="members" context="director" />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <MembersNav user={user} current="players" />
        <div className="flex items-start justify-between gap-3">
          <PageTitle
            title="Players"
            subtitle={
              importedAt && (
                <>
                  From TeamSnap (and added in the app), updated {when(importedAt)}
                  {who && ` by ${importedBy}`}
                  {sync?.checkedAt && sync.ok && <> · sheet checked {when(sync.checkedAt)}</>}
                </>
              )
            }
          />
          {canAdd && <AddPlayerButton />}
        </div>
        <Stats
          items={[
            { label: "Players", value: total },
            { label: "Boys", value: boys, tone: "text-blue-600 dark:text-blue-400" },
            { label: "Girls", value: girls, tone: "text-pink-600 dark:text-pink-400" },
          ]}
        />
        {sync && !sync.ok && (
          <Notice tone="red">
            Couldn&apos;t update from the Google Sheet{sync.checkedAt && <> ({when(sync.checkedAt)})</>}: {sync.message}
          </Notice>
        )}
        {!total && <p className="text-zinc-500">No registrations yet.</p>}
        <div className="space-y-3">
          {groups.map((g) => {
            const n = g.unrostered.length + g.teams.reduce((k, t) => k + t.players.length, 0);
            return (
              <GroupCard
                key={`${g.gender}-${g.grade}`}
                title={
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    {g.gender} · {gradeLabel(g.grade)}
                    {g.unrostered.length > 0 && <Chip tone="amber">{g.unrostered.length} not rostered</Chip>}
                  </span>
                }
                count={n}
                defaultOpen={false}
                action={<RosterBoardButton gender={g.gender} grade={g.grade} />}
              >
                {g.unrostered.length > 0 && (
                  <>
                    <li className="bg-zinc-50 px-4 py-1.5 text-xs font-semibold tracking-wide text-zinc-500 uppercase dark:bg-zinc-800/50">
                      Not on a team yet · {g.unrostered.length}
                    </li>
                    {g.unrostered.map((p) => row(p, false))}
                  </>
                )}
                {/* Each team's roster, collapsed: tap the team to open it. */}
                {g.teams.map((t) => (
                  <li key={t.id}>
                    <details className="group/t">
                      <summary className="flex cursor-pointer list-none items-center justify-between bg-orange-50 px-4 py-2 text-xs font-semibold tracking-wide text-orange-800 uppercase dark:bg-orange-500/10 dark:text-orange-300 [&::-webkit-details-marker]:hidden">
                        <span>
                          {t.name} · {t.players.length}
                        </span>
                        <span className="flex items-center gap-2">
                          {/* The team's page (↗), without opening or closing its roster here. */}
                          <Link
                            href={`/org/thunder/teams/${t.id}`}
                            aria-label={`${t.name}: team page`}
                            title="Team page"
                            className="inline-flex size-6 items-center justify-center rounded-full text-orange-800 ring-1 ring-orange-800/25 hover:bg-orange-100 dark:text-orange-300 dark:ring-orange-300/30 dark:hover:bg-orange-500/20"
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden className="size-3.5">
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                              />
                            </svg>
                          </Link>
                          <span className="text-base transition-transform group-open/t:rotate-90">›</span>
                        </span>
                      </summary>
                      <ul className="divide-y divide-zinc-100 dark:divide-white/5">{t.players.map((p) => row(p, true))}</ul>
                    </details>
                  </li>
                ))}
              </GroupCard>
            );
          })}
        </div>
      </main>
    </>
  );
}

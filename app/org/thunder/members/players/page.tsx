import { Suspense } from "react";
import { redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { hasFeature } from "@/lib/features";
import { requireFeature } from "@/lib/features-server";
import { db } from "@/lib/db";
import { gradeLabel } from "@/lib/grades";
import { hasArea } from "@/lib/org-admin";
import { formatCell } from "@/lib/phone";
import { listPlayersByGrade, type MemberPlayer } from "@/lib/players";
import AppHeader from "../../../../AppHeader";
import PlayerEvalButton from "../../players/PlayerEvalButton";
import RosterBoardButton from "../../players/RosterBoardButton";
import { Chip, GroupCard, Notice, PageTitle, PersonRow, PhoneLink, Stats } from "../../../../ui";
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

// Members → Players (Directors of Players or Teams): Boys then Girls by grade. In each grade, players not on a team yet come
// first (with the teams interested in them, and Evaluate), then each team's roster. A player on a team of another grade is
// listed with that team, noting their own grade.
async function Players() {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  await requireFeature("thunder", "player-registration");
  if (!hasArea(user, "players", "teams")) redirect("/");
  const { groups, total, boys, girls, importedAt, importedBy, sync } = await listPlayersByGrade(user);
  const evaluations = await hasFeature(db, "thunder", "team-building"); // with Team Management only

  const row = (p: MemberPlayer, rostered: boolean) => (
    <PersonRow
      key={p.registrantId}
      first={p.firstName}
      last={p.lastName}
      avatarTone={p.gender === "Boys" ? "blue" : "pink"}
      under={rostered && <PlayerTeamButton registrantId={p.registrantId} name={`${p.firstName} ${p.lastName}`} />}
      chips={
        <>
          {p.playsUp && <Chip tone="amber">{p.playsUp}</Chip>}
          {p.coachingInterest && <Chip tone="green">Parent: {p.coachingInterest}</Chip>}
        </>
      }
    >
      <p>
        {p.parentName}
        {p.parentCell && p.parentCell.length === 10 && (
          <>
            {" · "}
            <PhoneLink cell={p.parentCell} label={formatCell(p.parentCell)} />
          </>
        )}
      </p>
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
        <PageTitle
          title="Players"
          subtitle={
            importedAt && (
              <>
                From TeamSnap, updated {when(importedAt)} by {importedBy}
                {sync?.checkedAt && sync.ok && <> · sheet checked {when(sync.checkedAt)}</>}
              </>
            )
          }
        />
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
              <GroupCard key={`${g.gender}-${g.grade}`} title={`${g.gender} · ${gradeLabel(g.grade)}`} count={n}>
                <li className="flex justify-end px-4 py-2">
                  <RosterBoardButton gender={g.gender} grade={g.grade} />
                </li>
                {g.unrostered.length > 0 && (
                  <>
                    <li className="bg-zinc-50 px-4 py-1.5 text-xs font-semibold tracking-wide text-zinc-500 uppercase dark:bg-zinc-800/50">
                      Not on a team yet · {g.unrostered.length}
                    </li>
                    {g.unrostered.map((p) => row(p, false))}
                  </>
                )}
                {g.teams.map((t) => (
                  <li key={t.id}>
                    <p className="bg-orange-50 px-4 py-1.5 text-xs font-semibold tracking-wide text-orange-800 uppercase dark:bg-orange-500/10 dark:text-orange-300">
                      {t.name} · {t.players.length}
                    </p>
                    <ul className="divide-y divide-zinc-100 dark:divide-white/5">{t.players.map((p) => row(p, true))}</ul>
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

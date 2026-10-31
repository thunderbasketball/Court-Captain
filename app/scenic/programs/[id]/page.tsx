import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { currentScenic } from "@/lib/contexts-server";
import { db } from "@/lib/db";
import { requireFeature } from "@/lib/features-server";
import { formatCell } from "@/lib/phone";
import { getProgram } from "@/lib/scenic-programs";
import { dayLabel } from "@/lib/time";
import AppHeader from "../../../AppHeader";
import { GroupCard, PhoneLink, card } from "../../../ui";
import {
  AddDivision,
  AddPool,
  DeleteProgram,
  MoveTeam,
  PaidButton,
  ProgramEditor,
  RegisterTeam,
  RemoveDivision,
  RemovePool,
  WithdrawTeam,
} from "../ProgramTools";
import ProgramDates from "../ProgramDates";
import { RegBadge } from "../RegBadge";

export default function ProgramPage({ params }: PageProps<"/scenic/programs/[id]">) {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <Program params={params} />
    </Suspense>
  );
}

// One program: its dates and fee, registering your teams, and each division's teams (by name).
// Directors of Programs (on the Director chip) edit it, mark Paid, and withdraw any team.
async function Program({ params }: { params: PageProps<"/scenic/programs/[id]">["params"] }) {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  await requireFeature("scenic-city", "programs");
  const scenic = await currentScenic(user);
  if (!scenic) redirect("/");
  const p = await getProgram({ pool: db, now: () => new Date() }, user, (await params).id);
  if (!p) notFound();
  const manage = p.canManage && scenic.role === "Director";
  const fee = p.feeCents === null ? null : `$${(p.feeCents / 100).toFixed(2)}`;
  const shown = manage ? p.divisionList : p.divisionList.filter((d) => d.teams);

  return (
    <>
      <AppHeader user={user} context={scenic.key} tab="programs" />
      <main className="mx-auto w-full max-w-3xl flex-1 space-y-4 px-4 py-6">
        <Link href="/scenic/programs" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
          ← Programs
        </Link>
        <section className={`${card} p-4`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold tracking-wide text-scenic-navy uppercase dark:text-zinc-300">{p.kind}</p>
              <h1 className="text-xl font-semibold tracking-tight">{p.name}</h1>
            </div>
            <RegBadge status={p.status} />
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
            {fee && (
              <>
                <dt className="text-zinc-500">Fee</dt>
                <dd>{fee} per team (paid outside the app for now)</dd>
              </>
            )}
            <dt className="text-zinc-500">Teams</dt>
            <dd>
              {p.teams} in {p.divisionList.length} division{p.divisionList.length === 1 ? "" : "s"}
            </dd>
          </dl>
          <p className="mt-2 text-xs text-zinc-400">
            Created by {p.createdBy}
            {p.updatedBy !== p.createdBy && ` · last changed by ${p.updatedBy}`}
          </p>
          {manage && (
            <div className="mt-3 flex items-center gap-2">
              <ProgramEditor program={p} />
              <DeleteProgram id={p.id} name={p.name} teams={p.teams} />
              <AddDivision programId={p.id} />
            </div>
          )}
        </section>

        {(manage || p.gameDates.length > 0) && (
          <details className={`${card} group overflow-hidden`} open={manage && !p.gameDates.length}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
              <h2 className="font-semibold">Game dates</h2>
              <span className="text-sm text-zinc-500">
                {p.gameDates.length} date{p.gameDates.length === 1 ? "" : "s"}
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
                editable={manage}
              />
            </div>
          </details>
        )}

        {(p.canRegister.length > 0 || p.cantRegister.length > 0) && (
          <section className={`${card} space-y-2 p-4`}>
            <h2 className="font-semibold">Register a team</h2>
            {p.canRegister.length > 0 ? (
              <RegisterTeam programId={p.id} teams={p.canRegister} />
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

        {(["Boys", "Girls"] as const).map((gender) => {
          const mine = shown.filter((d) => d.gender === gender);
          if (!mine.length) return null;
          return (
            <section
              key={gender}
              className={`space-y-3 rounded-2xl p-3 ${gender === "Boys" ? "bg-sky-100/70 dark:bg-sky-500/10" : "bg-pink-100/70 dark:bg-pink-500/10"}`}
            >
              <h2
                className={`px-1 text-sm font-semibold tracking-wide uppercase ${gender === "Boys" ? "text-sky-800 dark:text-sky-300" : "text-pink-800 dark:text-pink-300"}`}
              >
                {gender}
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
                                  {manage && !o.teams.length && g.pools.length > 1 && <RemovePool id={o.id} name={o.name} />}
                                </div>
                                <ul className="divide-y divide-zinc-200/70 dark:divide-white/5">
                                  {o.teams.map((t) => (
                                    <li key={t.teamId} className="flex items-start justify-between gap-3 py-2">
                                      <div className="min-w-0 text-sm">
                                        <p className="font-semibold">
                                          {t.name}{" "}
                                          <span className="font-normal text-zinc-500">
                                            · {t.gradeLabel} · {t.level}
                                          </span>
                                        </p>
                                        <p className="text-zinc-600 dark:text-zinc-300">{t.from}</p>
                                        <p>
                                          Coach {t.coach} · <PhoneLink cell={t.coachCell} label={formatCell(t.coachCell)} />
                                        </p>
                                        <p className="text-xs text-zinc-500">
                                          Registered by {t.registeredBy}
                                          {t.movedBy && ` · moved by ${t.movedBy}`}
                                          {manage && t.paidSetBy && ` · ${t.paid ? "paid" : "unpaid"} per ${t.paidSetBy}`}
                                        </p>
                                      </div>
                                      <div className="flex shrink-0 flex-col items-end gap-2">
                                        {manage && fee ? <PaidButton programId={p.id} teamId={t.teamId} paid={t.paid} /> : null}
                                        {manage && g.pools.length > 1 && (
                                          <MoveTeam
                                            programId={p.id}
                                            teamId={t.teamId}
                                            pools={g.pools.filter((x) => x.id !== o.id)}
                                          />
                                        )}
                                        {t.canWithdraw && <WithdrawTeam programId={p.id} teamId={t.teamId} name={t.name} />}
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
        {!shown.length && <p className="text-zinc-500">{manage ? "No divisions yet." : "No teams registered yet."}</p>}
      </main>
    </>
  );
}

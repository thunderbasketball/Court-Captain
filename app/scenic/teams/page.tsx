import { Suspense } from "react";
import { redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { currentScenic } from "@/lib/contexts-server";
import { db } from "@/lib/db";
import { requireFeature } from "@/lib/features-server";
import { formatCell } from "@/lib/phone";
import { GRADE_CHOICES, gradeLabel, listScenicTeams } from "@/lib/scenic-teams";
import AppHeader from "../../AppHeader";
import { ProgramsNav } from "../ScenicNav";
import { GroupCard, PageTitle, PhoneLink } from "../../ui";
import { DeleteTeam, TeamEditor } from "./TeamEditor";

export default function ScenicTeamsPage() {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <ScenicTeams />
    </Suspense>
  );
}

const SUBTITLE: Record<string, string> = {
  Director: "Every team in Scenic City",
  Partner: "Your partners' teams",
  Solo: "Your own teams",
  Coach: "The teams you coach",
};

// Scenic City teams (SPEC.md section 13, step 6), as the chip in use sees them: Boys then Girls, by grade, then name.
async function ScenicTeams() {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  await requireFeature("scenic-city", "team-registration");
  const scenic = await currentScenic(user);
  if (!scenic) redirect("/");
  const data = await listScenicTeams({ pool: db, now: () => new Date() }, user, scenic.role);
  if (!data) redirect("/scenic");
  const { teams, addFor } = data;
  const group = (t: (typeof teams)[number]) => `${t.gender} · ${gradeLabel(t.grade, t.grade)} · ${t.level}`;
  const groups = [...new Set(teams.map(group))].map((title) => ({ title, teams: teams.filter((t) => group(t) === title) }));

  return (
    <>
      <AppHeader user={user} context={scenic.key} tab="programs" />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <ProgramsNav current="teams" />
        <div className="flex items-start justify-between gap-3">
          <PageTitle title="Teams" subtitle={`${SUBTITLE[scenic.role]} · ${teams.length}`} />
          {addFor.length > 0 && <TeamEditor addFor={addFor} grades={GRADE_CHOICES} />}
        </div>
        {!teams.length && (
          <p className="text-zinc-500">
            No teams yet.{addFor.length > 0 && " Tap “+ Add team”."}
          </p>
        )}
        <div className="grid gap-4">
          {groups.map((g) => (
            <GroupCard key={g.title} title={g.title} count={g.teams.length}>
              {g.teams.map((t) => (
                <li key={t.id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0 text-sm">
                    <p className="font-semibold">
                      {t.name}{" "}
                      <span className="font-normal text-zinc-500">
                        · {t.gradeLabel} · {t.level}
                      </span>
                    </p>
                    <p className="text-zinc-600 dark:text-zinc-300">{t.partnerName ?? `Solo · ${t.ownerName}`}</p>
                    {t.coachCell ? (
                      <p>
                        Coach {t.coachFirst} {t.coachLast} · <PhoneLink cell={t.coachCell} label={formatCell(t.coachCell)} />
                      </p>
                    ) : (
                      <p className="text-zinc-500">No coach yet</p>
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
              ))}
            </GroupCard>
          ))}
        </div>
      </main>
    </>
  );
}

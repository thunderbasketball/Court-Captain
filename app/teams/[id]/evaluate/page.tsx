import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { requireFeature } from "@/lib/features-server";
import { currentContexts } from "@/lib/contexts-server";
import { db } from "@/lib/db";
import { listEvaluations } from "@/lib/evaluations";
import { gradesText } from "@/lib/event-names";
import { getTeam } from "@/lib/teams";
import AppHeader from "../../../AppHeader";
import { PageTitle } from "../../../ui";
import EvalBoard from "./EvalBoard";
import { hasArea } from "@/lib/org-admin";

export default function EvaluatePage({ params }: PageProps<"/teams/[id]/evaluate">) {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <Evaluate params={params} />
    </Suspense>
  );
}

async function Evaluate({ params }: { params: PageProps<"/teams/[id]/evaluate">["params"] }) {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  await requireFeature("thunder", "team-building");
  const { id } = await params;
  const deps = { pool: db, now: () => new Date() };
  const team = await getTeam(deps, user, id);
  if (!team) notFound();
  const cards = await listEvaluations(deps, user, team.id);
  if (!cards) redirect(`/teams/${team.id}`);
  const { active } = await currentContexts(user);
  const asDirector = hasArea(user, "teams") && !(active?.key === `team:${team.id}` && team.myRoles.length > 0);

  return (
    <>
      <AppHeader user={user} tab="teams" context={asDirector ? "director" : `team:${team.id}`} />
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-6">
        <Link href={`/teams/${team.id}`} className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
          ← {team.name}
        </Link>
        <PageTitle
          title="Evaluations"
          subtitle={`${team.gender} in ${gradesText(team.grades)} and one grade below. Only ${team.name}'s coaches and the Director see these ratings.`}
        />
        <EvalBoard teamId={team.id} teamName={team.name} cards={cards} />
      </main>
    </>
  );
}

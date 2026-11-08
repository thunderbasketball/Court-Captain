import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { hasFeature } from "@/lib/features";
import { orgMetadata } from "@/lib/org-metadata";
import { orgInfo } from "@/lib/org-registry";
import { GRADE_CHOICES } from "@/lib/scenic-teams";
import { openPrograms } from "@/lib/team-signup";
import { easternDate } from "@/lib/time";
import OrgLogo from "../../OrgLogo";
import { card } from "../../ui";
import { TeamSignupForm } from "./TeamSignupForm";

export async function generateMetadata({ params }: PageProps<"/register-team/[org]">): Promise<Metadata> {
  return orgMetadata((await params).org);
}

export default function RegisterTeamPage({ params }: PageProps<"/register-team/[org]">) {
  return (
    <main className="mx-auto w-full max-w-md flex-1 px-4 py-10">
      <Suspense fallback={<p className="text-center text-zinc-500">Loading…</p>}>
        <RegisterTeam params={params} />
      </Suspense>
    </main>
  );
}

// Register a team (SPEC.md section 13), no login needed: linked from the organization's login page while it has Team
// Registrations on. Scenic City only (its League teams).
async function RegisterTeam({ params }: { params: PageProps<"/register-team/[org]">["params"] }) {
  const { org } = await params;
  if (org !== "scenic-city" || !(await hasFeature(db, org, "team-registration"))) notFound();
  const o = await orgInfo(db, org);
  if (!o) notFound();
  const programs = await openPrograms(db, new Date());
  return (
    <>
      <div className="mb-6 flex flex-col items-center gap-2 text-center">
        <OrgLogo src={o.bigLogo} name={o.name} color={o.color} className="size-24 rounded-2xl text-4xl" />
        <h1 className="text-xl font-semibold tracking-tight">Register a team</h1>
        <p className="text-sm text-zinc-500">{o.name}</p>
      </div>
      <div className={`${card} p-5`}>
        {programs.length ? (
          <TeamSignupForm grades={GRADE_CHOICES} programs={programs} today={easternDate(new Date())} />
        ) : (
          <p className="text-sm text-zinc-600 dark:text-zinc-300">Team registration isn&apos;t open right now.</p>
        )}
      </div>
      <p className="mt-6 text-center text-sm">
        <Link href={`/login/${org}`} className="text-thunder-blue hover:underline">
          Already registered? Log in
        </Link>
      </p>
    </>
  );
}

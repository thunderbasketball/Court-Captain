import { Suspense } from "react";
import Image from "next/image";
import { notFound, redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { orgInfo } from "@/lib/org-registry";
import { isOrgSlug } from "@/lib/orgs";
import type { Metadata } from "next";
import { orgMetadata } from "@/lib/org-metadata";
import OrgLogo from "../../OrgLogo";
import LoginFlow from "../LoginFlow";
import { card } from "../../ui";
import { followRename } from "@/lib/org-rename";
import { hasFeature } from "@/lib/features";
import Link from "next/link";
import { openPrograms } from "@/lib/team-signup";
import { shortDate } from "@/lib/program-options";
import EventRegister from "./EventRegister";

// The organization's logo as the tab icon (and on a phone's home screen) and its name in the tab title.
export async function generateMetadata({ params }: PageProps<"/login/[org]">): Promise<Metadata> {
  return orgMetadata((await params).org);
}

export default function OrgLoginPage({ params }: PageProps<"/login/[org]">) {
  return (
    <main className="mx-auto w-full max-w-sm flex-1 px-4 py-10">
      <Suspense fallback={<p className="text-center text-zinc-500">Loading…</p>}>
        <OrgLogin params={params} />
      </Suspense>
    </main>
  );
}

// Each organization's own login link (SPEC.md section 14): its logo and name, "Powered by CourtCaptain".
// Logged in → straight into that organization.
async function OrgLogin({ params }: { params: PageProps<"/login/[org]">["params"] }) {
  const { org } = await params;
  await followRename(org, (s) => `/login/${s}`);
  const o = isOrgSlug(org) ? await orgInfo(db, org) : null;
  if (!o) notFound();
  const into = `/switch?org=${org}`;
  if (await currentUser()) redirect(into);
  // Outside teams register here while Team Registrations is on (Scenic City's League teams).
  const teamSignup = org === "scenic-city" && (await hasFeature(db, org, "team-registration"));
  const events = teamSignup
    ? (await openPrograms(db, new Date())).map((p) => ({
        id: p.id,
        name: p.name,
        kind: p.kind,
        dates: `${shortDate(p.startsOn)} – ${shortDate(p.endsOn)}`,
        closes: shortDate(p.regCloses),
        logo: p.logo,
        recLimited: p.recLimited,
      }))
    : [];
  return (
    <>
      <div className="mb-7 flex flex-col items-center gap-2 text-center">
        <OrgLogo src={o.bigLogo} name={o.name} color={o.color} className="size-36 rounded-2xl text-5xl" />
        <h1 className="text-xl font-semibold tracking-tight">{o.name}</h1>
        <p className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">
          Powered by
          <Image src="/brand/courtcaptain-192.png" alt="" width={192} height={128} className="h-4 w-auto" />
          <span className="font-semibold text-thunder-orange">CourtCaptain</span>
        </p>
      </div>
      {devBypass && (
        <p className="mb-6 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-200">
          Testing mode: enter your cell, then code 123456. New numbers become Directors. No emails sent.
        </p>
      )}
      <div className={`${card} p-5`}>
        {/* Thunder asks a new account why they're joining; any other organization's new account logs straight in. */}
        <LoginFlow join={org === "thunder" ? undefined : org} next={into} />
      </div>
      {/* Events open for registration: Register asks one team (CourtSolo) or several (an organization, CourtOrg). */}
      {teamSignup && <EventRegister org={org} events={events} />}
      {/* The public League page: teams and (once published) the schedule, no login. Not needed when a League's card
          above already opens it. */}
      {org === "scenic-city" && !events.some((e) => e.kind === "League") && (await hasFeature(db, org, "programs")) && (
        <Link href={`/league/${org}`} className="mt-4 block text-center text-sm font-medium text-thunder-blue hover:underline">
          League teams &amp; schedule
        </Link>
      )}
    </>
  );
}

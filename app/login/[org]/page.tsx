import { Suspense } from "react";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
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
import { publicPrograms } from "@/lib/public-league";
import { easternDate } from "@/lib/time";
import { shortDate } from "@/lib/program-options";
import PublicPrograms, { type ProgramCard } from "./PublicPrograms";
import { recruitingOn } from "@/lib/officials";
import { ApplyToOfficiate } from "../../officials/ApplyToOfficiate";

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

// Each organization's main page (its login link, SPEC.md section 14): its logo and name, "Powered by CourtCaptain", the
// login box, then what anyone may see (My teams, Programs, Officials). Logged in: the same page, with "Open <name>" in
// place of the login box (the header's logo leads here).
async function OrgLogin({ params }: { params: PageProps<"/login/[org]">["params"] }) {
  const { org } = await params;
  await followRename(org, (s) => `/login/${s}`);
  const o = isOrgSlug(org) ? await orgInfo(db, org) : null;
  if (!o) notFound();
  const into = `/switch?org=${org}`;
  const user = await currentUser();
  // The organization's programs, no login (open for registration, under way, or ended in the last 30 days), the same for
  // every organization: its team programs (Leagues and the like: tap for Teams and Schedule; outside teams register here
  // while Team Registrations is on), then its player programs (seasons).
  const now = new Date();
  const today = easternDate(now);
  const showPrograms = await hasFeature(db, org, "programs");
  const teamSignup = showPrograms && (await hasFeature(db, org, "team-registration"));
  const status = (regCloses: string | null, startsOn: string | null, endsOn: string | null) =>
    regCloses && regCloses >= today
      ? `Register by ${shortDate(regCloses)}`
      : startsOn && startsOn > today
        ? `Starts ${shortDate(startsOn)}`
        : endsOn && endsOn >= today
          ? `Under way · ends ${shortDate(endsOn)}`
          : endsOn
            ? `Ended ${shortDate(endsOn)}`
            : "Under way";
  const seasons: ProgramCard[] = (await hasFeature(db, org, "player-registration")) // CourtPlayers
    ? (
        await db.query<{ id: string; name: string; kind: string; reg_closes: string | null; starts_on: string | null; ends_on: string | null }>(
          `select id::text, name, kind, reg_closes::text, starts_on::text, ends_on::text from player_programs
            where org = $1 and reg_opens <= $2::date and (ends_on is null or ends_on >= $2::date - 30)
            order by starts_on nulls last, lower(name)`,
          [org, today],
        )
      ).rows.map((p) => ({
        id: `p${p.id}`,
        name: p.name,
        kind: p.kind,
        dates: p.starts_on && p.ends_on ? `${shortDate(p.starts_on)} – ${shortDate(p.ends_on)}` : "",
        status: status(p.reg_closes, p.starts_on, p.ends_on),
        logo: null,
        recLimited: false,
        register: false,
        openable: false,
      }))
    : [];
  const programs: ProgramCard[] = showPrograms
    ? (await publicPrograms(db, now, org)).map((p) => ({
        id: p.id,
        name: p.name,
        kind: p.kind,
        dates: `${shortDate(p.startsOn)} – ${shortDate(p.endsOn)}`,
        status: p.registering
          ? `Register by ${shortDate(p.regCloses)}`
          : p.startsOn > today
            ? `Starts ${shortDate(p.startsOn)}`
            : p.endsOn >= today
              ? `Under way · ends ${shortDate(p.endsOn)}`
              : `Ended ${shortDate(p.endsOn)}`,
        logo: p.logo,
        recLimited: p.recLimited,
        register: teamSignup && p.registering,
        openable: true,
      }))
    : [];
  programs.push(...seasons);
  const recruiting = await recruitingOn(db, org);
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
      {devBypass && !user && (
        <p className="mb-6 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-200">
          Testing mode: enter your cell, then code 123456. New numbers become Directors. No emails sent.
        </p>
      )}
      {user ? (
        <div className={`${card} flex items-center justify-between gap-3 p-4`}>
          <p className="min-w-0 text-sm text-zinc-500">
            Logged in as <span className="font-semibold text-zinc-800 dark:text-zinc-100">{user.firstName}</span>
          </p>
          <Link href={into} className="shrink-0 rounded-full bg-thunder-blue px-4 py-2 text-sm font-semibold text-white">
            Open {o.short || o.name} →
          </Link>
        </div>
      ) : (
        <div className={`${card} p-5`}>
          {/* Thunder asks a new account why they're joining; any other organization's new account logs straight in. */}
          <LoginFlow join={org === "thunder" ? undefined : org} next={into} />
        </div>
      )}
      {/* Programs: tap one to see its Teams and (a League's, once published) Schedule; Register while it's open. */}
      <PublicPrograms org={org} programs={programs} />
      {/* Apply to officiate: this organization's (with Accept recruits on) and its officials groups'. */}
      {recruiting.length > 0 && (
        <section className="mt-6 space-y-2">
          <h2 className="px-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase">Officials</h2>
          {recruiting.map((r) => (
            <ApplyToOfficiate key={r.org} org={r.org} name={r.name} />
          ))}
        </section>
      )}
    </>
  );
}

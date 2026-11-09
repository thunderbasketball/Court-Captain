import { Suspense } from "react";
import Image from "next/image";
import Link from "next/link";
import { currentUser } from "@/lib/auth/server";
import { FEATURES, READY_FOR_ANY_ORG } from "@/lib/features";
import { ORG_COLORS, ORG_KINDS } from "@/lib/org-signup";
import LoginFlow from "../login/LoginFlow";
import { card } from "../ui";
import RegisterOrgForm from "./RegisterOrgForm";
import SwitchSolo from "./SwitchSolo";
import { db } from "@/lib/db";
import { myAccounts } from "@/lib/court-solo";
import { easternDate } from "@/lib/time";

export default function RegisterPage({ searchParams }: PageProps<"/register">) {
  return (
    <main className="mx-auto w-full max-w-md flex-1 px-4 py-10">
      <div className="mb-6 flex flex-col items-center gap-2 text-center">
        <Image src="/brand/courtcaptain.png" alt="CourtCaptain" width={768} height={512} priority className="h-auto w-44" />
        <h1 className="text-xl font-semibold tracking-tight">Register your organization</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Schools, clubs and leagues. Live right away; you&apos;ll be its Owner.
        </p>
      </div>
      <Suspense fallback={<p className="text-center text-zinc-500">Loading…</p>}>
        <Register searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

// Registering a new organization on CourtCaptain (SPEC.md section 14). Not logged in: create an account (or log in)
// first, then the form.
async function Register({ searchParams }: { searchParams: PageProps<"/register">["searchParams"] }) {
  const user = await currentUser();
  // "Host games" from Get started arrives with ?need=court-sync ticked; "Register your organization's teams" with court-org.
  const need = (await searchParams).need;
  if (!user)
    return (
      <>
        <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-300">
          First, your own login: enter your cell number. New here? You&apos;ll create an account, then set up the organization.
        </p>
        <div className={`${card} p-5`}>
          <LoginFlow
            join="new-org"
            next={typeof need === "string" && /^[a-z-]+$/.test(need) ? `/register?need=${need}` : "/register"}
          />
        </div>
      </>
    );
  // Multiple teams (CourtOrg) from an event, by someone who already has an organization or a CourtSolo team: ask first.
  const sp = await searchParams;
  if (need === "court-org" && sp.new !== "1") {
    const mine = await myAccounts(db, user.coachId, easternDate(new Date()));
    if (mine.orgs.length || mine.solo.length)
      return (
        <div className={`${card} space-y-3 p-5`}>
          <p className="text-sm text-zinc-600 dark:text-zinc-300">Welcome back, {user.firstName}. What would you like to do?</p>
          {mine.orgs.map((o) => (
            <Link
              key={o.slug}
              href={`/org/${o.slug}/teams`}
              className="block rounded-xl px-3 py-2.5 ring-1 ring-zinc-950/10 hover:bg-zinc-50 dark:ring-white/15 dark:hover:bg-white/5"
            >
              <span className="block font-semibold">Add teams to {o.name}</span>
              <span className="block text-xs text-zinc-500">Its Teams page: add teams and register them.</span>
            </Link>
          ))}
          {mine.solo.map((a) => (
            <SwitchSolo key={a.slug} slug={a.slug} team={a.teamName ?? a.name} />
          ))}
          <Link
            href="/register?need=court-org&new=1"
            className="block rounded-xl px-3 py-2.5 ring-1 ring-zinc-950/10 hover:bg-zinc-50 dark:ring-white/15 dark:hover:bg-white/5"
          >
            <span className="block font-semibold">Create a new organization</span>
            <span className="block text-xs text-zinc-500">A separate organization with its own teams.</span>
          </Link>
        </div>
      );
  }
  const features = FEATURES.filter((f) => f.key !== "alerts").map((f) => ({
    key: f.key,
    name: f.name,
    about: f.about,
    ready: READY_FOR_ANY_ORG.has(f.key),
  }));
  features.sort((a, b) => Number(b.ready) - Number(a.ready));
  const preset = typeof need === "string" && features.some((f) => f.key === need) ? [need] : [];
  return (
    <div className={`${card} p-5`}>
      <p className="mb-4 flex items-center justify-between gap-3 text-sm text-zinc-600 dark:text-zinc-300">
        <span>
          Signed in as {user.firstName} {user.lastName}.
        </span>
        <Link href="/" className="shrink-0 font-medium text-thunder-blue hover:underline">
          ← Back
        </Link>
      </p>
      <RegisterOrgForm kinds={ORG_KINDS} colors={ORG_COLORS} features={features} preset={preset} />
    </div>
  );
}

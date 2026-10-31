import { Suspense } from "react";
import Image from "next/image";
import { notFound, redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { ORGS, ORG_SLUGS, isOrgSlug } from "@/lib/orgs";
import LoginFlow from "../LoginFlow";
import { card } from "../../ui";

export function generateStaticParams() {
  return ORG_SLUGS.map((org) => ({ org }));
}

// Each organization's own login link (SPEC.md section 14): its logo and name, "Powered by CourtCaptain".
// Logged in → straight into that organization.
export default async function OrgLoginPage({ params }: PageProps<"/login/[org]">) {
  const { org } = await params;
  if (!isOrgSlug(org)) notFound();
  const o = ORGS[org];
  const into = `/switch?org=${org}`;
  return (
    <main className="mx-auto w-full max-w-sm flex-1 px-4 py-10">
      <div className="mb-7 flex flex-col items-center gap-2 text-center">
        <Image src={o.bigLogo.src} alt="" width={o.bigLogo.width} height={o.bigLogo.height} priority className="size-36 rounded-2xl" />
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
      <Suspense>
        <AlreadyLoggedIn to={into} />
      </Suspense>
      <div className={`${card} p-5`}>
        {/* Scenic City: a new account logs straight in and goes on to choose Partner or Solo. */}
        <LoginFlow join={org === "scenic-city" ? org : undefined} next={into} />
      </div>
    </main>
  );
}

async function AlreadyLoggedIn({ to }: { to: string }) {
  if (await currentUser()) redirect(to);
  return null;
}

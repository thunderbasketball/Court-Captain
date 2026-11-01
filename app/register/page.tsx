import { Suspense } from "react";
import Image from "next/image";
import Link from "next/link";
import { currentUser } from "@/lib/auth/server";
import { FEATURES, READY_FOR_ANY_ORG } from "@/lib/features";
import { ORG_COLORS, ORG_KINDS } from "@/lib/org-signup";
import LoginFlow from "../login/LoginFlow";
import { card } from "../ui";
import RegisterOrgForm from "./RegisterOrgForm";

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
  if (!user)
    return (
      <>
        <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-300">
          First, your own login: enter your cell number. New here? You&apos;ll create an account, then set up the organization.
        </p>
        <div className={`${card} p-5`}>
          <LoginFlow join="new-org" next="/register" />
        </div>
      </>
    );
  const features = FEATURES.filter((f) => f.key !== "alerts").map((f) => ({
    key: f.key,
    name: f.name,
    about: f.about,
    ready: READY_FOR_ANY_ORG.has(f.key),
  }));
  features.sort((a, b) => Number(b.ready) - Number(a.ready));
  // "Host games" from Get started arrives with ?need=hosting-available ticked.
  const need = (await searchParams).need;
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

import { Suspense } from "react";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import LoginFlow from "./LoginFlow";
import { card } from "../ui";

export default function LoginPage() {
  return (
    <main className="mx-auto w-full max-w-sm flex-1 px-4 py-12">
      <div className="mb-8 flex flex-col items-center gap-3">
        <Image src="/brand/courtcaptain.png" alt="CourtCaptain" width={768} height={512} priority className="h-auto w-60" />
        <h1 className="sr-only">CourtCaptain</h1>
        {/* CourtCaptain itself: no organization named here (each has its own login link). */}
        <Link href="/register" className="text-sm font-medium text-thunder-blue hover:underline">
          Register your organization →
        </Link>
      </div>
      {devBypass && (
        <p className="mb-6 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-200">
          Testing mode: enter your cell, then code 123456. New numbers become Directors. No emails sent.{" "}
          <a href="/dev-login" className="font-semibold underline">
            Skip login →
          </a>
        </p>
      )}
      <Suspense>
        <AlreadyLoggedIn />
      </Suspense>
      <div className={`${card} p-5`}>
        {/* A CourtCaptain account: no organization yet (Get started on the home page), no Thunder request. */}
        <LoginFlow join="courtcaptain" next="/switch?org=courtcaptain" />
      </div>
    </main>
  );
}

async function AlreadyLoggedIn() {
  if (await currentUser()) redirect("/switch?org=courtcaptain");
  return null;
}

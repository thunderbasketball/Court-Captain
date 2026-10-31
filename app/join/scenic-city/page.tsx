import { Suspense } from "react";
import Image from "next/image";
import Link from "next/link";
import { currentUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { joinStatus, partnerOptions } from "@/lib/scenic";
import LoginFlow from "../../login/LoginFlow";
import { card, Notice } from "../../ui";
import JoinForm from "./JoinForm";

// Scenic City's join link (SPEC.md section 13): create an account or log in, then ask to join as a Partner or Solo.
export default function JoinScenicCity() {
  return (
    <main className="mx-auto w-full max-w-sm flex-1 px-4 py-10">
      <div className="mb-6 flex flex-col items-center gap-2 text-center">
        <Image src="/brand/scenic-city-512.png" alt="Scenic City Basketball" width={512} height={512} priority className="size-40 rounded-2xl" />
        <h1 className="text-xl font-semibold tracking-tight">Join Scenic City Basketball</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">For schools and organizations (Partners) and individual teams (Solo).</p>
      </div>
      <Suspense fallback={<p className="text-center text-zinc-500">Loading…</p>}>
        <Join />
      </Suspense>
    </main>
  );
}

async function Join() {
  const user = await currentUser();
  if (!user)
    return (
      <>
        <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-300">
          Enter your cell number. New here? You&apos;ll create an account, then choose Partner or Solo.
        </p>
        <div className={`${card} p-5`}>
          <LoginFlow join="scenic-city" next="/join/scenic-city" />
        </div>
      </>
    );

  const deps = { pool: db, now: () => new Date() };
  const status = await joinStatus(deps, user);
  if (status === "member")
    return (
      <Notice tone="green">
        You&apos;re part of Scenic City.{" "}
        <Link href="/scenic" className="font-semibold underline">
          Go to Scenic City →
        </Link>
      </Notice>
    );
  if (status === "pending") return <Notice tone="green">Request pending. A Scenic City Director will review it.</Notice>;
  return <JoinForm firstName={user.firstName} partners={await partnerOptions(deps)} />;
}

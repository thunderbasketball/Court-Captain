"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { requestJoin } from "../../scenic/actions";
import { Alert } from "../../client-ui";
import { card, primaryBtn } from "../../ui";

// Join Scenic City as Solo (your own team or teams), sent as a request for a Scenic City Admin to approve. Schools and
// organizations create their own organization on CourtCaptain instead (to host games or register teams).
export default function JoinForm({ firstName }: { firstName: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  return (
    <form
      className={`${card} space-y-4 p-5`}
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const r = await requestJoin({ wants: "Solo" });
          if (r.ok) router.refresh();
          else setError(r.message);
        });
      }}
    >
      <p className="text-sm">
        Welcome, <span className="font-semibold">{firstName}</span>.
      </p>
      <div className="rounded-xl p-3 ring-1 ring-zinc-950/10 dark:ring-white/15">
        <p className="font-semibold">Solo</p>
        <p className="text-sm text-zinc-500">On your own: register and manage your own team or teams.</p>
      </div>
      {error && <Alert tone="red">{error}</Alert>}
      <button type="submit" disabled={busy} className={`${primaryBtn} w-full`}>
        {busy ? "Sending…" : "Ask to join as Solo"}
      </button>
      <p className="text-sm text-zinc-500">
        A school or organization (to host games or register several teams)?{" "}
        <Link href="/register" className="font-medium text-thunder-blue hover:underline">
          Create your organization on CourtCaptain
        </Link>
        .
      </p>
    </form>
  );
}

"use client";

import { useState, useTransition } from "react";
import { logout, requestAccess } from "./login/actions";

// `to`: the organization's own login page, so they come back to the same place.
export function LogoutButton({ to = "/login" }: { to?: string }) {
  const [busy, start] = useTransition();
  return (
    <button
      className="shrink-0 rounded-full px-3 py-2 text-sm font-medium text-zinc-600 ring-1 ring-zinc-950/10 hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-300 dark:ring-white/15 dark:hover:bg-zinc-800"
      disabled={busy}
      onClick={() =>
        start(async () => {
          await logout();
          window.location.replace(to);
        })
      }
    >
      Log out
    </button>
  );
}

export function RequestAccess() {
  const [message, setMessage] = useState<string | null>(null);
  const [busy, start] = useTransition();
  if (message) return <p className="rounded-lg bg-green-50 px-4 py-3 text-green-800 dark:bg-green-950 dark:text-green-200">{message}</p>;
  return (
    <div className="space-y-4">
      <p>You don&apos;t have access to Thunder Basketball yet.</p>
      <button
        className="w-full rounded-xl bg-thunder-blue px-4 py-3 text-lg font-semibold text-white shadow-sm hover:bg-thunder-blue-dark disabled:opacity-50"
        disabled={busy}
        onClick={() =>
          start(async () => {
            const s = await requestAccess();
            setMessage(s.step === "done" || s.step === "error" ? s.message : "Request sent.");
          })
        }
      >
        Request Access
      </button>
    </div>
  );
}

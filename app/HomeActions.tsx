"use client";

import { useTransition } from "react";
import { logout } from "./login/actions";

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

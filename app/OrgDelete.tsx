"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteOwnOrganization } from "./register/actions";
import { Alert } from "./client-ui";
import { inputCls } from "./ui";

// Owners: delete the organization once it has no teams, typing its name to confirm (checked again on the server).
export default function OrgDelete({ org, name, teams }: { org: string; name: string; teams: number }) {
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const router = useRouter();
  if (teams > 0)
    return (
      <p className="text-sm text-zinc-600 dark:text-zinc-300">
        {name} has {teams} team{teams === 1 ? "" : "s"}. An organization can be deleted once it has no teams: delete{" "}
        {teams === 1 ? "it" : "them"} on its Teams page first.
      </p>
    );
  const matches = typed.trim().toLowerCase() === name.trim().toLowerCase();
  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-600 dark:text-zinc-300">
        Removes {name}: its roles, features, gyms and settings. People&apos;s logins stay. It can&apos;t be undone.
      </p>
      <input
        className={inputCls}
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        placeholder={`Type ${name} to delete`}
        aria-label={`Type ${name} to delete`}
        autoComplete="off"
      />
      {error && <Alert tone="red">{error}</Alert>}
      <button
        type="button"
        disabled={!matches || busy}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await deleteOwnOrganization(org, typed);
            if (!r.ok) return setError(r.message);
            router.push("/");
          })
        }
        className="w-full rounded-full px-4 py-2 text-sm font-semibold text-red-600 ring-1 ring-red-600/30 hover:bg-red-50 disabled:opacity-40 dark:text-red-400 dark:ring-red-400/30 dark:hover:bg-red-500/10"
      >
        {busy ? "Deleting…" : `Delete ${name}`}
      </button>
    </div>
  );
}
